import type { Deps } from '../app.ts';
import { audit } from '../audit.ts';
import { queueEmail } from '../email/queue.ts';
import { addInterval, applyRemote, formatDate, loadSubscription, refreshSubscription } from './entitlements.ts';

export type PayPalEvent = { id: string; event_type: string; resource: any; create_time?: string };

export type Outcome = { status: 'processed' | 'ignored'; note?: string };

const SUBSCRIPTION_EVENTS = new Set([
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
]);

const cents = (value: string | number) => Math.round(Number(value) * 100);
const money = (amountCents: number, currency: string) => `${(amountCents / 100).toFixed(2)} ${currency}`;

// Procesa un evento ya verificado. Es idempotente: cada operación usa claves únicas
// (ID de venta, ID de evento, clave de correo) y el estado se deriva, no se acumula.
export async function processPayPalEvent(deps: Deps, event: PayPalEvent): Promise<Outcome> {
  const { sql, config, paypal } = deps;
  const r = event.resource ?? {};

  if (SUBSCRIPTION_EVENTS.has(event.event_type)) {
    const sub = await loadSubscription(sql, { paypalId: r.id });
    if (!sub) return { status: 'ignored', note: 'suscripción desconocida' };
    const remote = await paypal.getSubscription(r.id);
    await applyRemote(sql, config, sub, remote);
    if (event.event_type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      await queueEmail(sql, config, {
        userId: sub.user_id, to: sub.user_email, type: 'payment_failed', key: `payfail:${event.id}`,
        data: { name: sub.user_name, product: sub.product_name },
      });
    }
    if (event.event_type === 'BILLING.SUBSCRIPTION.CANCELLED') {
      const fresh = (await loadSubscription(sql, { id: sub.id }))!;
      if (fresh.access_until && fresh.access_until > new Date()) {
        await queueEmail(sql, config, {
          userId: sub.user_id, to: sub.user_email, type: 'subscription_canceled', key: `canceled:${sub.id}`,
          data: { name: sub.user_name, product: sub.product_name, date: formatDate(fresh.access_until) },
        });
      }
    }
    return { status: 'processed' };
  }

  switch (event.event_type) {
    case 'PAYMENT.SALE.COMPLETED':
    case 'PAYMENT.SALE.PENDING':
    case 'PAYMENT.SALE.DENIED': {
      if (!r.billing_agreement_id) return { status: 'ignored', note: 'venta sin suscripción' };
      const sub = await loadSubscription(sql, { paypalId: r.billing_agreement_id });
      if (!sub) return { status: 'ignored', note: 'suscripción desconocida' };
      if (r.custom && r.custom !== sub.id) throw new Error('custom_id de la venta no coincide');

      const status = event.event_type === 'PAYMENT.SALE.COMPLETED' ? 'completed' : event.event_type === 'PAYMENT.SALE.PENDING' ? 'pending' : 'failed';
      const amount = cents(r.amount?.total ?? 0);
      const currency = String(r.amount?.currency ?? '').toUpperCase();
      const paidAt = new Date(r.create_time ?? event.create_time ?? Date.now());
      const [{ prior }] = await sql`
        SELECT count(*)::int AS prior FROM payments
        WHERE subscription_id = ${sub.id} AND status <> 'failed' AND status <> 'pending' AND provider_txn_id <> ${r.id}`;
      const [payment] = await sql`
        INSERT INTO payments (user_id, subscription_id, provider_txn_id, amount_cents, currency, status, payment_type, paid_at)
        VALUES (${sub.user_id}, ${sub.id}, ${r.id}, ${amount}, ${currency}, ${status},
                ${prior > 0 ? 'renewal' : 'initial'}, ${status === 'completed' ? paidAt : null})
        ON CONFLICT (provider, provider_txn_id) DO UPDATE SET
          status = CASE WHEN payments.status IN ('pending', 'failed') THEN EXCLUDED.status ELSE payments.status END,
          paid_at = coalesce(payments.paid_at, EXCLUDED.paid_at),
          updated_at = now()
        RETURNING id, status, payment_type`;
      if (status !== 'completed' || payment.status !== 'completed') {
        await refreshSubscription(sql, config, sub.id);
        return { status: 'processed' };
      }

      // Fin del periodo pagado: lo dice PayPal (próximo cobro); si no, se calcula desde el pago.
      // Se guarda el máximo, así un evento repetido o desordenado no amplía ni recorta el acceso.
      const remote = await paypal.getSubscription(sub.paypal_subscription_id!);
      const next = remote.billing_info?.next_billing_time ? new Date(remote.billing_info.next_billing_time) : null;
      const periodEnd = next && next > paidAt ? next : addInterval(paidAt, sub.billing_interval, sub.interval_count);
      await sql`
        UPDATE subscriptions SET
          access_until = greatest(coalesce(access_until, ${periodEnd}), ${periodEnd}),
          current_period_start = CASE WHEN current_period_end IS NULL OR ${periodEnd} > current_period_end THEN ${paidAt} ELSE current_period_start END,
          current_period_end = greatest(coalesce(current_period_end, ${periodEnd}), ${periodEnd}),
          provider_status = ${remote.status},
          updated_at = now()
        WHERE id = ${sub.id}`;
      await refreshSubscription(sql, config, sub.id);
      const fresh = (await loadSubscription(sql, { id: sub.id }))!;
      await queueEmail(sql, config, {
        userId: sub.user_id, to: sub.user_email,
        type: payment.payment_type === 'initial' ? 'purchase_confirmed' : 'renewal_confirmed',
        key: `payment:${r.id}`,
        data: { name: sub.user_name, product: sub.product_name, plan: sub.plan_name, amount: money(amount, currency), date: formatDate(fresh.access_until!) },
      });
      return { status: 'processed' };
    }

    case 'PAYMENT.SALE.REFUNDED':
    case 'PAYMENT.SALE.REVERSED': {
      const saleId = r.sale_id ?? r.id;
      const [payment] = await sql`SELECT * FROM payments WHERE provider = 'paypal' AND provider_txn_id = ${saleId}`;
      if (!payment) return { status: 'ignored', note: 'pago desconocido' };
      const reversed = event.event_type === 'PAYMENT.SALE.REVERSED';
      const refunded = reversed ? payment.amount_cents : Math.min(payment.amount_cents, payment.refunded_cents + cents(r.amount?.total ?? 0));
      const newStatus = reversed ? 'reversed' : refunded >= payment.amount_cents ? 'refunded' : 'partially_refunded';
      await sql`UPDATE payments SET refunded_cents = ${refunded}, status = ${newStatus}, updated_at = now() WHERE id = ${payment.id}`;

      // Reembolso total (según REFUND_POLICY) o contracargo: se suspende el acceso. Nunca se borra nada.
      const suspend = reversed || (newStatus === 'refunded' && config.REFUND_POLICY === 'suspend');
      if (suspend && payment.subscription_id) {
        await sql`UPDATE subscriptions SET access_revoked_at = coalesce(access_revoked_at, now()),
                  revoke_reason = ${reversed ? 'chargeback' : 'refund'}, updated_at = now() WHERE id = ${payment.subscription_id}`;
        await refreshSubscription(sql, config, payment.subscription_id);
      }
      await audit(sql, {
        action: reversed ? 'payment.reversed' : 'payment.refunded', targetType: 'payment', targetId: payment.id,
        metadata: { status: newStatus, refundedCents: refunded, accessSuspended: suspend },
      });
      return { status: 'processed' };
    }

    case 'CUSTOMER.DISPUTE.CREATED': {
      const txn = r.disputed_transactions?.[0]?.seller_transaction_id;
      await audit(sql, { action: 'payment.dispute_opened', targetType: 'payment_txn', targetId: txn ?? 'desconocida', metadata: { disputeId: r.dispute_id } });
      return { status: 'processed', note: 'disputa registrada para revisión manual' };
    }
  }
  return { status: 'ignored', note: 'tipo de evento no usado' };
}
