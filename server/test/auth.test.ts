import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createUser, drainAll, setup, type Ctx } from './helpers.ts';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.app.close(); await ctx.sql.end(); });

const lastLink = (to: string, param: string) => {
  const mail = [...ctx.mailer.sent].reverse().find((m) => m.to === to && m.text.includes(param));
  return new URL(mail!.text.match(/https?:\/\/\S+/g)!.find((l) => l.includes(param))!).searchParams.get(param)!;
};

describe('registro y verificación', () => {
  it('registra, envía verificación y confirma el correo', async () => {
    const c = new Client(ctx);
    const r = await c.req('POST', '/api/auth/register', { name: 'Ana', email: 'Ana@Test.dev', password: 'una-clave-larga' });
    expect(r.status).toBe(202);
    await drainAll(ctx);
    const token = lastLink('ana@test.dev', 'verificar');
    expect((await c.req('POST', '/api/auth/verify-email', { token })).status).toBe(200);
    // el token es de un solo uso
    expect((await c.req('POST', '/api/auth/verify-email', { token })).status).toBe(400);
    const login = await c.login('ana@test.dev', 'una-clave-larga');
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true);
    const [row] = await ctx.sql`SELECT password_hash FROM users WHERE email = 'ana@test.dev'`;
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('no revela si un correo ya está registrado y no duplica cuentas', async () => {
    const c = new Client(ctx);
    const r = await c.req('POST', '/api/auth/register', { name: 'Otra', email: 'ana@test.dev', password: 'otra-clave-larga' });
    expect(r.status).toBe(202);
    const [{ n }] = await ctx.sql`SELECT count(*)::int AS n FROM users WHERE lower(email) = 'ana@test.dev'`;
    expect(n).toBe(1);
  });

  it('valida el formulario', async () => {
    const r = await new Client(ctx).req('POST', '/api/auth/register', { name: '', email: 'no-es-correo', password: 'corta' });
    expect(r.status).toBe(400);
    expect(r.body.fields.map((f: any) => f.field).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('inicio de sesión', () => {
  it('rechaza credenciales incorrectas y bloquea tras varios fallos', async () => {
    const u = await createUser(ctx);
    const c = new Client(ctx);
    for (let i = 0; i < ctx.config.LOGIN_MAX_FAILURES; i++) {
      expect((await c.login(u.email, 'incorrecta')).status).toBe(401);
    }
    expect((await c.login(u.email, u.password)).status).toBe(429);
  });

  it('cierra sesión e invalida la cookie', async () => {
    const u = await createUser(ctx);
    expect((await u.client.req('GET', '/api/auth/me')).status).toBe(200);
    const old = u.client.cookie;
    await u.client.req('POST', '/api/auth/logout');
    const again = new Client(ctx);
    again.cookie = old;
    expect((await again.req('GET', '/api/auth/me')).status).toBe(401);
  });

  it('una cuenta suspendida no puede entrar', async () => {
    const u = await createUser(ctx);
    await ctx.sql`UPDATE users SET status = 'suspended' WHERE id = ${u.id}`;
    expect((await new Client(ctx).login(u.email, u.password)).status).toBe(403);
    expect((await u.client.req('GET', '/api/account/overview')).status).toBe(403);
  });
});

describe('contraseñas', () => {
  it('recupera la contraseña con enlace de un solo uso y cierra las sesiones', async () => {
    const u = await createUser(ctx);
    const c = new Client(ctx);
    expect((await c.req('POST', '/api/auth/forgot-password', { email: u.email })).status).toBe(202);
    expect((await c.req('POST', '/api/auth/forgot-password', { email: 'nadie@test.dev' })).status).toBe(202);
    await drainAll(ctx);
    const token = lastLink(u.email, 'restablecer');
    expect((await c.req('POST', '/api/auth/reset-password', { token, password: 'nueva-clave-segura' })).status).toBe(200);
    expect((await c.req('POST', '/api/auth/reset-password', { token, password: 'otra-clave-segura' })).status).toBe(400);
    expect((await u.client.req('GET', '/api/auth/me')).status).toBe(401);
    expect((await c.login(u.email, 'nueva-clave-segura')).status).toBe(200);
  });

  it('cambia la contraseña pidiendo la actual', async () => {
    const u = await createUser(ctx);
    expect((await u.client.req('POST', '/api/auth/change-password', { currentPassword: 'mal', newPassword: 'nueva-clave-segura' })).status).toBe(400);
    expect((await u.client.req('POST', '/api/auth/change-password', { currentPassword: u.password, newPassword: 'nueva-clave-segura' })).status).toBe(200);
    expect((await new Client(ctx).login(u.email, 'nueva-clave-segura')).status).toBe(200);
  });
});

describe('seguridad', () => {
  it('exige token CSRF en peticiones con sesión', async () => {
    const u = await createUser(ctx);
    const csrf = u.client.csrf;
    u.client.csrf = undefined;
    expect((await u.client.req('PATCH', '/api/account/profile', { name: 'X' })).status).toBe(403);
    u.client.csrf = csrf;
    expect((await u.client.req('PATCH', '/api/account/profile', { name: 'X' })).status).toBe(200);
  });

  it('rechaza peticiones desde otro origen', async () => {
    const r = await new Client(ctx).req('POST', '/api/auth/login', { email: 'a@b.cd', password: 'x' }, { origin: 'https://malicioso.example' });
    expect(r.status).toBe(403);
  });

  it('rechaza cuerpos text/plain (formularios cruzados)', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: '{"email":"a@b.cd","password":"x"}', headers: { 'content-type': 'text/plain' } });
    expect(res.statusCode).toBe(415);
  });

  it('un cliente no accede al panel admin, ni modificando la petición', async () => {
    const u = await createUser(ctx);
    expect((await u.client.req('GET', '/api/admin/dashboard')).status).toBe(403);
    expect((await u.client.req('PATCH', '/api/account/profile', { name: 'Y', role: 'admin' })).status).toBe(200);
    const [row] = await ctx.sql`SELECT role FROM users WHERE id = ${u.id}`;
    expect(row.role).toBe('customer');
    const admin = await createUser(ctx, { role: 'admin' });
    expect((await admin.client.req('GET', '/api/admin/dashboard')).status).toBe(200);
  });
});
