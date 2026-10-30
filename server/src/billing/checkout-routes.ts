import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientIp, requireUser, type Deps } from '../app.ts';
import { audit } from '../audit.ts';
import { HttpError, conflict, notFound } from '../lib/errors.ts';
import { applyRemote, loadSubscription } from './entitlements.ts';

const StartBody = z.object({ planId: z.uuid() });
const IdParams = z.object({ id: z.uuid() });

// Estados en los que el cliente ya tiene (o está a punto de tener) acceso a ese producto.
const LIVE = ['active', 'grace', 'payment_pending', 'canceled'];

export function checkoutRoutes({ sql, config, paypal }: Deps) {
  return async (app: FastifyInstance) => {
    app.post('/subscriptions', { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } } }, async (req) => {
      const { user } = requireUser(req);
      if (!user.email_verified_at) throw new HttpError(403, 'email_unverified', 'Confirma tu correo antes de comprar.');
      const { planId } = StartBody.parse(req.body);

      // precio, plan y producto salen de la base de datos, nunca del navegador
      const [plan] = await sql`
        SELECT p.id, p.product_id, p.paypal_plan_id FROM plans p JOIN products pr ON pr.id = p.product_id
        WHERE p.id = ${planId} AND p.status = 'active' AND pr.status = 'active' AND p.paypal_plan_id IS NOT NULL`;
      if (!plan) throw notFound('Plan');

      const [live] = await sql`
        SELECT id, status FROM subscriptions
        WHERE user_id = ${user.id} AND product_id = ${plan.product_id} AND status = ANY(${LIVE})`;
      if (live?.status === 'canceled') throw conflict('already_subscribed', 'Ya tienes acceso a este producto hasta el final del periodo pagado. Podrás suscribirte de nuevo cuando termine.');
      if (live) throw conflict('already_subscribed', 'Ya tienes una suscripción a este producto.');

      // las aprobaciones abandonadas no cuentan
      await sql`UPDATE subscriptions SET status = 'expired', updated_at = now()
                WHERE user_id = ${user.id} AND product_id = ${plan.product_id} AND status = 'approval_pending'`;
      const [sub] = await sql`
        INSERT INTO subscriptions (user_id, product_id, plan_id) VALUES (${user.id}, ${plan.product_id}, ${plan.id}) RETURNING id`;

      const remote = await paypal.createSubscription({
        planId: plan.paypal_plan_id,
        customId: sub.id,
        email: user.email,
        name: user.name,
        returnUrl: `${config.APP_URL}/cuenta/?paypal=aprobado&suscripcion=${sub.id}`,
        cancelUrl: `${config.APP_URL}/cuenta/?paypal=cancelado`,
      });
      await sql`UPDATE subscriptions SET paypal_subscription_id = ${remote.id}, provider_status = 'APPROVAL_PENDING', updated_at = now() WHERE id = ${sub.id}`;
      await audit(sql, { actorUserId: user.id, action: 'subscription.checkout_started', targetType: 'subscription', targetId: sub.id, ip: clientIp(req) });
      return { subscriptionId: sub.id, approveUrl: remote.approveUrl };
    });

    // Tras volver de PayPal: se consulta la API de PayPal; la redirección no concede acceso por sí sola.
    app.post('/subscriptions/:id/confirm', async (req) => {
      const { user } = requireUser(req);
      const { id } = IdParams.parse(req.params);
      const sub = await loadSubscription(sql, { id });
      if (!sub || sub.user_id !== user.id || !sub.paypal_subscription_id) throw notFound('Suscripción');
      const remote = await paypal.getSubscription(sub.paypal_subscription_id);
      const status = await applyRemote(sql, config, sub, remote);
      return { status };
    });
  };
}
