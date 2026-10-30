import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.ts';
import { clearSessionCookie, clientIp, requireUser, setSessionCookie, type Deps } from '../app.ts';
import { queueEmail } from '../email/queue.ts';
import { HttpError, badRequest } from '../lib/errors.ts';
import { dummyHash, hashPassword, verifyPassword } from './passwords.ts';
import { createSession, deleteSession, deleteUserSessions } from './sessions.ts';
import { consumeToken, issueToken } from './tokens.ts';

const email = z.email('Correo no válido').max(254).transform((v) => v.trim().toLowerCase());
const password = z.string().min(10, 'Mínimo 10 caracteres').max(200);

const RegisterBody = z.object({ name: z.string().trim().min(1).max(120), email, password });
const LoginBody = z.object({ email, password: z.string().min(1).max(200) });
const TokenBody = z.object({ token: z.string().min(10).max(200) });
const ForgotBody = z.object({ email });
const ResetBody = z.object({ token: z.string().min(10).max(200), password });
const ChangeBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });

export const publicUser = (u: { id: string; name: string; email: string; role: string; email_verified_at: Date | null }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  emailVerified: Boolean(u.email_verified_at),
});

export function authRoutes({ sql, config }: Deps) {
  const strict = { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } };

  async function sendVerification(user: { id: string; name: string; email: string }) {
    const token = await issueToken(sql, user.id, 'verify_email');
    await queueEmail(sql, config, {
      userId: user.id, to: user.email, type: 'verify_email', key: `verify:${user.id}:${token.slice(0, 12)}`,
      data: { name: user.name, link: `${config.APP_URL}/entrar/?verificar=${token}` },
    });
  }

  return async (app: FastifyInstance) => {
    // Respuesta idéntica exista o no la cuenta, para no revelar qué correos están registrados.
    app.post('/register', { config: strict }, async (req, reply) => {
      const body = RegisterBody.parse(req.body);
      const passwordHash = await hashPassword(body.password);
      const [user] = await sql<{ id: string; name: string; email: string }[]>`
        INSERT INTO users (name, email, password_hash) VALUES (${body.name}, ${body.email}, ${passwordHash})
        ON CONFLICT (lower(email)) DO NOTHING
        RETURNING id, name, email`;
      if (user) {
        await audit(sql, { actorUserId: user.id, action: 'user.register', targetType: 'user', targetId: user.id, ip: clientIp(req) });
        await sendVerification(user);
      } else {
        const [existing] = await sql`SELECT id, name FROM users WHERE lower(email) = ${body.email}`;
        await queueEmail(sql, config, {
          userId: existing.id, to: body.email, type: 'account_exists', key: `exists:${existing.id}:${new Date().toISOString().slice(0, 13)}`,
          data: { name: existing.name },
        });
      }
      return reply.status(202).send({ message: 'Te enviamos un correo para confirmar tu dirección.' });
    });

    app.post('/verify-email', { config: strict }, async (req) => {
      const { token } = TokenBody.parse(req.body);
      const userId = await consumeToken(sql, token, 'verify_email');
      if (!userId) throw badRequest('invalid_token', 'El enlace no es válido o ya caducó.');
      const [user] = await sql`
        UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
        WHERE id = ${userId} RETURNING id, name, email`;
      await queueEmail(sql, config, { userId, to: user.email, type: 'welcome', key: `welcome:${userId}`, data: { name: user.name } });
      await audit(sql, { actorUserId: userId, action: 'user.verify_email', targetType: 'user', targetId: userId, ip: clientIp(req) });
      return { message: 'Correo confirmado.' };
    });

    app.post('/resend-verification', { config: strict }, async (req) => {
      const { user } = requireUser(req);
      if (!user.email_verified_at) await sendVerification(user);
      return { message: 'Correo enviado.' };
    });

    app.post('/login', { config: strict }, async (req, reply) => {
      const body = LoginBody.parse(req.body);
      const [{ failures }] = await sql`
        SELECT count(*)::int AS failures FROM login_attempts
        WHERE lower(email) = ${body.email} AND NOT success
          AND created_at > now() - make_interval(mins => ${config.LOGIN_WINDOW_MINUTES})`;
      if (failures >= config.LOGIN_MAX_FAILURES) {
        throw new HttpError(429, 'locked', 'Demasiados intentos fallidos. Espera unos minutos o recupera tu contraseña.');
      }
      const [user] = await sql<{ id: string; name: string; email: string; role: string; status: string; password_hash: string; email_verified_at: Date | null }[]>`SELECT id, name, email, role, status, password_hash, email_verified_at FROM users WHERE lower(email) = ${body.email}`;
      const ok = user ? await verifyPassword(user.password_hash, body.password) : (await verifyPassword(await dummyHash(), body.password), false);
      await sql`INSERT INTO login_attempts (email, ip, success) VALUES (${body.email}, ${clientIp(req)}, ${ok})`;
      if (!ok) throw new HttpError(401, 'invalid_credentials', 'Correo o contraseña incorrectos.');
      if (user.status !== 'active') throw new HttpError(403, 'account_suspended', 'Tu cuenta está suspendida. Contacta con soporte.');

      const { token, csrfToken } = await createSession(sql, user.id, config.SESSION_TTL_DAYS, clientIp(req), req.headers['user-agent']);
      setSessionCookie(reply, config, token);
      await audit(sql, { actorUserId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, ip: clientIp(req) });
      return { user: publicUser(user), csrfToken };
    });

    app.post('/logout', async (req, reply) => {
      if (req.session) await deleteSession(sql, req.session.id);
      clearSessionCookie(reply, config);
      return { message: 'Sesión cerrada.' };
    });

    app.get('/me', async (req) => {
      const s = requireUser(req);
      return { user: publicUser(s.user), csrfToken: s.csrfToken };
    });

    app.post('/forgot-password', { config: strict }, async (req, reply) => {
      const body = ForgotBody.parse(req.body);
      const [user] = await sql`SELECT id, name, email FROM users WHERE lower(email) = ${body.email} AND status = 'active'`;
      if (user) {
        const token = await issueToken(sql, user.id, 'reset_password');
        await queueEmail(sql, config, {
          userId: user.id, to: user.email, type: 'password_reset', key: `reset:${user.id}:${token.slice(0, 12)}`,
          data: { name: user.name, link: `${config.APP_URL}/entrar/?restablecer=${token}` },
        });
      }
      return reply.status(202).send({ message: 'Si el correo está registrado, recibirás un enlace para restablecer la contraseña.' });
    });

    app.post('/reset-password', { config: strict }, async (req) => {
      const body = ResetBody.parse(req.body);
      const userId = await consumeToken(sql, body.token, 'reset_password');
      if (!userId) throw badRequest('invalid_token', 'El enlace no es válido o ya caducó.');
      // el enlace llegó a su correo: también lo damos por verificado
      await sql`UPDATE users SET password_hash = ${await hashPassword(body.password)},
                email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = ${userId}`;
      await deleteUserSessions(sql, userId);
      await audit(sql, { actorUserId: userId, action: 'user.reset_password', targetType: 'user', targetId: userId, ip: clientIp(req) });
      return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
    });

    app.post('/change-password', { config: strict }, async (req) => {
      const s = requireUser(req);
      const body = ChangeBody.parse(req.body);
      const [user] = await sql`SELECT password_hash FROM users WHERE id = ${s.user.id}`;
      if (!(await verifyPassword(user.password_hash, body.currentPassword))) {
        throw badRequest('invalid_password', 'La contraseña actual no es correcta.');
      }
      await sql`UPDATE users SET password_hash = ${await hashPassword(body.newPassword)}, updated_at = now() WHERE id = ${s.user.id}`;
      await deleteUserSessions(sql, s.user.id, s.id);
      await audit(sql, { actorUserId: s.user.id, action: 'user.change_password', targetType: 'user', targetId: s.user.id, ip: clientIp(req) });
      return { message: 'Contraseña cambiada. Se cerraron tus otras sesiones.' };
    });
  };
}
