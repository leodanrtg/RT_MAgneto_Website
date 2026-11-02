import type { Config } from '../config.ts';
import type { Sql } from '../db.ts';
import { decrypt, encrypt } from '../lib/crypto.ts';
import { enqueue, type Job } from '../jobs.ts';
import type { Mailer } from './mailer.ts';
import { renderEmail, type EmailData, type EmailType } from './templates.ts';

type QueueInput = {
  userId: string | null;
  to: string;
  type: EmailType;
  // clave única del envío: el mismo evento nunca manda dos correos
  key: string;
  data: Omit<EmailData, 'appUrl' | 'supportEmail'>;
};

// Registra el correo y encola su envío. Los datos (que pueden llevar enlaces o claves) se guardan cifrados.
export async function queueEmail(sql: Sql, config: Config, input: QueueInput): Promise<boolean> {
  const [row] = await sql`
    INSERT INTO email_messages (user_id, to_email, message_type, idempotency_key)
    VALUES (${input.userId}, ${input.to}, ${input.type}, ${input.key})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id`;
  if (!row) return false;
  await enqueue(sql, 'email.send', {
    messageId: row.id,
    sealed: encrypt(JSON.stringify(input.data), config.DATA_ENCRYPTION_KEY),
  }, { key: `email:${input.key}`, maxAttempts: 6 });
  return true;
}

export function emailJobHandler(sql: Sql, config: Config, mailer: Mailer) {
  return async (job: Job) => {
    const [msg] = await sql`SELECT * FROM email_messages WHERE id = ${job.payload.messageId}`;
    if (!msg || msg.status === 'sent') return;
    const data = JSON.parse(decrypt(job.payload.sealed, config.DATA_ENCRYPTION_KEY));
    const rendered = renderEmail(msg.message_type, { ...data, appUrl: config.APP_URL, supportEmail: config.SUPPORT_EMAIL });
    try {
      const { providerMessageId } = await mailer.send({ to: msg.to_email, ...rendered, idempotencyKey: msg.idempotency_key });
      await sql`UPDATE email_messages SET status = 'sent', sent_at = now(), attempts = attempts + 1,
                provider_message_id = ${providerMessageId}, last_error = NULL WHERE id = ${msg.id}`;
    } catch (err) {
      const error = String((err as Error).message).slice(0, 500);
      const failed = job.attempts >= job.max_attempts;
      await sql`UPDATE email_messages SET attempts = attempts + 1, last_error = ${error},
                status = ${failed ? 'failed' : 'queued'} WHERE id = ${msg.id}`;
      throw err;
    }
  };
}

// Reenvío manual desde el panel admin de un correo fallido.
export async function retryEmail(sql: Sql, messageId: string) {
  await sql`UPDATE email_messages SET status = 'queued', last_error = NULL WHERE id = ${messageId} AND status = 'failed'`;
  await sql`UPDATE jobs SET status = 'pending', attempts = 0, run_at = now(), updated_at = now()
            WHERE type = 'email.send' AND payload->>'messageId' = ${messageId} AND status = 'dead'`;
}
