import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrevoMailer, parseAddress } from '../src/email/mailer.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('Brevo', () => {
  it('separa nombre y correo del remitente', () => {
    expect(parseAddress('RT Magneto <licencias@rt.com>')).toEqual({ name: 'RT Magneto', email: 'licencias@rt.com' });
    expect(parseAddress('licencias@rt.com')).toEqual({ email: 'licencias@rt.com' });
  });

  it('envía por la API HTTPS con la clave en la cabecera', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ messageId: '<abc@brevo>' }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const r = await new BrevoMailer('clave', 'RT Magneto <licencias@rt.com>').send({ to: 'c@x.com', subject: 'Hola', text: 't', html: '<p>h</p>', idempotencyKey: 'k1' });
    expect(r.providerMessageId).toBe('<abc@brevo>');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('clave');
    expect(JSON.parse(init.body as string)).toMatchObject({ sender: { name: 'RT Magneto', email: 'licencias@rt.com' }, to: [{ email: 'c@x.com' }], htmlContent: '<p>h</p>' });
  });

  it('un error del proveedor se lanza para que la cola reintente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Key not found' }), { status: 401 })));
    await expect(new BrevoMailer('mala', 'a@b.com').send({ to: 'c@x.com', subject: 's', text: 't', html: 'h', idempotencyKey: 'k' })).rejects.toThrow('401');
  });
});
