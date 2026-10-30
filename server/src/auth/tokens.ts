import type { Sql } from '../db.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';

type Purpose = 'verify_email' | 'reset_password';

const TTL_MINUTES: Record<Purpose, number> = { verify_email: 48 * 60, reset_password: 60 };

// Solo se guarda el hash del token; el token en claro viaja únicamente en el correo.
export async function issueToken(sql: Sql, userId: string, purpose: Purpose): Promise<string> {
  const token = randomToken();
  await sql`UPDATE auth_tokens SET used_at = now() WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL`;
  await sql`
    INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
    VALUES (${userId}, ${purpose}, ${sha256(token)}, now() + make_interval(mins => ${TTL_MINUTES[purpose]}))`;
  return token;
}

// Marca el token como usado y devuelve su usuario, o null si no vale.
export async function consumeToken(sql: Sql, token: string, purpose: Purpose): Promise<string | null> {
  const [row] = await sql`
    UPDATE auth_tokens SET used_at = now()
    WHERE token_hash = ${sha256(token)} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id`;
  return row?.user_id ?? null;
}
