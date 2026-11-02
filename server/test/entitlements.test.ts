import { describe, expect, it } from 'vitest';
import { addInterval, deriveStatus } from '../src/billing/entitlements.ts';

const now = new Date('2026-11-15T12:00:00Z');
const base = { provider_status: 'ACTIVE', access_until: new Date('2026-12-01T00:00:00Z'), access_revoked_at: null, cancel_at_period_end: false, grace_days: 3 };
const at = (iso: string) => new Date(iso);

describe('deriveStatus', () => {
  it('activa dentro del periodo pagado', () => expect(deriveStatus(base, now)).toBe('active'));
  it('aprobación pendiente sin pago', () => expect(deriveStatus({ ...base, provider_status: 'APPROVAL_PENDING', access_until: null }, now)).toBe('approval_pending'));
  it('pago pendiente si PayPal está activa pero no hay cobro', () => expect(deriveStatus({ ...base, access_until: null }, now)).toBe('payment_pending'));
  it('cancelada conserva el acceso hasta el final', () => expect(deriveStatus({ ...base, cancel_at_period_end: true }, now)).toBe('canceled'));
  it('cancelada y vencida pasa a expirada sin gracia', () => expect(deriveStatus({ ...base, cancel_at_period_end: true }, at('2026-12-01T01:00:00Z'))).toBe('expired'));
  it('gracia tras el vencimiento', () => expect(deriveStatus(base, at('2026-12-03T00:00:00Z'))).toBe('grace'));
  it('impagada tras la gracia', () => expect(deriveStatus(base, at('2026-12-05T00:00:00Z'))).toBe('unpaid'));
  it('suspendida por PayPal tras la gracia', () => expect(deriveStatus({ ...base, provider_status: 'SUSPENDED' }, at('2026-12-05T00:00:00Z'))).toBe('suspended'));
  it('revocada siempre suspendida', () => expect(deriveStatus({ ...base, access_revoked_at: now }, now)).toBe('suspended'));
});

describe('addInterval', () => {
  it('suma meses y años en UTC', () => {
    expect(addInterval(at('2026-01-15T10:00:00Z'), 'month', 1).toISOString()).toBe('2026-02-15T10:00:00.000Z');
    expect(addInterval(at('2026-01-15T10:00:00Z'), 'year', 1).toISOString()).toBe('2027-01-15T10:00:00.000Z');
    expect(addInterval(at('2026-01-15T10:00:00Z'), 'week', 2).toISOString()).toBe('2026-01-29T10:00:00.000Z');
  });
});
