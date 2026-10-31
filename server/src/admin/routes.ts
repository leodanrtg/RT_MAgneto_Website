import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientIp, requireAdmin, type Deps } from '../app.ts';
import { audit } from '../audit.ts';
import { hashPassword } from '../auth/passwords.ts';
import { deleteUserSessions } from '../auth/sessions.ts';
import { issueToken } from '../auth/tokens.ts';
import { applyRemote, formatDate, loadSubscription, refreshSubscription } from '../billing/entitlements.ts';
import { handleStoredEvent } from '../billing/webhook-routes.ts';
import { queueEmail, retryEmail } from '../email/queue.ts';
import { decrypt, encrypt, randomToken } from '../lib/crypto.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { syncLicenseForSubscription } from '../licenses/sync.ts';

const PAGE_SIZE = 25;
const Id = z.object({ id: z.uuid() });
const ListQuery = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  role: z.enum(['customer', 'admin']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const Reason = z.object({ reason: z.string().trim().min(3).max(300) });
const NewUser = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email('Correo no válido').max(254).transform((v) => v.trim().toLowerCase()),
  role: z.enum(['customer', 'admin']).default('customer'),
  sendInvite: z.boolean().default(true),
  note: z.string().trim().max(4000).default(''),
});
const INVITE_TTL_MINUTES = 7 * 24 * 60;

const ProductBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  platform: z.string().trim().min(1).max(120),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  licenseProductRef: z.string().trim().max(120).nullable().default(null),
  activationPolicy: z.string().trim().max(2000).default(''),
});
const PlanBody = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(100).max(10_000_000),
  currency: z.string().length(3).transform((v) => v.toUpperCase()),
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z.number().int().min(1).max(12).default(1),
  graceDays: z.number().int().min(0).max(30).default(3),
});
// Una vez creado en PayPal, el precio y la periodicidad no cambian: se crea un plan nuevo.
const PlanPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  graceDays: z.number().int().min(0).max(30).optional(),
});

const page = (p: number) => ({ limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE });

