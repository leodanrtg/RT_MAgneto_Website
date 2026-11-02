import type { Config } from '../config.ts';
import type { Sql } from '../db.ts';
import { audit } from '../audit.ts';
import { queueEmail } from '../email/queue.ts';
import { encrypt } from '../lib/crypto.ts';
import type { Job } from '../jobs.ts';
import { deriveStatus, desiredLicense, formatDate, loadSubscription } from '../billing/entitlements.ts';
import { LicenseEngineError, type LicenseEngine } from './engine.ts';

const SAME_INSTANT_MS = 60_000;

// Lleva la licencia del sistema actual al estado que corresponde a la suscripción.
// Se puede repetir sin efectos duplicados:
//  - una sola licencia viva por cliente y producto (índice único);
//  - la creación usa license_mappings.id como referencia, así que tras un fallo se recupera la ya creada;
//  - la clave se conserva en renovaciones y resuscripciones: solo cambian vigencia y estado.
export async function syncLicenseForSubscription(db: Sql, config: Config, engine: LicenseEngine, subscriptionId: string) {
  const owner = await loadSubscription(db, { id: subscriptionId });
  if (!owner) return;
  // una sola sincronización a la vez por cliente y producto
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`license:${owner.user_id}:${owner.product_id}`}))`;
    await syncLocked(tx as unknown as Sql, config, engine, subscriptionId);
  });
}

async function syncLocked(sql: Sql, config: Config, engine: LicenseEngine, subscriptionId: string) {
  const sub = (await loadSubscription(sql, { id: subscriptionId }))!;
  const status = deriveStatus(sub, new Date());
  const desired = desiredLicense(sub, status);
  if (!desired) return;

  let [mapping] = await sql`
    SELECT * FROM license_mappings WHERE user_id = ${sub.user_id} AND product_id = ${sub.product_id} AND status <> 'revoked'`;
  if (!mapping) {
    if (!desired.active) return;
    await sql`
      INSERT INTO license_mappings (user_id, product_id, subscription_id) VALUES (${sub.user_id}, ${sub.product_id}, ${sub.id})
      ON CONFLICT DO NOTHING`;
    [mapping] = await sql`
      SELECT * FROM license_mappings WHERE user_id = ${sub.user_id} AND product_id = ${sub.product_id} AND status <> 'revoked'`;
  }
  // Una suscripción antigua no debe tocar la licencia que ya gobierna otra suscripción más nueva.
  if (mapping.subscription_id && mapping.subscription_id !== sub.id) {
    const [current] = await sql`SELECT created_at FROM subscriptions WHERE id = ${mapping.subscription_id}`;
    const [mine] = await sql`SELECT created_at FROM subscriptions WHERE id = ${sub.id}`;
    if (current && current.created_at > mine.created_at) return;
    await sql`UPDATE license_mappings SET subscription_id = ${sub.id}, updated_at = now() WHERE id = ${mapping.id}`;
  }

  const [product] = await sql`SELECT license_product_ref, platform FROM products WHERE id = ${sub.product_id}`;
  const previous = mapping.status as string;

  if (!mapping.external_license_id) {
    const lic = (await engine.findByReference(mapping.id)) ?? (await engine.create({
      reference: mapping.id,
      customerName: sub.user_name,
      customerEmail: sub.user_email,
      productRef: product.license_product_ref,
      expiresAt: desired.expiresAt,
    }));
    await sql`
      UPDATE license_mappings SET external_license_id = ${lic.licenseId},
        key_ciphertext = ${encrypt(lic.licenseKey, config.DATA_ENCRYPTION_KEY)}, key_hint = ${lic.licenseKey.slice(-4)},
        updated_at = now()
      WHERE id = ${mapping.id}`;
    mapping.external_license_id = lic.licenseId;
    await audit(sql, { action: 'license.created', targetType: 'license_mapping', targetId: mapping.id, metadata: { externalId: lic.licenseId, engine: engine.kind } });
    await queueEmail(sql, config, {
      userId: sub.user_id, to: sub.user_email, type: 'license_key', key: `license_key:${mapping.id}`,
      data: { name: sub.user_name, product: sub.product_name, plan: sub.plan_name, platform: product.platform, licenseKey: lic.licenseKey, date: formatDate(desired.expiresAt) },
    });
  }

  const lic = await engine.get(mapping.external_license_id);
  if (!lic) throw new LicenseEngineError(`la licencia ${mapping.external_license_id} ya no existe en el sistema de licencias`, false);
  if (Math.abs(lic.expiresAt.getTime() - desired.expiresAt.getTime()) > SAME_INSTANT_MS) {
    await engine.setExpiry(lic.licenseId, desired.expiresAt);
  }
  if (lic.active !== desired.active) await engine.setActive(lic.licenseId, desired.active);

  const next = desired.active ? 'active' : status === 'expired' ? 'expired' : 'suspended';
  await sql`
    UPDATE license_mappings SET status = ${next}, expires_at = ${desired.expiresAt}, last_synced_at = now(), updated_at = now()
    WHERE id = ${mapping.id}`;

  const base = { userId: sub.user_id, to: sub.user_email };
  const data = { name: sub.user_name, product: sub.product_name, date: formatDate(desired.expiresAt) };
  if (next === 'suspended' && previous === 'active') {
    await queueEmail(sql, config, { ...base, type: 'license_suspended', key: `lic_susp:${mapping.id}:${sub.access_until?.toISOString()}:${sub.access_revoked_at?.toISOString()}`, data });
  }
  if (next === 'active' && (previous === 'suspended' || previous === 'expired')) {
    await queueEmail(sql, config, { ...base, type: 'license_reactivated', key: `lic_react:${mapping.id}:${desired.expiresAt.toISOString()}`, data });
  }
}

export function licenseJobHandler(sql: Sql, config: Config, engine: LicenseEngine) {
  return async (job: Job) => {
    try {
      await syncLicenseForSubscription(sql, config, engine, job.payload.subscriptionId);
    } catch (err) {
      // un error no recuperable no se reintenta: queda para revisión en el panel admin
      if (err instanceof LicenseEngineError && !err.retryable) {
        await sql`UPDATE jobs SET max_attempts = attempts WHERE id = ${job.id}`;
      }
      throw err;
    }
  };
}
