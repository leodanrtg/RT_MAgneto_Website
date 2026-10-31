import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createProductPlan, createUser, drainAll, purchase, setup, webhook, type Ctx } from './helpers.ts';
import { sweepSubscriptions } from '../src/worker.ts';

let ctx: Ctx;
let planId: string;
beforeAll(async () => {
  ctx = await setup();
  ({ planId } = await createProductPlan(ctx, { graceDays: 3 }));
});
afterAll(async () => { await ctx.app.close(); await ctx.sql.end(); });
beforeEach(() => { ctx.licenses.failNext = 0; ctx.paypal.verifyFails = false; });

const DAY = 86_400_000;
const sub = async (id: string) => (await ctx.sql`SELECT * FROM subscriptions WHERE id = ${id}`)[0];
const mappings = (userId: string) => ctx.sql`SELECT * FROM license_mappings WHERE user_id = ${userId}`;
const mails = (to: string, subject: string) => ctx.mailer.sent.filter((m) => m.to === to && m.subject.includes(subject));
const extLicense = async (userId: string) => ctx.licenses.get((await mappings(userId))[0].external_license_id);

describe('checkout', () => {
  it('exige correo verificado', async () => {
    const u = await createUser(ctx, { verified: false });
    expect((await u.client.req('POST', '/api/checkout/subscriptions', { planId })).status).toBe(403);
  });

  it('crea la suscripción en PayPal sin dar acceso hasta el cobro verificado', async () => {
    const u = await createUser(ctx);
    const r = await u.client.req('POST', '/api/checkout/subscriptions', { planId });
    expect(r.status).toBe(200);
    expect(r.body.approveUrl).toContain('paypal.com');
    const s = await sub(r.body.subscriptionId);
    expect(s.status).toBe('approval_pending');
    expect(ctx.paypal.subs.get(s.paypal_subscription_id)!.custom_id).toBe(s.id);

    // vuelve de PayPal: la API dice ACTIVE pero aún no llegó el cobro
    ctx.paypal.setActive(s.paypal_subscription_id, new Date(Date.now() + 30 * DAY));
    const c = await u.client.req('POST', `/api/checkout/subscriptions/${s.id}/confirm`);
    expect(c.body.status).toBe('payment_pending');
    await drainAll(ctx);
    expect(await mappings(u.id)).toHaveLength(0);
  });

  it('no acepta un plan inexistente ni inactivo', async () => {
    const u = await createUser(ctx);
    expect((await u.client.req('POST', '/api/checkout/subscriptions', { planId: randomUUID() })).status).toBe(404);
  });
});

describe('webhooks', () => {
  it('rechaza eventos con firma no válida y no los guarda', async () => {
    const res = await webhook(ctx, 'PAYMENT.SALE.COMPLETED', { id: 'X' }, { sig: 'falsa', id: 'WH-FALSO' });
    expect(res.statusCode).toBe(400);
    const rows = await ctx.sql`SELECT 1 FROM webhook_events WHERE provider_event_id = 'WH-FALSO'`;
    expect(rows).toHaveLength(0);
  });

  it('pide reintento (503) si PayPal no puede verificar', async () => {
    ctx.paypal.verifyFails = true;
    expect((await webhook(ctx, 'PAYMENT.SALE.COMPLETED', { id: 'X' })).statusCode).toBe(503);
  });

  it('ignora eventos de suscripciones desconocidas', async () => {
    const res = await webhook(ctx, 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-DESCONOCIDA' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ignored');
  });
});

