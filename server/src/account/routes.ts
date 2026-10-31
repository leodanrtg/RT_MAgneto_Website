import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientIp, requireUser, type Deps } from '../app.ts';
import { audit } from '../audit.ts';
import { verifyPassword } from '../auth/passwords.ts';
import { formatDate, loadSubscription, refreshSubscription } from '../billing/entitlements.ts';
import { queueEmail } from '../email/queue.ts';
import { decrypt } from '../lib/crypto.ts';
import { HttpError, badRequest, notFound } from '../lib/errors.ts';

const IdParams = z.object({ id: z.uuid() });
const RevealBody = z.object({ password: z.string().min(1).max(200) });
const ProfileBody = z.object({ name: z.string().trim().min(1).max(120) });

// Todas las consultas filtran por el usuario de la sesión: un cliente nunca ve datos de otro.
export function accountRoutes({ sql, config, paypal }: Deps) {
  return async (app: FastifyInstance) => {
    app.get('/overview', async (req) => {
      const { user } = requireUser(req);
      const subscriptions = await sql`
        SELECT s.id, s.status, s.current_period_end, s.access_until, s.cancel_at_period_end, s.canceled_at, s.created_at,
               pr.name AS product, pr.platform, p.name AS plan, p.price_cents, p.currency, p.billing_interval, p.interval_count
        FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN products pr ON pr.id = s.product_id
        WHERE s.user_id = ${user.id} AND s.status <> 'approval_pending'
        ORDER BY s.created_at DESC`;
      const licenses = await sql`
        SELECT m.id, m.status, m.expires_at, m.key_hint, m.external_license_id IS NOT NULL AS issued, pr.name AS product, pr.platform
        FROM license_mappings m JOIN products pr ON pr.id = m.product_id
        WHERE m.user_id = ${user.id} ORDER BY m.created_at DESC`;
      const payments = await sql`
        SELECT py.id, py.amount_cents, py.refunded_cents, py.currency, py.status, py.payment_type, py.paid_at, py.created_at, pr.name AS product
        FROM payments py LEFT JOIN subscriptions s ON s.id = py.subscription_id LEFT JOIN products pr ON pr.id = s.product_id
        WHERE py.user_id = ${user.id} ORDER BY py.created_at DESC LIMIT 100`;
      return { subscriptions, licenses, payments };
    });

    app.patch('/profile', async (req) => {
      const { user } = requireUser(req);
      const { name } = ProfileBody.parse(req.body);
      await sql`UPDATE users SET name = ${name}, updated_at = now() WHERE id = ${user.id}`;
      return { name };
    });

    // Ver la clave exige volver a escribir la contraseña y queda registrado.
    app.post('/licenses/:id/reveal', { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } } }, async (req) => {
      const { user } = requireUser(req);
      const { id } = IdParams.parse(req.params);
      const { password } = RevealBody.parse(req.body);
      const [row] = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
      if (!(await verifyPassword(row.password_hash, password))) throw badRequest('invalid_password', 'La contraseña no es correcta.');
      const [m] = await sql`SELECT key_ciphertext, status FROM license_mappings WHERE id = ${id} AND user_id = ${user.id}`;
      if (!m) throw notFound('Licencia no encontrada.');
      if (!m.key_ciphertext) throw new HttpError(409, 'not_issued', 'La clave todavía se está generando.');
      if (m.status === 'revoked') throw new HttpError(403, 'revoked', 'Esta licencia fue revocada.');
      await audit(sql, { actorUserId: user.id, action: 'license.key_revealed', targetType: 'license_mapping', targetId: id, ip: clientIp(req) });
      return { licenseKey: decrypt(m.key_ciphertext, config.DATA_ENCRYPTION_KEY) };
    });

    // Cancela la renovación en PayPal. El acceso sigue hasta el final del periodo pagado.
    app.post('/subscriptions/:id/cancel', async (req) => {
      const { user } = requireUser(req);
      const { id } = IdParams.parse(req.params);
      const sub = await loadSubscription(sql, { id });
      if (!sub || sub.user_id !== user.id) throw notFound('Suscripción no encontrada.');
      if (!sub.paypal_subscription_id || !['active', 'grace', 'payment_pending', 'unpaid', 'suspended'].includes(sub.status) || sub.cancel_at_period_end) {
        throw badRequest('not_cancelable', 'Esta suscripción no se puede cancelar.');
      }
      await paypal.cancelSubscription(sub.paypal_subscription_id, 'Cancelada por el cliente desde su cuenta');
      await sql`UPDATE subscriptions SET cancel_at_period_end = true, canceled_at = now(), updated_at = now() WHERE id = ${id}`;
      const status = await refreshSubscription(sql, config, id);
      await audit(sql, { actorUserId: user.id, action: 'subscription.cancel', targetType: 'subscription', targetId: id, ip: clientIp(req) });
      if (sub.access_until && sub.access_until > new Date()) {
        await queueEmail(sql, config, {
          userId: user.id, to: sub.user_email, type: 'subscription_canceled', key: `canceled:${id}`,
          data: { name: sub.user_name, product: sub.product_name, date: formatDate(sub.access_until) },
        });
      }
      return { status, accessUntil: sub.access_until };
    });
  };
}
