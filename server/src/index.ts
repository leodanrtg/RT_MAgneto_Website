import { buildApp } from './app.ts';
import { createDeps } from './deps.ts';
import { startWorker } from './worker.ts';

// Proceso único: API + tareas en segundo plano. Con RUN_WORKER=false se puede separar el worker
// (npm run worker) en otro proceso.
const deps = createDeps();
const app = await buildApp(deps);
if (deps.licenses.kind === 'simulated') app.log.warn('LICENSE_ENGINE=simulated: las licencias NO se crean en el sistema real');
const stopWorker = process.env.RUN_WORKER === 'false' ? () => {} : startWorker(deps, (msg, err) => app.log.error({ err }, msg));

await app.listen({ port: deps.config.PORT, host: deps.config.HOST });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stopWorker();
    await app.close();
    await deps.sql.end({ timeout: 5 });
    process.exit(0);
  });
}
