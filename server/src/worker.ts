import type { Deps } from './app.ts';
import { refreshSubscription } from './billing/entitlements.ts';
import { emailJobHandler } from './email/queue.ts';
import { runDueJobs, type JobHandler } from './jobs.ts';
import { licenseJobHandler } from './licenses/sync.ts';

export function jobHandlers({ sql, config, mailer, licenses }: Deps): Record<string, JobHandler> {
  return {
    'email.send': emailJobHandler(sql, config, mailer),
    'license.sync': licenseJobHandler(sql, config, licenses),
  };
}

// Revisa vencimientos: pasa a gracia, impago o expirada las suscripciones cuyo periodo terminó
// y desactiva sus licencias. No depende de que llegue ningún webhook.
export async function sweepSubscriptions({ sql, config }: Deps, now = new Date()) {
  const rows = await sql`
    SELECT s.id FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.access_until IS NOT NULL AND s.status IN ('active', 'canceled', 'grace')
      AND s.access_until < ${now}`;
  for (const r of rows) await refreshSubscription(sql, config, r.id, now);
  return rows.length;
}

// Bucle del proceso de tareas: cola cada pocos segundos, barrido de vencimientos cada 10 minutos.
export function startWorker(deps: Deps, log: (msg: string, err?: unknown) => void) {
  const handlers = jobHandlers(deps);
  let stopped = false;
  let lastSweep = 0;
  const tick = async () => {
    if (stopped) return;
    try {
      if (Date.now() - lastSweep > 10 * 60_000) {
        lastSweep = Date.now();
        await sweepSubscriptions(deps);
      }
      await runDueJobs(deps.sql, handlers);
    } catch (err) {
      log('error en el proceso de tareas', err);
    }
    if (!stopped) timer = setTimeout(tick, 5_000);
  };
  let timer = setTimeout(tick, 1_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