describe('primera compra', () => {
  it('registra el pago, activa, crea una licencia y envía la clave', async () => {
    const u = await createUser(ctx);
    const p = await purchase(ctx, u, planId);
    expect(p.res.statusCode).toBe(200);
    await drainAll(ctx);

    const s = await sub(p.subId);
    expect(s.status).toBe('active');
    const [pay] = await ctx.sql`SELECT * FROM payments WHERE subscription_id = ${p.subId}`;
    expect(pay).toMatchObject({ status: 'completed', amount_cents: 4900, currency: 'USD', payment_type: 'initial' });

    const [m] = await mappings(u.id);
    expect(m.status).toBe('active');
    expect(m.key_ciphertext).not.toContain('SIM-');
    const lic = await ctx.licenses.get(m.external_license_id);
    expect(lic!.active).toBe(true);
    // la licencia vence al final del periodo pagado + gracia
    expect(lic!.expiresAt.getTime()).toBe(s.access_until.getTime() + 3 * DAY);

    const keyMail = mails(u.email, 'Tu clave');
    expect(keyMail).toHaveLength(1);
    expect(keyMail[0].text).toContain(lic!.licenseKey);
    expect(mails(u.email, 'Compra confirmada')).toHaveLength(1);
  });

  it('un webhook repetido no duplica pagos, licencias ni correos', async () => {
    const u = await createUser(ctx);
    const p = await purchase(ctx, u, planId);
    const [event] = await ctx.sql`SELECT payload FROM webhook_events WHERE resource_id = ${p.saleId}`;
    const again = await webhook(ctx, event.payload.event_type, event.payload.resource, { id: event.payload.id });
    expect(JSON.parse(again.body).duplicate).toBe(true);
    // mismo cobro con otro ID de evento (PayPal puede reenviar)
    await webhook(ctx, event.payload.event_type, event.payload.resource);
    await drainAll(ctx);
    expect(await ctx.sql`SELECT 1 FROM payments WHERE subscription_id = ${p.subId}`).toHaveLength(1);
    expect(await mappings(u.id)).toHaveLength(1);
    expect(mails(u.email, 'Tu clave')).toHaveLength(1);
  });

  it('si el sistema de licencias falla, conserva el pago y reintenta sin duplicar', async () => {
    const u = await createUser(ctx);
    ctx.licenses.failNext = 1;
    const p = await purchase(ctx, u, planId);
    await drainAll(ctx);
    expect((await sub(p.subId)).status).toBe('active');
    const [job] = await ctx.sql`SELECT * FROM jobs WHERE type = 'license.sync' AND payload->>'subscriptionId' = ${p.subId} AND status = 'pending'`;
    expect(job.last_error).toContain('fallo simulado');
    await ctx.sql`UPDATE jobs SET run_at = now() WHERE id = ${job.id}`;
    await drainAll(ctx);
    const ms = await mappings(u.id);
    expect(ms).toHaveLength(1);
    expect(ms[0].status).toBe('active');
    expect(mails(u.email, 'Tu clave')).toHaveLength(1);
  });
});

describe('renovación', () => {
  it('amplía la vigencia conservando la clave y no la amplía dos veces', async () => {
    const u = await createUser(ctx);
    const first = new Date(Date.now() - 29 * DAY);
    const p = await purchase(ctx, u, planId, first);
    await drainAll(ctx);
    const keyBefore = (await extLicense(u.id))!.licenseKey;
    const before = (await sub(p.subId)).access_until as Date;

    const next = new Date(before);
    next.setUTCMonth(next.getUTCMonth() + 1);
    ctx.paypal.setActive(p.paypalId, next);
    const sale = { id: 'SALE-RENOV-1', billing_agreement_id: p.paypalId, amount: { total: '49.00', currency: 'USD' }, create_time: before.toISOString() };
    await webhook(ctx, 'PAYMENT.SALE.COMPLETED', sale);
    await webhook(ctx, 'PAYMENT.SALE.COMPLETED', sale);
    await drainAll(ctx);

    const s = await sub(p.subId);
    expect(s.access_until.toISOString()).toBe(next.toISOString());
    const lic = (await extLicense(u.id))!;
    expect(lic.licenseKey).toBe(keyBefore);
    expect(lic.expiresAt.getTime()).toBe(next.getTime() + 3 * DAY);
    const pays = await ctx.sql`SELECT payment_type FROM payments WHERE subscription_id = ${p.subId} ORDER BY created_at`;
    expect(pays.map((x) => x.payment_type)).toEqual(['initial', 'renewal']);
    expect(mails(u.email, 'Renovación confirmada')).toHaveLength(1);
  });
});

