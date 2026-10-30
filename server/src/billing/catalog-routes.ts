import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';

// Catálogo público: solo productos y planes activos que ya existen en PayPal.
export function catalogRoutes({ sql }: Deps) {
  return async (app: FastifyInstance) => {
    app.get('/', async () => {
      const rows = await sql`
        SELECT pr.id AS product_id, pr.slug, pr.name AS product_name, pr.description, pr.platform,
               p.id AS plan_id, p.name AS plan_name, p.price_cents, p.currency, p.billing_interval, p.interval_count
        FROM products pr JOIN plans p ON p.product_id = pr.id
        WHERE pr.status = 'active' AND p.status = 'active' AND p.paypal_plan_id IS NOT NULL
        ORDER BY pr.name, p.price_cents`;
      const products = new Map<string, any>();
      for (const r of rows) {
        if (!products.has(r.product_id)) {
          products.set(r.product_id, { id: r.product_id, slug: r.slug, name: r.product_name, description: r.description, platform: r.platform, plans: [] });
        }
        products.get(r.product_id).plans.push({
          id: r.plan_id, name: r.plan_name, priceCents: r.price_cents, currency: r.currency,
          interval: r.billing_interval, intervalCount: r.interval_count,
        });
      }
      return { products: [...products.values()] };
    });
  };
}
