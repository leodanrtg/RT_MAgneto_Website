import { loadConfig } from './config.ts';
import { connect } from './db.ts';
import { createMailer } from './email/mailer.ts';
import { createLicenseEngine } from './licenses/engine.ts';
import { PayPalClient } from './billing/paypal.ts';
import type { Deps } from './app.ts';

export function createDeps(): Deps {
  const config = loadConfig();
  return {
    config,
    sql: connect(config.DATABASE_URL),
    mailer: createMailer(config),
    licenses: createLicenseEngine(config),
    paypal: new PayPalClient(config),
  };
}
