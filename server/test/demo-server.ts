// SERVIDOR DE DEMOSTRACIÓN — solo para probar los paneles en local, nunca en producción.
// PayPal y el sistema de licencias están SIMULADOS: "aprobar" en PayPal redirige a una ruta local
// que genera el evento de cobro como si lo enviara PayPal.
// Uso: DATABASE_URL=postgres://… npx tsx test/demo-server.ts
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { connect, migrate } from '../src/db.ts';
import { OutboxMailer } from '../src/email/mailer.ts';
import { SimulatedLicenseEngine } from '../src/licenses/engine.ts';
import { hashPassword } from '../src/auth/passwords.ts';
import { processPayPalEvent } from '../src/billing/webhooks.ts';
import { startWorker } from '../src/worker.ts';
import { FakePayPal } from './helpers.ts';

const config = loadConfig({
  NODE_ENV: 'development',
  APP_URL: process.env.APP_URL ?? 'http://localhost:4173',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://rt:rt@localhost/rt_comercial',
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PORT: '3000',
});
const sql = connect(config.DATABASE_URL);
await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate(sql);

const returnUrls = new Map<string, string>();
class DemoPayPal extends FakePayPal {
  async createSubscription(input: Parameters<FakePayPal['createSubscription']>[0] & { returnUrl: string }) {
    const r = await super.createSubscription(input);
    returnUrls.set(r.id, input.returnUrl);
    return { ...r, approveUrl: `${config.APP_URL}/api/demo/approve?id=${r.id}` };
  }
}
const paypal = new DemoPayPal();
const deps = { config, sql, mailer: new OutboxMailer('.outbox'), licenses: new SimulatedLicenseEngine(), paypal };
const app = await buildApp(deps);

app.get('/api/demo/approve', async (req, reply) => {
  const id = (req.query as { id: string }).id;
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1);
  paypal.setActive(id, next);
  await sql.begin((tx) => processPayPalEvent({ ...deps, sql: tx as any }, {
    id: `WH-DEMO-${randomUUID()}`, event_type: 'PAYMENT.SALE.COMPLETED',
    resource: { id: `SALE-${randomUUID().slice(0, 8)}`, billing_agreement_id: id, amount: { total: '49.00', currency: 'USD' }, create_time: new Date().toISOString() },
  }));
  return reply.redirect(returnUrls.get(id)!);
});

const pw = await hashPassword('demo-password-123');
await sql`INSERT INTO users (name, email, password_hash, role, email_verified_at) VALUES
  ('Leodan (admin)', 'admin@demo.local', ${pw}, 'admin', now()),
  ('Cliente Demo', 'cliente@demo.local', ${pw}, 'customer', now())`;
const [product] = await sql`INSERT INTO products (slug, name, description, platform, status, license_product_ref, activation_policy)
  VALUES ('rt-magneto-nt8', 'RT Magneto', 'Exposición gamma 0DTE y 90DTE en tu gráfico de futuros.', 'NinjaTrader 8', 'active', 'RTMAGNETO', 'Una máquina por licencia (HWID)') RETURNING id`;
await sql`INSERT INTO plans (product_id, name, price_cents, currency, billing_interval, paypal_plan_id, status)
  VALUES (${product.id}, 'Mensual', 4900, 'USD', 'month', 'P-DEMO-MENSUAL', 'active')`;

startWorker(deps, (m, e) => console.error(m, e));
await app.listen({ port: 3000, host: '127.0.0.1' });
console.log('Demo lista. Usuarios: admin@demo.local / cliente@demo.local, contraseña demo-password-123');
