import { z } from 'zod';

// Toda la configuración sale de variables de entorno (ver .env.example).
// Ningún secreto tiene valor por defecto.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('127.0.0.1'),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  // 32 bytes en base64: cifra las claves de licencia guardadas
  DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'debe ser 32 bytes en base64'),
  TRUST_PROXY: z.stringbool().default(false),

  LOGIN_MAX_FAILURES: z.coerce.number().int().default(8),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().default(15),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(120),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(10),

  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().default(''),
  PAYPAL_CLIENT_SECRET: z.string().default(''),
  PAYPAL_WEBHOOK_ID: z.string().default(''),

  // qué hacer con el acceso cuando se reembolsa por completo el último pago
  REFUND_POLICY: z.enum(['suspend', 'keep']).default('suspend'),

  MAIL_PROVIDER: z.enum(['console', 'brevo', 'postmark', 'resend']).default('console'),
  MAIL_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('RT Magneto <licencias@example.com>'),
  SUPPORT_EMAIL: z.string().default('soporte@example.com'),

  LICENSE_ENGINE: z.enum(['simulated', 'bridge']).default('simulated'),
  LICENSE_BRIDGE_URL: z.string().default(''),
  LICENSE_BRIDGE_SECRET: z.string().default(''),
});

export type Config = z.infer<typeof schema> & { secureCookies: boolean };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // solo nombres de variables, nunca sus valores
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración inválida:\n  ${fields}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (!c.APP_URL.startsWith('https://')) throw new Error('APP_URL debe usar https en producción');
    if (c.LICENSE_ENGINE === 'simulated') throw new Error('LICENSE_ENGINE=simulated no se permite en producción');
    if (c.MAIL_PROVIDER === 'console') throw new Error('MAIL_PROVIDER=console no se permite en producción');
  }
  return { ...c, secureCookies: c.APP_URL.startsWith('https://') };
}
