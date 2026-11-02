import type { Config } from '../config.ts';

// Cliente mínimo de la API REST de PayPal (Subscriptions v1).
// Referencias:
//   https://developer.paypal.com/docs/api/subscriptions/v1/
//   https://developer.paypal.com/docs/api/catalog-products/v1/
//   https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature

export type RemoteSubscription = {
  id: string;
  status: 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
  plan_id: string;
  custom_id?: string;
  start_time?: string;
  billing_info?: {
    next_billing_time?: string;
    failed_payments_count?: number;
    last_payment?: { amount: { value: string; currency_code: string }; time: string };
  };
};

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PayPalApi {
  createProduct(input: { name: string; description: string }): Promise<{ id: string }>;
  createPlan(input: {
    productId: string; name: string; price: string; currency: string;
    intervalUnit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'; intervalCount: number;
  }): Promise<{ id: string }>;
  createSubscription(input: {
    planId: string; customId: string; email: string; name: string; returnUrl: string; cancelUrl: string;
  }): Promise<{ id: string; approveUrl: string }>;
  getSubscription(id: string): Promise<RemoteSubscription>;
  cancelSubscription(id: string, reason: string): Promise<void>;
  verifyWebhook(headers: WebhookHeaders, event: unknown): Promise<boolean>;
}

export class PayPalError extends Error {
  constructor(public status: number, message: string, public debugId?: string) {
    super(message);
  }
}

export class PayPalClient implements PayPalApi {
  private token?: { value: string; expiresAt: number };
  private base: string;

  constructor(private config: Config) {
    this.base = config.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!this.config.PAYPAL_CLIENT_ID || !this.config.PAYPAL_CLIENT_SECRET) throw new PayPalError(0, 'PayPal no está configurado');
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.PAYPAL_CLIENT_ID}:${this.config.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new PayPalError(res.status, 'No se pudo autenticar con PayPal');
    const data: any = await res.json();
    this.token = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    return this.token.value;
  }

  private async call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    // PayPal-Request-Id hace idempotente la creación ante reintentos
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const res = await fetch(`${this.base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 204) return undefined as T;
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(res.status, `PayPal ${method} ${path.split('?')[0]}: ${data?.name ?? res.status}`, data?.debug_id);
    return data as T;
  }

  async createProduct(input: { name: string; description: string }) {
    const data = await this.call<{ id: string }>('POST', '/v1/catalogs/products', {
      name: input.name.slice(0, 127), description: input.description.slice(0, 256) || input.name, type: 'DIGITAL', category: 'SOFTWARE',
    });
    return { id: data.id };
  }

  async createPlan(input: Parameters<PayPalApi['createPlan']>[0]) {
    const data = await this.call<{ id: string }>('POST', '/v1/billing/plans', {
      product_id: input.productId,
      name: input.name.slice(0, 127),
      status: 'ACTIVE',
      billing_cycles: [{
        frequency: { interval_unit: input.intervalUnit, interval_count: input.intervalCount },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: input.price, currency_code: input.currency } },
      }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    });
    return { id: data.id };
  }

  async createSubscription(input: Parameters<PayPalApi['createSubscription']>[0]) {
    const data = await this.call<{ id: string; links: { rel: string; href: string }[] }>('POST', '/v1/billing/subscriptions', {
      plan_id: input.planId,
      custom_id: input.customId,
      subscriber: { email_address: input.email, name: { given_name: input.name.slice(0, 140) } },
      application_context: {
        brand_name: 'RT Magneto',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }, `rt-sub-${input.customId}`);
    const approve = data.links.find((l) => l.rel === 'approve');
    if (!approve) throw new PayPalError(502, 'PayPal no devolvió el enlace de aprobación');
    return { id: data.id, approveUrl: approve.href };
  }

  getSubscription(id: string) {
    return this.call<RemoteSubscription>('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  }

  async cancelSubscription(id: string, reason: string) {
    await this.call('POST', `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: reason.slice(0, 128) });
  }

  async verifyWebhook(headers: WebhookHeaders, event: unknown) {
    const h = (name: string) => {
      const v = headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
    if (!this.config.PAYPAL_WEBHOOK_ID || required.some((n) => !h(n))) return false;
    const data = await this.call<{ verification_status: string }>('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: this.config.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    });
    return data.verification_status === 'SUCCESS';
  }
}
