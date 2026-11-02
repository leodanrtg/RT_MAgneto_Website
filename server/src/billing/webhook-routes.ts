import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import type { Deps } from '../app.ts';
import { processPayPalEvent, type PayPalEvent } from './webhooks.ts';

export function webhookRoutes(deps: Deps) {
  const { sql, paypal } = deps;

  return async (app: FastifyInstance) => {
    // https://developer.paypal.com/api/rest/webhooks/
    // 200 = recibido (aunque se ignore); 400 = firma no válida; 5xx = PayPal debe reintentar.
    app.post('/paypal', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
      const event = req.body as PayPalEvent;
      if (!event || typeof event.id !== 'string' || typeof event.event_type !== 'string') {
        return reply.status(400).send({ error: 'invalid_event' });
      }

      let valid: boolean;
      try {
        valid = await paypal.verifyWebhook(req.headers, event);
      } catch (err) {
        req.log.warn({ err: (err as Error).message }, 'no se pudo verificar el webhook con PayPal');
        return reply.status(503).send({ error: 'verification_unavailable' });
      }
      if (!valid) {
        req.log.warn({ eventId: event.id }, 'webhook de PayPal con firma no válida');
        return reply.status(400).send({ error: 'invalid_signature' });
      }

      const resourceId = event.resource?.id ?? null;
      const [row] = await sql`
        INSERT INTO webhook_events (provider, provider_event_id, event_type, resource_id, payload)
        VALUES ('paypal', ${event.id}, ${event.event_type}, ${resourceId}, ${sql.json(event as postgres.JSONValue)})
        ON CONFLICT (provider, provider_event_id) DO UPDATE SET attempts = webhook_events.attempts
        RETURNING id, processing_status`;
      if (row.processing_status === 'processed' || row.processing_status === 'ignored') {
        return { received: true, duplicate: true };
      }
      return handleStoredEvent(deps, row.id, event, reply);
    });
  };
}

// Procesa (o reprocesa desde el panel admin) un evento guardado.
// Todo el efecto del evento (pagos, estados, correos y tareas encoladas) se confirma junto o no se confirma.
export async function handleStoredEvent(deps: Deps, rowId: string, event: PayPalEvent, reply?: { status(code: number): { send(b: unknown): unknown } }) {
  const { sql } = deps;
  try {
    return await sql.begin(async (tx) => {
      // bloqueo por evento: dos entregas simultáneas del mismo evento no se procesan a la vez
      const [locked] = await tx`SELECT processing_status FROM webhook_events WHERE id = ${rowId} FOR UPDATE`;
      if (locked.processing_status === 'processed' || locked.processing_status === 'ignored') return { received: true, duplicate: true };
      const outcome = await processPayPalEvent({ ...deps, sql: tx as unknown as Deps['sql'] }, event);
      await tx`UPDATE webhook_events SET processing_status = ${outcome.status}, processed_at = now(),
               attempts = attempts + 1, error_summary = ${outcome.note ?? null} WHERE id = ${rowId}`;
      return { received: true, status: outcome.status };
    });
  } catch (err) {
    const summary = String((err as Error).message).slice(0, 500);
    await sql`UPDATE webhook_events SET processing_status = 'failed', attempts = attempts + 1, error_summary = ${summary}
              WHERE id = ${rowId}`;
    if (reply) return reply.status(500).send({ error: 'processing_failed' });
    throw err;
  }
}
