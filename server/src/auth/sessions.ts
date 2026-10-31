import type { Sql } from '../db.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';

export const SESSION_COOKIE = 'rt_session';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin';
  status: 'active' | 'suspended';
  email_verified_at: Date | null;
};

export type Session = { id: string; csrfToken: string; user: SessionUser };

export async function createSession(sql: Sql, userId: string, ttlDays: number, ip?: string, ua?: string) {
  const token = randomToken();
  const csrfToken = randomToken(24);
  await sql`
    INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, expires_at)
    VALUES (${sha256(token)}, ${userId}, ${csrfToken}, ${ip ?? null}, ${ua?.slice(0, 300) ?? null},
            now() + make_interval(days => ${ttlDays}))`;
  return { token, csrfToken };
}

export async function findSession(sql: Sql, token: string): Promise<Session | null> {
  const [row] = await sql`
    UPDATE sessions s SET last_seen_at = now()
    FROM users u
    WHERE s.id = ${sha256(token)} AND s.expires_at > now() AND u.id = s.user_id
    RETURNING s.id, s.csrf_token, u.id AS user_id, u.name, u.email, u.role, u.status, u.email_verified_at`;
  if (!row) return null;
  return {
    id: row.id,
    csrfToken: row.csrf_token,
    user: { id: row.user_id, name: row.name, email: row.email, role: row.role, status: row.status, email_verified_at: row.email_verified_at },
  };
}

export const deleteSession = (sql: Sql, sessionId: string) => sql`DELETE FROM sessions WHERE id = ${sessionId}`;

export const deleteUserSessions = (sql: Sql, userId: string, exceptSessionId?: string) =>
  exceptSessionId
    ? sql`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${exceptSessionId}`
    : sql`DELETE FROM sessions WHERE user_id = ${userId}`;
