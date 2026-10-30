import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.ts';

export type OutgoingEmail = { to: string; subject: string; text: string; html: string; idempotencyKey: string };

export interface Mailer {
  send(msg: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

// Solo desarrollo y pruebas: guarda los correos en memoria y, si se indica, en archivos .eml locales.
// No escribe el contenido en los logs.
export class OutboxMailer implements Mailer {
  sent: OutgoingEmail[] = [];
  constructor(private dir?: string) {}
  async send(msg: OutgoingEmail) {
    this.sent.push(msg);
    if (this.dir) {
      await mkdir(this.dir, { recursive: true });
      const file = path.join(this.dir, `${Date.now()}-${msg.idempotencyKey.replace(/[^a-z0-9_-]/gi, '_')}.txt`);
      await writeFile(file, `Para: ${msg.to}\nAsunto: ${msg.subject}\n\n${msg.text}\n`);
    }
    return { providerMessageId: `outbox-${this.sent.length}` };
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`proveedor de correo respondió ${res.status}: ${String(data?.Message ?? data?.message ?? '').slice(0, 200)}`);
  return data;
}

// https://postmarkapp.com/developer/api/email-api
export class PostmarkMailer implements Mailer {
  constructor(private token: string, private from: string) {}
  async send(msg: OutgoingEmail) {
    const data = await post('https://api.postmarkapp.com/email', { 'X-Postmark-Server-Token': this.token }, {
      From: this.from, To: msg.to, Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html, MessageStream: 'outbound',
    });
    return { providerMessageId: String(data.MessageID) };
  }
}

// https://resend.com/docs/api-reference/emails/send-email
export class ResendMailer implements Mailer {
  constructor(private key: string, private from: string) {}
  async send(msg: OutgoingEmail) {
    const data = await post('https://api.resend.com/emails', { Authorization: `Bearer ${this.key}`, 'Idempotency-Key': msg.idempotencyKey.slice(0, 256) }, {
      from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html,
    });
    return { providerMessageId: String(data.id) };
  }
}

export function createMailer(c: Config): Mailer {
  if (c.MAIL_PROVIDER === 'postmark') return new PostmarkMailer(c.MAIL_API_KEY, c.MAIL_FROM);
  if (c.MAIL_PROVIDER === 'resend') return new ResendMailer(c.MAIL_API_KEY, c.MAIL_FROM);
  return new OutboxMailer(c.NODE_ENV === 'development' ? path.resolve('.outbox') : undefined);
}
