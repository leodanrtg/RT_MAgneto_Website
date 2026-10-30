import type { Config } from '../config.ts';
import type { Sql } from '../db.ts';
import { queueEmail } from '../email/queue.ts';
import { enqueue } from '../jobs.ts';
import type { RemoteSubscription } from './paypal.ts';

// Derechos de acceso. El estado interno de cada suscripción se DERIVA de unos pocos datos verificados
// (estado en PayPal, fin del periodo pagado, cancelación, revocación). Así el mismo evento aplicado
// dos veces deja el mismo resultado y nunca amplía la licencia dos veces.

export type SubStatus =
  | 'approval_pending' | 'active' | 'grace' | 'payment_pending'
  | 'unpaid' | 'suspended' | 'canceled' | 'expired';

export type SubRow = {
  id: string;
  user_id: string;
  product_id: string;
  plan_id: string;
  paypal_subscription_id: string | null;
  provider_status: string | null;
  status: SubStatus;
  current_period_start: Date | null;
  current_period_end: Date | null;
  access_until: Date | null;
  access_revoked_at: Date | null;
  cancel_at_period_end: boolean;
  grace_days: number;
  billing_interval: 'day' | 'week' | 'month' | 'year';
  interval_count: number;
  user_name: string;
  user_email: string;
  product_name: string;
  plan_name: string;
};

const DAY = 86_400_000;

export const formatDate = (d: Date) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' }).format(d);

export function addInterval(from: Date, unit: SubRow['billing_interval'], count: number): Date {
  const d = new Date(from);
  if (unit === 'day') d.setUTCDate(d.getUTCDate() + count);
  if (unit === 'week') d.setUTCDate(d.getUTCDate() + 7 * count);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + count);
  if (unit === 'year') d.setUTCFullYear(d.getUTCFullYear() + count);
  return d;
}

export function deriveStatus(s: Pick<SubRow, 'provider_status' | 'access_until' | 'access_revoked_at' | 'cancel_at_period_end' | 'grace_days'>, now: Date): SubStatus {
  const p = s.provider_status;
  const ended = p === 'CANCELLED' || p === 'EXPIRED';
  if (s.access_revoked_at) return 'suspended';
  if (!s.access_until) {
    if (!p || p === 'APPROVAL_PENDING' || p === 'APPROVED') return 'approval_pending';
    if (p === 'ACTIVE') return 'payment_pending';
    return p === 'SUSPENDED' ? 'suspended' : 'expired';
  }
  const until = s.access_until.getTime();
  if (now.getTime() <= until) return s.cancel_at_period_end || ended ? 'canceled' : 'active';
  if (s.cancel_at_period_end || ended) return 'expired';
  if (now.getTime() <= until + s.grace_days * DAY) return 'grace';
  return p === 'SUSPENDED' ? 'suspended' : 'unpaid';
}

// Estado que debe tener la licencia en el sistema actual.
// Con renovación automática se deja un margen igual al periodo de gracia, para que el retraso
// entre el cobro y el webhook no corte el indicador. Si el cliente canceló, vence al final de lo pagado.
export function desiredLicense(s: SubRow, status: SubStatus): { active: boolean; expiresAt: Date } | null {
  if (!s.access_until) return null;
  const active = status === 'active' || status === 'canceled' || status === 'grace';
  const buffer = s.cancel_at_period_end || s.provider_status === 'CANCELLED' || s.provider_status === 'EXPIRED' ? 0 : s.grace_days * DAY;
  return { active, expiresAt: new Date(s.access_until.getTime() + buffer) };
}

export async function loadSubscription(sql: Sql, where: { id?: string; paypalId?: string }): Promise<SubRow | undefined> {
  const [row] = await sql<SubRow[]>`
    SELECT s.*, p.grace_days, p.billing_interval, p.interval_count, p.name AS plan_name,
           u.name AS user_name, u.email AS user_email, pr.name AS product_name
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    JOIN users u ON u.id = s.user_id
    JOIN products pr ON pr.id = s.product_id
    WHERE ${where.id ? sql`s.id = ${where.id}` : sql`s.paypal_subscription_id = ${where.paypalId ?? ''}`}`;
  return row;
}

// Recalcula el estado, avisa de los cambios por correo y pide sincronizar la licencia.
export async function refreshSubscription(sql: Sql, config: Config, id: string, now = new Date()): Promise<SubStatus | undefined> {
  const sub = await loadSubscription(sql, { id });
  if (!sub) return undefined;
  const status = deriveStatus(sub, now);
  if (status !== sub.status) {
    await sql`UPDATE subscriptions SET status = ${status}, updated_at = now() WHERE id = ${id}`;
    const period = sub.access_until?.toISOString() ?? 'none';
    const base = { userId: sub.user_id, to: sub.user_email };
    const data = { name: sub.user_name, product: sub.product_name, plan: sub.plan_name };
    if (status === 'grace') {
      const end = new Date(sub.access_until!.getTime() + sub.grace_days * DAY);
      await queueEmail(sql, config, { ...base, type: 'grace_period', key: `grace:${id}:${period}`, data: { ...data, date: formatDate(end) } });
    }
    if (status === 'expired' && sub.access_until) {
      await queueEmail(sql, config, { ...base, type: 'access_expired', key: `expired:${id}:${period}`, data });
    }
  }
  // la sincronización lee el estado al ejecutarse, así que basta una tarea pendiente por suscripción
  if (sub.access_until) await enqueue(sql, 'license.sync', { subscriptionId: id }, { key: `license.sync:${id}` });
  return status;
}

// Aplica el estado real leído de la API de PayPal (nunca el de la redirección del navegador).
export async function applyRemote(sql: Sql, config: Config, sub: SubRow, remote: RemoteSubscription) {
  if (remote.custom_id && remote.custom_id !== sub.id) {
    throw new Error('la suscripción de PayPal no corresponde a esta suscripción interna');
  }
  const next = remote.billing_info?.next_billing_time ? new Date(remote.billing_info.next_billing_time) : null;
  const cancelled = remote.status === 'CANCELLED' || remote.status === 'EXPIRED';
  await sql`
    UPDATE subscriptions SET
      provider_status = ${remote.status},
      current_period_end = coalesce(${next}, current_period_end),
      cancel_at_period_end = cancel_at_period_end OR ${cancelled},
      canceled_at = CASE WHEN ${cancelled} THEN coalesce(canceled_at, now()) ELSE canceled_at END,
      updated_at = now()
    WHERE id = ${sub.id}`;
  return refreshSubscription(sql, config, sub.id);
}
