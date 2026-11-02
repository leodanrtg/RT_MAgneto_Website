import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Sql } from './db.ts';
import type { Mailer } from './email/mailer.ts';
import type { LicenseEngine } from './licenses/engine.ts';
import type { PayPalApi } from './billing/paypal.ts';
import { HttpError, forbidden, unauthorized } from './lib/errors.ts';
import { safeEqual } from './lib/crypto.ts';
import { pickLang, translate } from './lib/i18n.ts';
import { SESSION_COOKIE, findSession, type Session } from './auth/sessions.ts';
import { authRoutes } from './auth/routes.ts';
import { catalogRoutes } from './billing/catalog-routes.ts';
import { checkoutRoutes } from './billing/checkout-routes.ts';
import { webhookRoutes } from './billing/webhook-routes.ts';
import { accountRoutes } from './account/routes.ts';
import { adminRoutes } from './admin/routes.ts';

export type Deps = {
  sql: Sql;
  config: Config;
  mailer: Mailer;
  licenses: LicenseEngine;
  paypal: PayPalApi;
};

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(deps: Deps) {
  const { config, sql } = deps;
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    logger: config.NODE_ENV === 'test' ? false : {
      level: 'info',
      // nunca registrar cookies, cabeceras de autorización ni cuerpos
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
    },
  });

  // Solo JSON: text/plain permitiría formularios cruzados sin preflight (CSRF).
  app.removeContentTypeParser('text/plain');

  await app.register(cookie);
  await app.register(rateLimit, { max: config.RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' });

  app.decorateRequest('session', null);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
  });

  // Mensajes de respuesta en el idioma de la página (Accept-Language).
  app.addHook('preSerialization', async (req, _reply, payload: any) => {
    if (!payload || typeof payload !== 'object') return payload;
    const lang = pickLang(req.headers['accept-language']);
    if (lang === 'es' || (typeof payload.message !== 'string' && !Array.isArray(payload.fields))) return payload;
    const out = { ...payload };
    if (typeof out.message === 'string') out.message = translate(out.message, lang);
    if (Array.isArray(out.fields)) out.fields = out.fields.map((f: { message: string }) => ({ ...f, message: translate(f.message, lang) }));
    return out;
  });

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.session = await findSession(sql, token);

    if (!UNSAFE.has(req.method) || req.url.startsWith('/api/webhooks/')) return;
    // Protección CSRF: el origen debe ser la propia web y, con sesión, el token CSRF debe coincidir.
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.APP_URL).origin) throw forbidden();
    if (req.session) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, req.session.csrfToken)) {
        throw new HttpError(403, 'csrf', 'La sesión caducó. Recarga la página.');
      }
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation',
        message: 'Revisa los datos del formulario.',
        fields: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Demasiados intentos. Espera un momento.' });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: 'bad_request', message: 'Solicitud no válida.' });
    req.log.error({ err }, 'error no controlado');
    return reply.status(500).send({ error: 'internal', message: 'Error interno. Inténtalo de nuevo.' });
  });

  app.get('/api/health', async () => {
    await sql`SELECT 1`;
    return { ok: true };
  });

  await app.register(authRoutes(deps), { prefix: '/api/auth' });
  await app.register(catalogRoutes(deps), { prefix: '/api/catalog' });
  await app.register(checkoutRoutes(deps), { prefix: '/api/checkout' });
  await app.register(webhookRoutes(deps), { prefix: '/api/webhooks' });
  await app.register(accountRoutes(deps), { prefix: '/api/account' });
  await app.register(adminRoutes(deps), { prefix: '/api/admin' });

  return app;
}

export function requireUser(req: FastifyRequest): Session {
  if (!req.session) throw unauthorized();
  if (req.session.user.status !== 'active') throw new HttpError(403, 'account_suspended', 'Tu cuenta está suspendida. Contacta con soporte.');
  return req.session;
}

export function requireAdmin(req: FastifyRequest): Session {
  const s = requireUser(req);
  if (s.user.role !== 'admin') throw forbidden();
  return s;
}

export const clientIp = (req: FastifyRequest) => req.ip;

export function setSessionCookie(reply: FastifyReply, config: Config, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_DAYS * 86400,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: config.secureCookies, sameSite: 'lax' });
}
