import type postgres from 'postgres';
import type { Sql } from './db.ts';

type Entry = {
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

// Registro de acciones sensibles. Nunca se guardan claves, contraseñas ni tokens en metadata.
export async function audit(sql: Sql, e: Entry): Promise<void> {
  await sql`
    INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip)
    VALUES (${e.actorUserId ?? null}, ${e.action}, ${e.targetType ?? null}, ${e.targetId ?? null},
            ${sql.json((e.metadata ?? {}) as postgres.JSONValue)}, ${e.ip ?? null})`;
}
