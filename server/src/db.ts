import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type Sql = postgres.Sql;

export function connect(url: string, max = 10): Sql {
  return postgres(url, {
    max,
    onnotice: () => {},
    transform: { undefined: null },
  });
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Aplica en orden los .sql de migrations/ que aún no estén registrados.
// Cada archivo corre en su propia transacción con un bloqueo para que dos procesos no migren a la vez.
export async function migrate(sql: Sql, log: (msg: string) => void = () => {}): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const name of files) {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(727274)`;
      const [done] = await tx`SELECT 1 FROM schema_migrations WHERE name = ${name}`;
      if (done) return;
      await tx.unsafe(await readFile(path.join(MIGRATIONS_DIR, name), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      applied.push(name);
      log(`migración aplicada: ${name}`);
    });
  }
  return applied;
}
