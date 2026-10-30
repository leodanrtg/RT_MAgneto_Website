import type postgres from 'postgres';
import type { Sql } from './db.ts';

export type Job = { id: string; type: string; payload: any; attempts: number; max_attempts: number };
export type JobHandler = (job: Job) => Promise<void>;

type EnqueueOptions = { key?: string; runAt?: Date; maxAttempts?: number };

// Cola de tareas sobre PostgreSQL: sin Redis ni procesos extra.
// La clave de idempotencia impide tener dos veces la misma tarea pendiente.
export async function enqueue(sql: Sql, type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}) {
  const [row] = await sql`
    INSERT INTO jobs (type, payload, idempotency_key, run_at, max_attempts)
    VALUES (${type}, ${sql.json(payload as postgres.JSONValue)}, ${opts.key ?? null},
            ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 8})
    ON CONFLICT (idempotency_key) WHERE status = 'pending' DO NOTHING
    RETURNING id`;
  return row?.id as string | undefined;
}

// Espera exponencial: 30 s, 1 min, 2 min… hasta 6 h.
export const backoffSeconds = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 6 * 3600);

export async function runDueJobs(sql: Sql, handlers: Record<string, JobHandler>, limit = 10) {
  // recupera tareas que quedaron "running" por un proceso caído
  await sql`UPDATE jobs SET status = 'pending', locked_at = NULL
            WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`;
  const jobs = await sql<Job[]>`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT ${limit})
    RETURNING id, type, payload, attempts, max_attempts`;
  let done = 0;
  for (const job of jobs) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`sin manejador para ${job.type}`);
      await handler(job);
      await sql`UPDATE jobs SET status = 'done', locked_at = NULL, last_error = NULL, updated_at = now() WHERE id = ${job.id}`;
      done++;
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 500);
      const dead = job.attempts >= job.max_attempts;
      // si mientras tanto se encoló la misma tarea, esta queda sustituida por la nueva
      await sql`
        UPDATE jobs SET status = CASE
            WHEN ${dead} THEN 'dead'
            WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.idempotency_key = jobs.idempotency_key AND j.status = 'pending') THEN 'done'
            ELSE 'pending' END,
          locked_at = NULL, last_error = ${message},
          run_at = now() + make_interval(secs => ${backoffSeconds(job.attempts)}), updated_at = now()
        WHERE id = ${job.id}`;
    }
  }
  return { claimed: jobs.length, done };
}