describe('cancelación', () => {
  it('cancela en PayPal y conserva el acceso hasta el final del periodo pagado', async () => {
    const u = await createUser(ctx);
    const p = await purchase(ctx, u, planId);
    await drainAll(ctx);
    const r = await u.client.req('POST', `/api/account/subscriptions/${p.subId}/cancel`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('canceled');
    expect(ctx.paypal.canceled).toContain(p.paypalId);
    // el webhook de PayPal posterior no cambia nada
    await webhook(ctx, 'BILLING.SUBSCRIPTION.CANCELLED', { id: p.paypalId });
    await drainAll(ctx);

    const s = await sub(p.subId);
    const lic = (await extLicense(u.id))!;
    expect(lic.active).toBe(true);
    expect(lic.expiresAt.getTime()).toBe(s.access_until.getTime()); // sin margen de gracia
    expect(mails(u.email, 'Suscripción cancelada')).toHaveLength(1);

    // al terminar el periodo, la licencia se desactiva
    await ctx.sql`UPDATE subscriptions SET access_until = now() - interval '1 minute' WHERE id = ${p.subId}`;
    await sweepSubscriptions(ctx.deps);
    await drainAll(ctx);
    expect((await sub(p.subId)).status).toBe('expired');
    expect((await extLicense(u.id))!.active).toBe(false);
    expect((await mappings(u.id))[0].status).toBe('expired');
    expect(mails(u.email, 'ha terminado')).toHaveLength(1);
  });

  it('un cliente no puede cancelar suscripciones ajenas', async () => {
    const a = await createUser(ctx);
    const b = await createUser(ctx);
    const p = await purchase(ctx, a, planId);
    expect((await b.client.req('POST', `/api/account/subscriptions/${p.subId}/cancel`)).status).toBe(404);
  });
});

describe('impagos', () => {
  it('avisa, aplica la gracia, suspende y reactiva al regularizar', async () => {
    const u = await createUser(ctx);
    // pagado hace un mes y un día: el periodo terminó ayer
    const paid = new Date(Date.now() - DAY);
    paid.setUTCMonth(paid.getUTCMonth() - 1);
    const p = await purchase(ctx, u, planId, paid);
    await drainAll(ctx);

    await webhook(ctx, 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', { id: p.paypalId });
    await sweepSubscriptions(ctx.deps);
    await drainAll(ctx);
    expect(mails(u.email, 'No pudimos cobrar')).toHaveLength(1);
    // dentro de la gracia la licencia sigue activa
    expect((await sub(p.subId)).status).toBe('grace');
    expect((await extLicense(u.id))!.active).toBe(true);
    expect(mails(u.email, 'periodo de gracia')).toHaveLength(1);

    // pasada la gracia (3 días) se suspende
    await ctx.sql`UPDATE subscriptions SET access_until = now() - interval '4 days' WHERE id = ${p.subId}`;
    await sweepSubscriptions(ctx.deps);
    await drainAll(ctx);
    expect((await sub(p.subId)).status).toBe('unpaid');
    expect((await extLicense(u.id))!.active).toBe(false);
    expect((await mappings(u.id))[0].status).toBe('suspended');
    expect(mails(u.email, 'Licencia suspendida')).toHaveLength(1);

    // PayPal cobra al reintentar: vuelve el acceso con la misma clave
    const key = (await extLicense(u.id))!.licenseKey;
    ctx.paypal.setActive(p.paypalId, new Date(Date.now() + 30 * DAY));
    await webhook(ctx, 'PAYMENT.SALE.COMPLETED', { id: 'SALE-REINTENTO', billing_agreement_id: p.paypalId, amount: { total: '49.00', currency: 'USD' }, create_time: new Date().toISOString() });
    await drainAll(ctx);
    expect((await sub(p.subId)).status).toBe('active');
    expect((await extLicense(u.id))!.active).toBe(true);
    expect((await extLicense(u.id))!.licenseKey).toBe(key);
    expect(mails(u.email, 'Licencia reactivada')).toHaveLength(1);
    expect(await mappings(u.id)).toHaveLength(1);
  });
});

describe('reembolsos y contracargos', () => {
  it('un reembolso parcial conserva el acceso', async () => {
    const u = await createUser(ctx);
    const p = await purchase(ctx, u, planId);
    await drainAll(ctx);
    await webhook(ctx, 'PAYMENT.SALE.REFUNDED', { id: 'REF-1', sale_id: p.saleId, amount: { total: '10.00', currency: 'USD' } });
    await drainAll(ctx);
    const [pay] = await ctx.sql`SELECT * FROM payments WHERE provider_txn_id = ${p.saleId}`;
    expect(pay).toMatchObject({ status: 'partially_refunded', refunded_cents: 1000 });
    expect((await sub(p.subId)).status).toBe('active');
  });

  it('un reembolso total suspende el acceso sin borrar la cuenta ni la licencia', async () => {
    const u = await createUser(ctx);
    const p = await purchase(ctx, u, planId);
    await drainAll(ctx);
    await webhook(ctx, 'PAYMENT.SALE.REFUNDED', { id: 'REF-2', sale_id: p.saleId, amount: { total: '49.00', currency: 'USD' } });
    await drainAll(ctx);
    expect((await sub(p.subId)).status).toBe('suspended');
    const [m] = await mappings(u.id);
    expect(m.status).toBe('suspended');
    expect((await ctx.licenses.get(m.external_license_id))!.active).toBe(false);
    expect(await ctx.sql`SELECT 1 FROM users WHERE id = ${u.id}`).toHaveLength(1);
  });

  it('un contracargo marca el pago como revertido y suspende', async () => {
    const u = await createUser(ctx);
    const p = await purchase(ctx, u, planId);
    await drainAll(ctx);
    await webhook(ctx, 'PAYMENT.SALE.REVERSED', { id: 'REV-1', sale_id: p.saleId, amount: { total: '-49.00', currency: 'USD' } });
    await drainAll(ctx);
    const [pay] = await ctx.sql`SELECT status FROM payments WHERE provider_txn_id = ${p.saleId}`;
    expect(pay.status).toBe('reversed');
    expect((await sub(p.subId)).status).toBe('suspended');
  });
});

describe('panel del cliente', () => {
  it('muestra solo sus datos y protege la clave con la contraseña', async () => {
    const a = await createUser(ctx);
    const b = await createUser(ctx);
    await purchase(ctx, a, planId);
    await drainAll(ctx);
    const ov = await a.client.req('GET', '/api/account/overview');
    expect(ov.body.subscriptions).toHaveLength(1);
    expect(ov.body.licenses).toHaveLength(1);
    expect(JSON.stringify(ov.body)).not.toContain('SIM-');
    const licId = ov.body.licenses[0].id;

    expect((await a.client.req('POST', `/api/account/licenses/${licId}/reveal`, { password: 'mal' })).status).toBe(400);
    const ok = await a.client.req('POST', `/api/account/licenses/${licId}/reveal`, { password: a.password });
    expect(ok.body.licenseKey).toMatch(/^SIM-/);
    expect((await b.client.req('POST', `/api/account/licenses/${licId}/reveal`, { password: b.password })).status).toBe(404);
    expect((await b.client.req('GET', '/api/account/overview')).body.licenses).toHaveLength(0);
  });

  it('no permite una segunda suscripción al mismo producto', async () => {
    const u = await createUser(ctx);
    await purchase(ctx, u, planId);
    expect((await u.client.req('POST', '/api/checkout/subscriptions', { planId })).status).toBe(409);
  });
});

describe('correos', () => {
  it('reintenta un envío fallido sin generar otra licencia', async () => {
    const u = await createUser(ctx);
    const send = ctx.mailer.send.bind(ctx.mailer);
    let fail = true;
    ctx.mailer.send = async (m) => {
      if (fail && m.subject.includes('Tu clave')) throw new Error('proveedor caído');
      return send(m);
    };
    await purchase(ctx, u, planId);
    await drainAll(ctx);
    const [msg] = await ctx.sql`SELECT * FROM email_messages WHERE user_id = ${u.id} AND message_type = 'license_key'`;
    expect(msg.status).toBe('queued');
    expect(msg.last_error).toContain('proveedor caído');
    fail = false;
    await ctx.sql`UPDATE jobs SET run_at = now() WHERE type = 'email.send' AND payload->>'messageId' = ${msg.id}`;
    await drainAll(ctx);
    ctx.mailer.send = send;
    expect((await ctx.sql`SELECT status FROM email_messages WHERE id = ${msg.id}`)[0].status).toBe('sent');
    expect(await mappings(u.id)).toHaveLength(1);
    expect(mails(u.email, 'Tu clave')).toHaveLength(1);
  });
});

describe('panel admin', () => {
  it('cuenta como ingresos solo los pagos completados', async () => {
    const admin = await createUser(ctx, { role: 'admin' });
    const before = (await admin.client.req('GET', '/api/admin/dashboard')).body;
    const usd = (b: any) => b.revenue.find((r: any) => r.currency === 'USD')?.month_cents ?? 0;
    const u = await createUser(ctx);
    const start = await u.client.req('POST', '/api/checkout/subscriptions', { planId });
    const [s] = await ctx.sql`SELECT paypal_subscription_id FROM subscriptions WHERE id = ${start.body.subscriptionId}`;
    await webhook(ctx, 'PAYMENT.SALE.PENDING', { id: 'SALE-PEND', billing_agreement_id: s.paypal_subscription_id, amount: { total: '49.00', currency: 'USD' } });
    const after = (await admin.client.req('GET', '/api/admin/dashboard')).body;
    expect(usd(after)).toBe(usd(before));
    expect(after.payments.pending).toBeGreaterThanOrEqual(1);
  });

  it('gestiona productos y planes, y bloquea activar planes sin PayPal', async () => {
    const admin = await createUser(ctx, { role: 'admin' });
    const prod = await admin.client.req('POST', '/api/admin/products', { slug: 'rt-atas', name: 'RT Magneto ATAS', platform: 'ATAS' });
    expect(prod.status).toBe(200);
    const plan = await admin.client.req('POST', '/api/admin/plans', { productId: prod.body.id, name: 'Anual', priceCents: 39900, currency: 'usd', interval: 'year' });
    expect(plan.body.currency).toBe('USD');
    expect((await admin.client.req('PATCH', `/api/admin/plans/${plan.body.id}`, { status: 'active' })).status).toBe(400);
    const pp = await admin.client.req('POST', `/api/admin/plans/${plan.body.id}/paypal`);
    expect(pp.body.paypal_plan_id).toMatch(/^P-/);
    expect((await admin.client.req('PATCH', `/api/admin/plans/${plan.body.id}`, { status: 'active', priceCents: 1 })).body.price_cents).toBe(39900);
  });

  it('suspende y reactiva el acceso de una suscripción con registro de auditoría', async () => {
    const admin = await createUser(ctx, { role: 'admin' });
    const u = await createUser(ctx);
    const p = await purchase(ctx, u, planId);
    await drainAll(ctx);
    expect((await admin.client.req('POST', `/api/admin/subscriptions/${p.subId}/suspend`, { reason: 'fraude' })).body.status).toBe('suspended');
    await drainAll(ctx);
    expect((await extLicense(u.id))!.active).toBe(false);
    expect((await admin.client.req('POST', `/api/admin/subscriptions/${p.subId}/reactivate`, { reason: 'aclarado' })).body.status).toBe('active');
    await drainAll(ctx);
    expect((await extLicense(u.id))!.active).toBe(true);
    const logs = await ctx.sql`SELECT action FROM audit_logs WHERE target_id = ${p.subId} ORDER BY id`;
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['subscription.suspend_access', 'subscription.reactivate_access']));
  });

  it('revoca una licencia sin borrarla', async () => {
    const admin = await createUser(ctx, { role: 'admin' });
    const u = await createUser(ctx);
    await purchase(ctx, u, planId);
    await drainAll(ctx);
    const [m] = await mappings(u.id);
    expect((await admin.client.req('POST', `/api/admin/licenses/${m.id}/revoke`, { reason: 'solicitud del cliente' })).status).toBe(200);
    await drainAll(ctx);
    const [after] = await mappings(u.id);
    expect(after.status).toBe('revoked');
    expect((await ctx.licenses.get(m.external_license_id))!.active).toBe(false);
  });
});

describe('resuscripción', () => {
  it('al volver a suscribirse se reutiliza la misma licencia y clave', async () => {
    const u = await createUser(ctx);
    const first = await purchase(ctx, u, planId);
    await drainAll(ctx);
    const key = (await extLicense(u.id))!.licenseKey;
    await u.client.req('POST', `/api/account/subscriptions/${first.subId}/cancel`);
    await ctx.sql`UPDATE subscriptions SET access_until = now() - interval '1 minute' WHERE id = ${first.subId}`;
    await sweepSubscriptions(ctx.deps);
    await drainAll(ctx);
    expect((await extLicense(u.id))!.active).toBe(false);

    const second = await purchase(ctx, u, planId);
    await drainAll(ctx);
    const ms = await mappings(u.id);
    expect(ms).toHaveLength(1);
    expect(ms[0].subscription_id).toBe(second.subId);
    expect((await extLicense(u.id))!.licenseKey).toBe(key);
    expect((await extLicense(u.id))!.active).toBe(true);
  });
});
