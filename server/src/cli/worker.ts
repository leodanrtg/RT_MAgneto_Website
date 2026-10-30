import { createDeps } from '../deps.ts';
import { startWorker } from '../worker.ts';

const deps = createDeps();
const stop = startWorker(deps, (msg, err) => console.error(msg, (err as Error)?.message ?? ''));
console.log('Proceso de tareas en marcha.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stop();
    await deps.sql.end({ timeout: 5 });
    process.exit(0);
  });
}
