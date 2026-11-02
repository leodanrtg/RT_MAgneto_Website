import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp, type Deps } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { connect, migrate, type Sql } from '../src/db.ts';
import { OutboxMailer } from '../src/email/mailer.ts';
import { SimulatedLicenseEngine } from '../src/licenses/engine.ts';
import type { PayPalApi, RemoteSubscription, WebhookHeaders } from '../src/billing/paypal.ts';
import { runDueJobs } from '../src/jobs.ts';
import { jobHandlers } from '../src/worker.ts';
import { hashPassword } from '../src/auth/passwords.ts';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://rt:rt@localhost/rt_comercial_test';

// PayPal falso: guarda suscripciones en memoria. Un webhook es "auténtico" si lleva la firma 'valid'.
export class FakePayPal implements PayPalApi {
  subs = new Map<string, RemoteSubscription>();
  canceled: string[] = [];
  verifyFails = false;
  async createProduct() { return { id: `PROD-${randomUUID().slice(0, 8)}` }; }
  async createPlan() { return { id: `P-${randomUUID().slice(0, 8)}` }; }
  async createSubscription(input: { planId: string; customId: string }) {
    const id = `I-${randomUUID().slice(0, 10).toUpperCase()}`;
    this.subs.set(id, { id, status: 'APPROVAL_PENDING', plan_id: input.planId, custom_id: input.customId });
    return { id, approveUrl: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${id}` };
  }
  async getSubscription(id: string) {
    const s = this.subs.get(id);
    if (!s) throw new Error('no existe');
    return structuredClone(s);
  }
  async cancelSubscription(id: string) {
    this.canceled.push(id);
    const s = this.subs.get(id)!;
    s.status = 'CANCELLED';
    delete s.billing_info?.next_billing_time;
  }
  async verifyWebhook(headers: WebhookHeaders) {
    if (this.verifyFails) throw new Error('PayPal no responde');
    return headers['paypal-transmission-sig'] === 'valid';
  }
  // simula el estado que tendría la suscripción tras un cobro
  setActive(id: string, nextBilling: Date) {
    const s = this.subs.get(id)!;
    s.status = 'ACTIVE';
    s.billing_info = { ...(s.billing_info ?? {}), next_billing_time: nextBilling.toISOString() };
  }
}

export async function setup() {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:5173',
    DATABASE_URL: TEST_DB,
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PAYPAL_WEBHOOK_ID: 'WH-TEST',
    RATE_LIMIT_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
  });
  const sql = connect(config.DATABASE_URL, 5);
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(sql);
  const mailer = new OutboxMailer();
  const licenses = new SimulatedLicenseEngine();
  const paypal = new FakePayPal();
  const deps: Deps = { config, sql, mailer, licenses, paypal };
  const app = await buildApp(deps);
  return { deps, app, sql, mailer, licenses, paypal, config };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;

export const drain = (ctx: Ctx) => runDueJobs(ctx.sql, jobHandlers(ctx.deps), 100);

// Ejecuta la cola hasta vaciarla (ignorando las tareas programadas para más tarde).
export async function drainAll(ctx: Ctx) {
  for (let i = 0; i < 10; i++) {
    const r = await drain(ctx);
    if (r.claimed === 0) return;
  }
}

// Cliente HTTP con cookie de sesión y token CSRF.
export class Client {
  cookie?: string;
  csrf?: string;
  constructor(private ctx: Ctx) {}
  async req(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}) {
    const res = await this.ctx.app.inject({
      method, url, payload: payload as any,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        ...headers,
      },
    });
    const set = res.cookies.find((c) => c.name === 'rt_session');
    if (set) this.cookie = set.value ? `rt_session=${set.value}` : undefined;
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }
  async login(email: string, password: string) {
    const r = await this.req('POST', '/api/auth/login', { email, password });
    this.csrf = r.body?.csrfToken;
    return r;
  }
}

export async function createUser(ctx: Ctx, opts: { email?: string; role?: 'admin' | 'customer'; verified?: boolean; password?: string } = {}) {
  const email = opts.email ?? `u${randomUUID().slice(0, 8)}@test.dev`;
  const password = opts.password ?? 'contraseña-segura-1';
  const [u] = await ctx.sql`
    INSERT INTO users (name, email, password_hash, role, email_verified_at)
    VALUES ('Cliente Prueba', ${email}, ${await hashPassword(password)}, ${opts.role ?? 'customer'}, ${opts.verified === false ? null : new Date()})
    RETURNING id`;
  const client = new Client(ctx);
  await client.login(email, password);
  return { id: u.id as string, email, password, client };
}

export async function createProductPlan(ctx: Ctx, opts: { graceDays?: number } = {}) {
  const [product] = await ctx.sql`
    INSERT INTO products (slug, name, platform, status, license_product_ref)
    VALUES (${`rt-${randomUUID().slice(0, 6)}`}, 'RT Magneto', 'NinjaTrader 8', 'active', 'RTMAGNETO') RETURNING id`;
  const [plan] = await ctx.sql`
    INSERT INTO plans (product_id, name, price_cents, currency, billing_interval, grace_days, paypal_plan_id, status)
    VALUES (${product.id}, 'Mensual', 4900, 'USD', 'month', ${opts.graceDays ?? 3}, ${`P-${randomUUID().slice(0, 8)}`}, 'active') RETURNING id`;
  return { productId: product.id as string, planId: plan.id as string };
}

let eventSeq = 0;
export function webhook(ctx: Ctx, event_type: string, resource: Record<string, unknown>, opts: { id?: string; sig?: string } = {}) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/webhooks/paypal',
    headers: {
      'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
      'paypal-transmission-id': 't', 'paypal-transmission-sig': opts.sig ?? 'valid', 'paypal-transmission-time': new Date().toISOString(),
    },
    payload: { id: opts.id ?? `WH-${++eventSeq}-${randomUUID().slice(0, 6)}`, event_type, resource, create_time: new Date().toISOString() },
  });
}

// Compra completa: checkout + aprobación + webhook de cobro.
export async function purchase(ctx: Ctx, user: Awaited<ReturnType<typeof createUser>>, planId: string, paidAt = new Date()) {
  const start = await user.client.req('POST', '/api/checkout/subscriptions', { planId });
  if (start.status !== 200) throw new Error(`checkout falló: ${JSON.stringify(start.body)}`);
  const [sub] = await ctx.sql`SELECT * FROM subscriptions WHERE id = ${start.body.subscriptionId}`;
  const next = new Date(paidAt);
  next.setUTCMonth(next.getUTCMonth() + 1);
  ctx.paypal.setActive(sub.paypal_subscription_id, next);
  const saleId = `SALE-${randomUUID().slice(0, 8)}`;
  const res = await webhook(ctx, 'PAYMENT.SALE.COMPLETED', {
    id: saleId, billing_agreement_id: sub.paypal_subscription_id, amount: { total: '49.00', currency: 'USD' },
    state: 'completed', create_time: paidAt.toISOString(), custom: sub.id,
  });
  return { subId: sub.id as string, paypalId: sub.paypal_subscription_id as string, saleId, res };
}

export const db = (ctx: Ctx): Sql => ctx.sql;
