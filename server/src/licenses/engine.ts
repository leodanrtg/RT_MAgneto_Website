import { createHmac, randomBytes } from 'node:crypto';
import type { Config } from '../config.ts';

// Contrato entre la plataforma comercial y el sistema de licencias existente.
// La implementación real depende de la auditoría del servidor de licencias (pendiente).
export type ExternalLicense = {
  licenseId: string;
  licenseKey: string;
  customerName: string;
  productRef: string | null;
  hwid: string | null;
  active: boolean;
  expiresAt: Date;
  createdAt: Date | null;
};

export type CreateLicenseInput = {
  // ID estable de la plataforma (license_mappings.id): permite saber si ya se creó tras un fallo
  reference: string;
  customerName: string;
  customerEmail: string;
  productRef: string | null;
  expiresAt: Date;
};

export interface LicenseEngine {
  readonly kind: 'simulated' | 'bridge';
  findByReference(reference: string): Promise<ExternalLicense | null>;
  get(licenseId: string): Promise<ExternalLicense | null>;
  create(input: CreateLicenseInput): Promise<ExternalLicense>;
  setExpiry(licenseId: string, expiresAt: Date): Promise<void>;
  setActive(licenseId: string, active: boolean): Promise<void>;
  list(query: { search?: string; limit: number; offset: number }): Promise<{ items: ExternalLicense[]; total: number }>;
}

export class LicenseEngineError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}

// SIMULADOR: no habla con el sistema real. Solo para desarrollo y pruebas automatizadas.
// Las claves empiezan por "SIM-" para que nunca se confundan con claves reales.
export class SimulatedLicenseEngine implements LicenseEngine {
  readonly kind = 'simulated' as const;
  private byId = new Map<string, ExternalLicense & { reference: string }>();
  failNext = 0; // para pruebas de fallos de red

  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw new LicenseEngineError('fallo simulado de red');
    }
  }

  async findByReference(reference: string) {
    this.maybeFail();
    return [...this.byId.values()].find((l) => l.reference === reference) ?? null;
  }
  async get(licenseId: string) {
    this.maybeFail();
    return this.byId.get(licenseId) ?? null;
  }
  async create(input: CreateLicenseInput) {
    this.maybeFail();
    const existing = await this.findByReference(input.reference);
    if (existing) return existing;
    const licenseId = String(this.byId.size + 1000);
    const key = `SIM-${randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`;
    const lic = {
      reference: input.reference, licenseId, licenseKey: key, customerName: input.customerName,
      productRef: input.productRef, hwid: null, active: true, expiresAt: input.expiresAt, createdAt: new Date(),
    };
    this.byId.set(licenseId, lic);
    return lic;
  }
  async setExpiry(licenseId: string, expiresAt: Date) {
    this.maybeFail();
    const l = this.byId.get(licenseId);
    if (!l) throw new LicenseEngineError('licencia inexistente', false);
    l.expiresAt = expiresAt;
  }
  async setActive(licenseId: string, active: boolean) {
    this.maybeFail();
    const l = this.byId.get(licenseId);
    if (!l) throw new LicenseEngineError('licencia inexistente', false);
    l.active = active;
  }
  async list({ search, limit, offset }: { search?: string; limit: number; offset: number }) {
    const s = search?.toLowerCase();
    const all = [...this.byId.values()].filter((l) => !s || l.customerName.toLowerCase().includes(s) || l.licenseId === s);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
}

// Cliente del "puente" de licencias: un servicio pequeño que correría junto al servidor de licencias
// y reutilizaría su lógica (opción 2 del informe). Contrato en docs/plataforma-comercial/puente-licencias.md.
// NO VERIFICADO: el lado servidor se escribe cuando se audite el código del sistema actual.
export class BridgeLicenseEngine implements LicenseEngine {
  readonly kind = 'bridge' as const;
  constructor(private url: string, private secret: string) {
    if (!url || !secret) throw new Error('LICENSE_BRIDGE_URL y LICENSE_BRIDGE_SECRET son obligatorios');
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', this.secret).update(`${ts}.${method}.${path}.${payload}`).digest('hex');
    let res: Response;
    try {
      res = await fetch(new URL(path, this.url), {
        method,
        headers: { 'Content-Type': 'application/json', 'X-RT-Timestamp': ts, 'X-RT-Signature': sig },
        body: payload || undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new LicenseEngineError(`puente de licencias inaccesible: ${(err as Error).message}`);
    }
    if (res.status === 404) return null as T;
    if (!res.ok) throw new LicenseEngineError(`puente de licencias respondió ${res.status}`, res.status >= 500 || res.status === 429);
    return (res.status === 204 ? null : await res.json()) as T;
  }

  private parse = (l: any): ExternalLicense | null =>
    l && { ...l, expiresAt: new Date(l.expiresAt), createdAt: l.createdAt ? new Date(l.createdAt) : null };

  async findByReference(reference: string) {
    return this.parse(await this.call('GET', `/licenses/by-reference/${encodeURIComponent(reference)}`));
  }
  async get(licenseId: string) {
    return this.parse(await this.call('GET', `/licenses/${encodeURIComponent(licenseId)}`));
  }
  async create(input: CreateLicenseInput) {
    return this.parse(await this.call('POST', '/licenses', { ...input, expiresAt: input.expiresAt.toISOString() }))!;
  }
  async setExpiry(licenseId: string, expiresAt: Date) {
    await this.call('POST', `/licenses/${encodeURIComponent(licenseId)}/expiry`, { expiresAt: expiresAt.toISOString() });
  }
  async setActive(licenseId: string, active: boolean) {
    await this.call('POST', `/licenses/${encodeURIComponent(licenseId)}/${active ? 'activate' : 'deactivate'}`, {});
  }
  async list({ search, limit, offset }: { search?: string; limit: number; offset: number }) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(search ? { search } : {}) });
    const data = await this.call<{ items: any[]; total: number }>('GET', `/licenses?${q}`);
    return { items: data.items.map((l) => this.parse(l)!), total: data.total };
  }
}

export function createLicenseEngine(c: Config): LicenseEngine {
  return c.LICENSE_ENGINE === 'bridge'
    ? new BridgeLicenseEngine(c.LICENSE_BRIDGE_URL, c.LICENSE_BRIDGE_SECRET)
    : new SimulatedLicenseEngine();
}