export function adminRoutes(deps: Deps) {
  const { sql, config, paypal, licenses } = deps;
  const log = (req: FastifyRequest, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) =>
    audit(sql, { actorUserId: req.session!.user.id, action, targetType, targetId, metadata, ip: clientIp(req) });

  // Enlace para elegir contraseña; usa el mismo flujo que "¿Olvidaste la contraseña?", con más plazo.
  async function sendInvite(user: { id: string; name: string; email: string }) {
    const token = await issueToken(sql, user.id, 'reset_password', INVITE_TTL_MINUTES);
    await queueEmail(sql, config, {
      userId: user.id, to: user.email, type: 'account_invite', key: `invite:${user.id}:${token.slice(0, 12)}`,
      data: { name: user.name, link: `${config.APP_URL}/entrar/?restablecer=${token}` },
    });
  }

  return async (app: FastifyInstance) => {
    app.addHook('onRequest', async (req) => {
      requireAdmin(req);
    });

    // ---------- Dashboard ----------
    app.get('/dashboard', async () => {
      const [users] = await sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month
        FROM users`;
      const subs = await sql`SELECT status, count(*)::int AS n FROM subscriptions GROUP BY status`;
      const pays = await sql`SELECT status, count(*)::int AS n FROM payments GROUP BY status`;
      const lic = await sql`SELECT status, count(*)::int AS n FROM license_mappings GROUP BY status`;
      // Ingresos cobrados: solo pagos completados (menos lo reembolsado), por moneda.
      const revenue = await sql`
        SELECT currency,
          coalesce(sum(amount_cents - refunded_cents) FILTER (WHERE paid_at >= date_trunc('day', now())), 0)::int AS today_cents,
          coalesce(sum(amount_cents - refunded_cents) FILTER (WHERE paid_at >= date_trunc('month', now())), 0)::int AS month_cents
        FROM payments WHERE status IN ('completed', 'partially_refunded') GROUP BY currency`;
      // MRR estimado: suscripciones que se renuevan, normalizadas a 30 días. No es dinero cobrado.
      const mrr = await sql`
        SELECT p.currency, round(sum(p.price_cents * 30.0 / (p.interval_count * CASE p.billing_interval
                 WHEN 'day' THEN 1 WHEN 'week' THEN 7 WHEN 'month' THEN 30 ELSE 365 END)))::int AS mrr_cents
        FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.status IN ('active', 'grace') AND NOT s.cancel_at_period_end GROUP BY p.currency`;
      const [errors] = await sql`
        SELECT (SELECT count(*) FROM webhook_events WHERE processing_status = 'failed')::int AS webhooks,
               (SELECT count(*) FROM jobs WHERE status = 'dead')::int AS jobs,
               (SELECT count(*) FROM email_messages WHERE status = 'failed')::int AS emails`;
      const counts = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
      return {
        users, subscriptions: counts(subs), payments: counts(pays), licenses: counts(lic),
        revenue, mrr, integrationErrors: errors, licenseEngine: licenses.kind,
      };
    });

    // ---------- Usuarios ----------
    app.get('/users', async (req) => {
      const q = ListQuery.parse(req.query);
      const like = q.search ? `%${q.search.replace(/[%_\\]/g, '\\$&')}%` : null;
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT id, name, email, role, status, email_verified_at, created_at, count(*) OVER()::int AS total
        FROM users
        WHERE (${like}::text IS NULL OR name ILIKE ${like} OR email ILIKE ${like})
          AND (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null})
          AND (${q.role ?? null}::text IS NULL OR role = ${q.role ?? null})
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });

    // Alta manual (clientes que pagaron por otra vía, soporte, otros administradores). La cuenta nace sin contraseña
    // utilizable: el cliente la elige con el enlace de invitación o con "¿Olvidaste la contraseña?".
    app.post('/users', async (req, reply) => {
      const body = NewUser.parse(req.body);
      const [user] = await sql<{ id: string; name: string; email: string }[]>`
        INSERT INTO users (name, email, password_hash, role, email_verified_at)
        VALUES (${body.name}, ${body.email}, ${await hashPassword(randomToken())}, ${body.role}, now())
        ON CONFLICT (lower(email)) DO NOTHING
        RETURNING id, name, email`;
      if (!user) throw conflict('email_taken', 'Ya existe una cuenta con ese correo.');
      if (body.note) {
        await sql`INSERT INTO support_notes (user_id, author_id, body) VALUES (${user.id}, ${req.session!.user.id}, ${body.note})`;
      }
      if (body.sendInvite) {
        await sendInvite(user);
      }
      await log(req, 'user.create_manual', 'user', user.id, { role: body.role, invited: body.sendInvite });
      return reply.status(201).send({ id: user.id });
    });

    app.post('/users/:id/invite', async (req) => {
      const { id } = Id.parse(req.params);
      const [user] = await sql<{ id: string; name: string; email: string; status: string }[]>`SELECT id, name, email, status FROM users WHERE id = ${id}`;
      if (!user) throw notFound('Usuario no encontrado.');
      if (user.status !== 'active') throw badRequest('suspended', 'La cuenta está suspendida.');
      await sendInvite(user);
      await log(req, 'user.invite_sent', 'user', id);
      return { message: 'Invitación enviada.' };
    });

    app.get('/users/:id', async (req) => {
      const { id } = Id.parse(req.params);
      const [user] = await sql`SELECT id, name, email, role, status, email_verified_at, created_at, updated_at FROM users WHERE id = ${id}`;
      if (!user) throw notFound('Usuario no encontrado.');
      const [subscriptions, payments, licenseRows, notes, actions] = await Promise.all([
        sql`SELECT s.*, p.name AS plan, pr.name AS product FROM subscriptions s JOIN plans p ON p.id = s.plan_id
            JOIN products pr ON pr.id = s.product_id WHERE s.user_id = ${id} ORDER BY s.created_at DESC`,
        sql`SELECT * FROM payments WHERE user_id = ${id} ORDER BY created_at DESC`,
        sql`SELECT m.id, m.status, m.external_license_id, m.key_hint, m.expires_at, m.subscription_id, m.created_at, pr.name AS product
            FROM license_mappings m JOIN products pr ON pr.id = m.product_id WHERE m.user_id = ${id} ORDER BY m.created_at DESC`,
        sql`SELECT n.id, n.body, n.created_at, a.name AS author FROM support_notes n JOIN users a ON a.id = n.author_id
            WHERE n.user_id = ${id} ORDER BY n.created_at DESC`,
        sql`SELECT a.action, a.target_type, a.target_id, a.metadata, a.created_at, u.email AS actor
            FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
            WHERE a.target_id = ${id} OR a.actor_user_id = ${id} ORDER BY a.created_at DESC LIMIT 100`,
      ]);
      return { user, subscriptions, payments, licenses: licenseRows, notes, actions };
    });

    app.post('/users/:id/status', async (req) => {
      const { id } = Id.parse(req.params);
      const body = z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(3).max(300) }).parse(req.body);
      if (id === req.session!.user.id) throw badRequest('self', 'No puedes cambiar el estado de tu propia cuenta.');
      const [u] = await sql`UPDATE users SET status = ${body.status}, updated_at = now() WHERE id = ${id} RETURNING id`;
      if (!u) throw notFound('Usuario no encontrado.');
      if (body.status === 'suspended') await deleteUserSessions(sql, id);
      await log(req, `user.${body.status === 'suspended' ? 'suspend' : 'reactivate'}`, 'user', id, { reason: body.reason });
      return { status: body.status };
    });

    // Nadie cambia su propio rol, así que siempre queda al menos un administrador.
    app.post('/users/:id/role', async (req) => {
      const { id } = Id.parse(req.params);
      const body = z.object({ role: z.enum(['customer', 'admin']), reason: z.string().trim().min(3).max(300) }).parse(req.body);
      if (id === req.session!.user.id) throw badRequest('self', 'No puedes cambiar tu propio rol.');
      const [before] = await sql`SELECT role FROM users WHERE id = ${id}`;
      if (!before) throw notFound('Usuario no encontrado.');
      if (before.role === body.role) return { role: body.role };
      await sql`UPDATE users SET role = ${body.role}, updated_at = now() WHERE id = ${id}`;
      // sesiones nuevas con el rol nuevo
      await deleteUserSessions(sql, id);
      await log(req, 'user.role_change', 'user', id, { from: before.role, to: body.role, reason: body.reason });
      return { role: body.role };
    });

    app.post('/users/:id/notes', async (req) => {
      const { id } = Id.parse(req.params);
      const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
      const [note] = await sql`INSERT INTO support_notes (user_id, author_id, body) VALUES (${id}, ${req.session!.user.id}, ${body}) RETURNING id, created_at`;
      await log(req, 'user.note_added', 'user', id);
      return note;
    });

    // ---------- Productos y planes ----------
    app.get('/products', async () => {
      const products = await sql`SELECT * FROM products ORDER BY created_at`;
      const plans = await sql`SELECT * FROM plans ORDER BY created_at`;
      return { products: products.map((p) => ({ ...p, plans: plans.filter((pl) => pl.product_id === p.id) })) };
    });

    app.post('/products', async (req) => {
      const b = ProductBody.parse(req.body);
      const [p] = await sql`
        INSERT INTO products (slug, name, description, platform, status, license_product_ref, activation_policy)
        VALUES (${b.slug}, ${b.name}, ${b.description}, ${b.platform}, ${b.status}, ${b.licenseProductRef}, ${b.activationPolicy})
        ON CONFLICT (slug) DO NOTHING RETURNING *`;
      if (!p) throw conflict('slug_taken', 'Ya existe un producto con ese identificador.');
      await log(req, 'product.create', 'product', p.id);
      return p;
    });

    app.patch('/products/:id', async (req) => {
      const { id } = Id.parse(req.params);
      const b = ProductBody.partial().parse(req.body);
      const [p] = await sql`
        UPDATE products SET
          name = coalesce(${b.name ?? null}, name), description = coalesce(${b.description ?? null}, description),
          platform = coalesce(${b.platform ?? null}, platform), status = coalesce(${b.status ?? null}, status),
          license_product_ref = ${b.licenseProductRef === undefined ? sql`license_product_ref` : b.licenseProductRef},
          activation_policy = coalesce(${b.activationPolicy ?? null}, activation_policy), updated_at = now()
        WHERE id = ${id} RETURNING *`;
      if (!p) throw notFound('Producto no encontrado.');
      await log(req, 'product.update', 'product', id, { fields: Object.keys(b) });
      return p;
    });

    app.post('/plans', async (req) => {
      const b = PlanBody.parse(req.body);
      const [p] = await sql`
        INSERT INTO plans (product_id, name, price_cents, currency, billing_interval, interval_count, grace_days)
        VALUES (${b.productId}, ${b.name}, ${b.priceCents}, ${b.currency}, ${b.interval}, ${b.intervalCount}, ${b.graceDays})
        RETURNING *`;
      await log(req, 'plan.create', 'plan', p.id, { priceCents: b.priceCents, currency: b.currency, interval: b.interval });
      return p;
    });

    app.patch('/plans/:id', async (req) => {
      const { id } = Id.parse(req.params);
      const b = PlanPatch.parse(req.body);
      const [p] = await sql`
        UPDATE plans SET name = coalesce(${b.name ?? null}, name), status = coalesce(${b.status ?? null}, status),
          grace_days = coalesce(${b.graceDays ?? null}, grace_days), updated_at = now()
        WHERE id = ${id} RETURNING *`;
      if (!p) throw notFound('Plan no encontrado.');
      if (p.status === 'active' && !p.paypal_plan_id) {
        await sql`UPDATE plans SET status = 'draft' WHERE id = ${id}`;
        throw badRequest('no_paypal_plan', 'Crea el plan en PayPal antes de activarlo.');
      }
      await log(req, 'plan.update', 'plan', id, b);
      return p;
    });

    // Crea el producto y el plan en PayPal con los datos guardados.
    app.post('/plans/:id/paypal', async (req) => {
      const { id } = Id.parse(req.params);
      const [plan] = await sql`SELECT p.*, pr.name AS product_name, pr.description FROM plans p JOIN products pr ON pr.id = p.product_id WHERE p.id = ${id}`;
      if (!plan) throw notFound('Plan no encontrado.');
      if (plan.paypal_plan_id) throw conflict('already_created', 'Este plan ya existe en PayPal.');
      const product = await paypal.createProduct({ name: plan.product_name, description: plan.description });
      const remote = await paypal.createPlan({
        productId: product.id, name: `${plan.product_name} · ${plan.name}`,
        price: (plan.price_cents / 100).toFixed(2), currency: plan.currency,
        intervalUnit: plan.billing_interval.toUpperCase(), intervalCount: plan.interval_count,
      });
      const [p] = await sql`UPDATE plans SET paypal_plan_id = ${remote.id}, updated_at = now() WHERE id = ${id} RETURNING *`;
      await log(req, 'plan.paypal_created', 'plan', id, { paypalPlanId: remote.id, env: config.PAYPAL_ENV });
      return p;
    });

    // ---------- Suscripciones y pagos ----------
    app.get('/subscriptions', async (req) => {
      const q = ListQuery.parse(req.query);
      const like = q.search ? `%${q.search.replace(/[%_\\]/g, '\\$&')}%` : null;
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT s.id, s.status, s.provider_status, s.paypal_subscription_id, s.access_until, s.cancel_at_period_end, s.created_at,
               u.id AS user_id, u.email, pr.name AS product, p.name AS plan, count(*) OVER()::int AS total
        FROM subscriptions s JOIN users u ON u.id = s.user_id JOIN plans p ON p.id = s.plan_id JOIN products pr ON pr.id = s.product_id
        WHERE (${q.status ?? null}::text IS NULL OR s.status = ${q.status ?? null})
          AND (${like}::text IS NULL OR u.email ILIKE ${like} OR s.paypal_subscription_id ILIKE ${like})
        ORDER BY s.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });

    app.get('/subscriptions/:id', async (req) => {
      const { id } = Id.parse(req.params);
      const [s] = await sql`
        SELECT s.*, u.email, pr.name AS product, p.name AS plan FROM subscriptions s
        JOIN users u ON u.id = s.user_id JOIN plans p ON p.id = s.plan_id JOIN products pr ON pr.id = s.product_id
        WHERE s.id = ${id}`;
      if (!s) throw notFound('Suscripción no encontrada.');
      return s;
    });

    app.post('/subscriptions/:id/refresh', async (req) => {
      const { id } = Id.parse(req.params);
      const sub = await loadSubscription(sql, { id });
      if (!sub?.paypal_subscription_id) throw notFound('Suscripción no encontrada.');
      const status = await applyRemote(sql, config, sub, await paypal.getSubscription(sub.paypal_subscription_id));
      await log(req, 'subscription.refresh', 'subscription', id);
      return { status };
    });

    // Días de cortesía: amplían el acceso sin cobro y quedan registrados.
    app.post('/subscriptions/:id/extend', async (req) => {
      const { id } = Id.parse(req.params);
      const b = z.object({ days: z.number().int().min(1).max(366), reason: z.string().trim().min(3).max(300) }).parse(req.body);
      const [s] = await sql`
        UPDATE subscriptions SET access_until = greatest(coalesce(access_until, now()), now()) + make_interval(days => ${b.days}), updated_at = now()
        WHERE id = ${id} RETURNING id`;
      if (!s) throw notFound('Suscripción no encontrada.');
      const status = await refreshSubscription(sql, config, id);
      await log(req, 'subscription.extend', 'subscription', id, b);
      return { status };
    });

    app.post('/subscriptions/:id/suspend', async (req) => {
      const { id } = Id.parse(req.params);
      const { reason } = Reason.parse(req.body);
      const [s] = await sql`UPDATE subscriptions SET access_revoked_at = now(), revoke_reason = 'admin', updated_at = now() WHERE id = ${id} RETURNING id`;
      if (!s) throw notFound('Suscripción no encontrada.');
      const status = await refreshSubscription(sql, config, id);
      await log(req, 'subscription.suspend_access', 'subscription', id, { reason });
      return { status };
    });

    app.post('/subscriptions/:id/reactivate', async (req) => {
      const { id } = Id.parse(req.params);
      const { reason } = Reason.parse(req.body);
      const [s] = await sql`UPDATE subscriptions SET access_revoked_at = NULL, revoke_reason = NULL, updated_at = now() WHERE id = ${id} RETURNING id`;
      if (!s) throw notFound('Suscripción no encontrada.');
      const status = await refreshSubscription(sql, config, id);
      await log(req, 'subscription.reactivate_access', 'subscription', id, { reason });
      return { status };
    });

    app.get('/payments', async (req) => {
      const q = ListQuery.parse(req.query);
      const like = q.search ? `%${q.search.replace(/[%_\\]/g, '\\$&')}%` : null;
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT py.*, u.email, count(*) OVER()::int AS total
        FROM payments py JOIN users u ON u.id = py.user_id
        WHERE (${q.status ?? null}::text IS NULL OR py.status = ${q.status ?? null})
          AND (${like}::text IS NULL OR u.email ILIKE ${like} OR py.provider_txn_id ILIKE ${like})
        ORDER BY py.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });

    // ---------- Licencias ----------
    app.get('/licenses', async (req) => {
      const q = ListQuery.parse(req.query);
      const like = q.search ? `%${q.search.replace(/[%_\\]/g, '\\$&')}%` : null;
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT m.id, m.status, m.external_license_id, m.key_hint, m.expires_at, m.last_synced_at, m.created_at, m.subscription_id,
               u.id AS user_id, u.name, u.email, pr.name AS product, s.status AS subscription_status, count(*) OVER()::int AS total
        FROM license_mappings m JOIN users u ON u.id = m.user_id JOIN products pr ON pr.id = m.product_id
        LEFT JOIN subscriptions s ON s.id = m.subscription_id
        WHERE (${q.status ?? null}::text IS NULL OR m.status = ${q.status ?? null})
          AND (${like}::text IS NULL OR u.email ILIKE ${like} OR u.name ILIKE ${like} OR m.external_license_id ILIKE ${like})
        ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });

    // Licencias tal como están en el sistema actual (incluidas las creadas con la app de escritorio).
    app.get('/licenses/external', async (req) => {
      const q = ListQuery.parse(req.query);
      const { limit, offset } = page(q.page);
      const result = await licenses.list({ search: q.search, limit, offset });
      return {
        engine: licenses.kind,
        // la clave completa nunca sale al navegador desde este listado
        items: result.items.map(({ licenseKey, ...l }) => ({ ...l, keyHint: licenseKey.slice(-4) })),
        total: result.total, pageSize: PAGE_SIZE,
      };
    });

    app.get('/licenses/:id', async (req) => {
      const { id } = Id.parse(req.params);
      const [m] = await sql`SELECT * FROM license_mappings WHERE id = ${id}`;
      if (!m) throw notFound('Licencia no encontrada.');
      const external = m.external_license_id ? await licenses.get(m.external_license_id) : null;
      const history = await sql`
        SELECT a.action, a.metadata, a.created_at, u.email AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.target_type = 'license_mapping' AND a.target_id = ${id} ORDER BY a.created_at DESC`;
      const { key_ciphertext, ...mapping } = m;
      return { mapping, external: external && { ...external, licenseKey: undefined, keyHint: external.licenseKey.slice(-4) }, history };
    });

    // Licencia manual (sin suscripción), por ejemplo para soporte o pruebas.
    app.post('/licenses', async (req) => {
      const b = z.object({ userId: z.uuid(), productId: z.uuid(), days: z.number().int().min(1).max(3660), reason: z.string().trim().min(3).max(300) }).parse(req.body);
      const [user] = await sql`SELECT id, name, email FROM users WHERE id = ${b.userId}`;
      const [product] = await sql`SELECT id, name, platform, license_product_ref FROM products WHERE id = ${b.productId}`;
      if (!user || !product) throw notFound('Usuario o producto no encontrado.');
      const [m] = await sql`
        INSERT INTO license_mappings (user_id, product_id) VALUES (${user.id}, ${product.id})
        ON CONFLICT DO NOTHING RETURNING id`;
      if (!m) throw conflict('license_exists', 'Este cliente ya tiene una licencia viva de ese producto. Renuévala en lugar de crear otra.');
      const expiresAt = new Date(Date.now() + b.days * 86_400_000);
      const lic = await licenses.create({ reference: m.id, customerName: user.name, customerEmail: user.email, productRef: product.license_product_ref, expiresAt });
      await sql`
        UPDATE license_mappings SET external_license_id = ${lic.licenseId}, key_ciphertext = ${encrypt(lic.licenseKey, config.DATA_ENCRYPTION_KEY)},
          key_hint = ${lic.licenseKey.slice(-4)}, status = 'active', expires_at = ${expiresAt}, last_synced_at = now()
        WHERE id = ${m.id}`;
      await log(req, 'license.manual_create', 'license_mapping', m.id, { externalId: lic.licenseId, days: b.days, reason: b.reason });
      await queueEmail(sql, config, {
        userId: user.id, to: user.email, type: 'license_key', key: `license_key:${m.id}`,
        data: { name: user.name, product: product.name, plan: 'Licencia manual', platform: product.platform, licenseKey: lic.licenseKey, date: formatDate(expiresAt) },
      });
      return { id: m.id, externalLicenseId: lic.licenseId };
    });

    // Las licencias ligadas a una suscripción se gestionan a través de su suscripción, para que
    // la siguiente sincronización no deshaga el cambio. Las manuales se tocan directamente.
    async function manualMapping(id: string) {
      const [m] = await sql`SELECT * FROM license_mappings WHERE id = ${id}`;
      if (!m) throw notFound('Licencia no encontrada.');
      if (m.status === 'revoked') throw badRequest('revoked', 'La licencia está revocada.');
      if (m.subscription_id) throw badRequest('use_subscription', 'Esta licencia depende de una suscripción: usa las acciones de la suscripción.');
      if (!m.external_license_id) throw badRequest('not_issued', 'La licencia aún no se ha emitido.');
      return m;
    }

    app.post('/licenses/:id/renew', async (req) => {
      const { id } = Id.parse(req.params);
      const b = z.object({ days: z.number().int().min(1).max(3660), reason: z.string().trim().min(3).max(300) }).parse(req.body);
      const m = await manualMapping(id);
      const base = Math.max(Date.now(), m.expires_at?.getTime() ?? 0);
      const expiresAt = new Date(base + b.days * 86_400_000);
      await licenses.setExpiry(m.external_license_id, expiresAt);
      await licenses.setActive(m.external_license_id, true);
      await sql`UPDATE license_mappings SET expires_at = ${expiresAt}, status = 'active', last_synced_at = now(), updated_at = now() WHERE id = ${id}`;
      await log(req, 'license.renew', 'license_mapping', id, b);
      return { expiresAt };
    });

    for (const [action, active] of [['suspend', false], ['reactivate', true]] as const) {
      app.post(`/licenses/:id/${action}`, async (req) => {
        const { id } = Id.parse(req.params);
        const { reason } = Reason.parse(req.body);
        const m = await manualMapping(id);
        await licenses.setActive(m.external_license_id, active);
        await sql`UPDATE license_mappings SET status = ${active ? 'active' : 'suspended'}, last_synced_at = now(), updated_at = now() WHERE id = ${id}`;
        await log(req, `license.${action}`, 'license_mapping', id, { reason });
        return { status: active ? 'active' : 'suspended' };
      });
    }

    // Revocar desactiva la licencia en el sistema actual y la retira de la cuenta. No se borra nada.
    app.post('/licenses/:id/revoke', async (req) => {
      const { id } = Id.parse(req.params);
      const { reason } = Reason.parse(req.body);
      const [m] = await sql`SELECT * FROM license_mappings WHERE id = ${id}`;
      if (!m) throw notFound('Licencia no encontrada.');
      if (m.external_license_id) await licenses.setActive(m.external_license_id, false);
      if (m.subscription_id) {
        await sql`UPDATE subscriptions SET access_revoked_at = coalesce(access_revoked_at, now()), revoke_reason = 'admin', updated_at = now() WHERE id = ${m.subscription_id}`;
      }
      await sql`UPDATE license_mappings SET status = 'revoked', updated_at = now() WHERE id = ${id}`;
      if (m.subscription_id) await refreshSubscription(sql, config, m.subscription_id);
      await log(req, 'license.revoke', 'license_mapping', id, { reason });
      return { status: 'revoked' };
    });

    app.post('/licenses/:id/sync', async (req) => {
      const { id } = Id.parse(req.params);
      const [m] = await sql`SELECT subscription_id FROM license_mappings WHERE id = ${id}`;
      if (!m?.subscription_id) throw badRequest('no_subscription', 'Solo las licencias con suscripción se sincronizan.');
      await syncLicenseForSubscription(sql, config, licenses, m.subscription_id);
      await log(req, 'license.sync', 'license_mapping', id);
      return { ok: true };
    });

    app.post('/licenses/:id/resend-key', async (req) => {
      const { id } = Id.parse(req.params);
      const [m] = await sql`
        SELECT m.*, u.name AS user_name, u.email, pr.name AS product, pr.platform FROM license_mappings m
        JOIN users u ON u.id = m.user_id JOIN products pr ON pr.id = m.product_id WHERE m.id = ${id}`;
      if (!m?.key_ciphertext || m.status !== 'active') throw badRequest('not_active', 'Solo se reenvían claves de licencias activas.');
      // siempre a la dirección de la cuenta, nunca a otra
      await queueEmail(sql, config, {
        userId: m.user_id, to: m.email, type: 'license_key', key: `license_key:${id}:resend:${Date.now()}`,
        data: { name: m.user_name, product: m.product, plan: '—', platform: m.platform, licenseKey: decrypt(m.key_ciphertext, config.DATA_ENCRYPTION_KEY), date: formatDate(m.expires_at) },
      });
      await log(req, 'license.resend_key', 'license_mapping', id);
      return { ok: true };
    });

    // ---------- Integraciones: webhooks, tareas y correos ----------
    app.get('/webhooks', async (req) => {
      const q = ListQuery.parse(req.query);
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT id, provider_event_id, event_type, resource_id, processing_status, attempts, received_at, processed_at, error_summary,
               count(*) OVER()::int AS total
        FROM webhook_events WHERE (${q.status ?? null}::text IS NULL OR processing_status = ${q.status ?? null})
        ORDER BY received_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });

    app.post('/webhooks/:id/reprocess', async (req) => {
      const { id } = Id.parse(req.params);
      const [row] = await sql`SELECT id, payload, processing_status FROM webhook_events WHERE id = ${id}`;
      if (!row) throw notFound('Evento no encontrado.');
      if (row.processing_status !== 'failed') throw badRequest('not_failed', 'Solo se reprocesan eventos fallidos.');
      await log(req, 'webhook.reprocess', 'webhook_event', id);
      return handleStoredEvent(deps, id, row.payload);
    });

    app.get('/jobs', async (req) => {
      const q = ListQuery.parse(req.query);
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT id, type, status, attempts, max_attempts, run_at, last_error, created_at, count(*) OVER()::int AS total
        FROM jobs WHERE (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null})
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });

    app.post('/jobs/:id/retry', async (req) => {
      const { id } = Id.parse(req.params);
      const [j] = await sql`UPDATE jobs SET status = 'pending', attempts = 0, max_attempts = 8, run_at = now(), updated_at = now()
                            WHERE id = ${id} AND status = 'dead' RETURNING id`.catch((err) => {
        if (err?.code === '23505') throw conflict('duplicate_job', 'Ya hay una tarea igual pendiente.');
        throw err;
      });
      if (!j) throw badRequest('not_dead', 'Solo se reintentan tareas fallidas definitivamente.');
      await log(req, 'job.retry', 'job', id);
      return { ok: true };
    });

    app.get('/emails', async (req) => {
      const q = ListQuery.parse(req.query);
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT id, to_email, message_type, status, attempts, sent_at, last_error, created_at, count(*) OVER()::int AS total
        FROM email_messages WHERE (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null})
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });

    app.post('/emails/:id/retry', async (req) => {
      const { id } = Id.parse(req.params);
      await retryEmail(sql, id);
      await log(req, 'email.retry', 'email_message', id);
      return { ok: true };
    });

    app.get('/audit', async (req) => {
      const q = ListQuery.parse(req.query);
      const { limit, offset } = page(q.page);
      const rows = await sql`
        SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.ip, a.created_at, u.email AS actor, count(*) OVER()::int AS total
        FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE (${q.search ?? null}::text IS NULL OR a.action ILIKE ${`%${q.search ?? ''}%`})
        ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, pageSize: PAGE_SIZE };
    });
  };
}
