import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../styles.css';
import './app.css';
import { api, logout, me } from './api.js';
import { badge, brand, busy, dialog, fmtDate, fmtInterval, fmtMoney, h, loading, showErrors, field, table, toast } from './ui.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
let user;

function nav() {
  return h('header', { class: 'app-nav' },
    brand(),
    h('div', { class: 'nav-end' },
      h('span', { class: 'app-user' }, user.email),
      user.role === 'admin' && h('a', { class: 'btn btn-ghost btn-sm', href: '../admin/' }, 'Administración'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await logout(); location.assign('../'); } }, 'Salir')));
}

const CANCELABLE = ['active', 'grace', 'payment_pending', 'unpaid', 'suspended'];

function licensesCard(licenses) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-lic' },
    h('h2', { id: 'h-lic' }, 'Mis licencias'),
    licenses.length ? h('div', { class: 'grid' }, ...licenses.map((l) => {
      const keyBox = h('div', {});
      const reveal = h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
        const v = await dialog({
          title: 'Ver clave de activación',
          body: 'Por seguridad, escribe tu contraseña.',
          fields: [{ name: 'password', label: 'Contraseña', type: 'password', required: true, autocomplete: 'current-password' }],
          confirmLabel: 'Ver clave',
        });
        if (!v) return;
        try {
          const { licenseKey } = await api('POST', `/account/licenses/${l.id}/reveal`, v);
          keyBox.replaceChildren(
            h('p', { class: 'key' }, licenseKey),
            h('button', { class: 'btn btn-sm', onclick: async () => { await navigator.clipboard.writeText(licenseKey); toast('Clave copiada', 'good'); } }, 'Copiar clave'));
          reveal.remove();
        } catch (err) { toast(err.message, 'bad'); }
      } }, 'Ver clave');
      return h('article', { class: 'lic' },
        h('div', { class: 'card-head' }, h('strong', {}, l.product), badge(l.status)),
        h('dl', { class: 'kv', style: 'margin-top:.75rem' },
          h('dt', {}, 'Plataforma'), h('dd', {}, l.platform),
          h('dt', {}, 'Vence'), h('dd', {}, fmtDate(l.expires_at)),
          h('dt', {}, 'Clave'), h('dd', { class: 'mono' }, l.issued ? `•••• ${l.key_hint}` : 'Generándose…')),
        l.issued && l.status !== 'revoked' && h('div', { style: 'margin-top:.75rem' }, reveal, keyBox));
    })) : h('p', { class: 'empty' }, 'Todavía no tienes licencias. Elige un plan para empezar.'));
}

function subscriptionsCard(subs, reload) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-subs' },
    h('h2', { id: 'h-subs' }, 'Mis suscripciones'),
    table([
      { label: 'Producto', cell: (s) => `${s.product} · ${s.plan}` },
      { label: 'Precio', cell: (s) => `${fmtMoney(s.price_cents, s.currency)} ${fmtInterval(s.billing_interval, s.interval_count)}` },
      { label: 'Estado', cell: (s) => badge(s.status) },
      { label: 'Acceso hasta', cell: (s) => fmtDate(s.access_until) },
      { label: 'Renovación', cell: (s) => (s.cancel_at_period_end ? 'No se renovará' : s.status === 'active' ? fmtDate(s.current_period_end) : '—') },
      { label: '', cell: (s) => (CANCELABLE.includes(s.status) && !s.cancel_at_period_end
        ? h('button', { class: 'btn-link', onclick: async () => {
          const ok = await dialog({
            title: 'Cancelar la renovación',
            body: `Se cancelará en PayPal y no se volverá a cobrar. Conservas el acceso hasta el ${fmtDate(s.access_until)}.`,
            confirmLabel: 'Cancelar renovación', danger: true,
          });
          if (!ok) return;
          try {
            await api('POST', `/account/subscriptions/${s.id}/cancel`);
            toast('Renovación cancelada', 'good');
            reload();
          } catch (err) { toast(err.message, 'bad'); }
        } }, 'Cancelar')
        : '') },
    ], subs, { empty: 'No tienes suscripciones.' }));
}

function plansCard(catalog, subs) {
  const live = new Set(subs.filter((s) => ['active', 'grace', 'payment_pending', 'canceled'].includes(s.status)).map((s) => s.product));
  const products = catalog.products.filter((p) => !live.has(p.name));
  if (!products.length) return null;
  return h('section', { class: 'card', 'aria-labelledby': 'h-plans' },
    h('h2', { id: 'h-plans' }, 'Planes disponibles'),
    !user.emailVerified && h('p', { class: 'notice' }, 'Confirma tu correo para poder suscribirte.'),
    h('div', { class: 'grid' }, ...products.flatMap((p) => p.plans.map((plan) => {
      const button = h('button', { class: 'btn', disabled: !user.emailVerified, onclick: () => busy(button, async () => {
        try {
          const r = await api('POST', '/checkout/subscriptions', { planId: plan.id });
          location.assign(r.approveUrl);
        } catch (err) { toast(err.message, 'bad'); }
      }) }, 'Suscribirme con PayPal');
      return h('article', { class: 'stat plan' },
        h('strong', {}, `${p.name} · ${plan.name}`),
        h('span', { class: 'note' }, p.platform),
        h('span', { class: 'plan-price' }, fmtMoney(plan.priceCents, plan.currency)),
        h('span', { class: 'muted' }, `${fmtInterval(plan.interval, plan.intervalCount)}. Cancela cuando quieras.`),
        button);
    }))));
}

function paymentsCard(payments) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-pay' },
    h('h2', { id: 'h-pay' }, 'Pagos'),
    table([
      { label: 'Fecha', cell: (p) => fmtDate(p.paid_at || p.created_at) },
      { label: 'Producto', cell: (p) => p.product || '—' },
      { label: 'Importe', cell: (p) => fmtMoney(p.amount_cents, p.currency) },
      { label: 'Tipo', cell: (p) => (p.payment_type === 'initial' ? 'Alta' : 'Renovación') },
      { label: 'Estado', cell: (p) => badge(p.status) },
    ], payments, { empty: 'Aún no hay pagos.' }),
    h('p', { class: 'note' }, 'Los recibos oficiales están en tu cuenta de PayPal.'));
}

function installCard(supportEmail) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-inst' },
    h('h2', { id: 'h-inst' }, 'Instalación y soporte'),
    h('ol', { style: 'list-style:decimal;padding-left:1.25rem;display:grid;gap:.4rem' },
      h('li', {}, 'En NinjaTrader 8, importa el indicador desde Herramientas › Importar › Complemento NinjaScript con el archivo que te facilita el soporte.'),
      h('li', {}, 'Añade RT Magneto a un gráfico de futuros.'),
      h('li', {}, 'Introduce tu clave de activación cuando el indicador la pida. La clave queda vinculada a tu equipo.')),
    h('p', { class: 'muted' }, '¿Necesitas ayuda o cambiar de equipo? Escribe a ', h('a', { href: `mailto:${supportEmail}` }, supportEmail), '.'));
}

function profileCard() {
  const nameForm = h('form', { class: 'form' },
    field({ name: 'name', label: 'Nombre', required: true, value: user.name, autocomplete: 'name' }),
    h('p', { 'data-error': '' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, 'Guardar nombre'));
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PATCH', '/account/profile', Object.fromEntries(new FormData(nameForm)));
      toast('Nombre actualizado', 'good');
    } catch (err) { showErrors(nameForm, err); }
  });
  const pwForm = h('form', { class: 'form' },
    field({ name: 'currentPassword', label: 'Contraseña actual', type: 'password', required: true, autocomplete: 'current-password' }),
    field({ name: 'newPassword', label: 'Nueva contraseña', type: 'password', required: true, autocomplete: 'new-password', hint: 'Mínimo 10 caracteres.' }),
    h('p', { 'data-error': '' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, 'Cambiar contraseña'));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/auth/change-password', Object.fromEntries(new FormData(pwForm)));
      pwForm.reset();
      toast(r.message, 'good');
    } catch (err) { showErrors(pwForm, err); }
  });
  return h('section', { class: 'card', 'aria-labelledby': 'h-prof' },
    h('h2', { id: 'h-prof' }, 'Mi perfil'),
    h('p', { class: 'muted' }, `Correo: ${user.email}`),
    h('div', { class: 'form-row' }, nameForm, pwForm));
}

async function render(banner) {
  const main = h('main', { class: 'app-main', id: 'contenido' }, h('h1', { class: 'app-title' }, `Hola, ${user.name}`), loading());
  root.replaceChildren(nav(), main);
  try {
    const [overview, catalog] = await Promise.all([api('GET', '/account/overview'), api('GET', '/catalog')]);
    const reload = () => render();
    main.replaceChildren(...[
      h('h1', { class: 'app-title' }, `Hola, ${user.name}`),
      banner,
      !user.emailVerified && h('p', { class: 'notice' }, 'Confirma tu correo con el enlace que te enviamos. ',
        h('button', { class: 'btn-link', onclick: async () => { await api('POST', '/auth/resend-verification'); toast('Correo enviado', 'good'); } }, 'Reenviar correo')),
      licensesCard(overview.licenses),
      subscriptionsCard(overview.subscriptions, reload),
      plansCard(catalog, overview.subscriptions),
      paymentsCard(overview.payments),
      installCard(catalog.supportEmail),
      profileCard()].filter(Boolean));
  } catch (err) {
    main.replaceChildren(h('p', { class: 'notice notice-bad' }, err.message));
  }
}

// Vuelta desde PayPal: se pregunta al servidor, que consulta PayPal; el acceso llega con el cobro confirmado.
async function returnedFromPayPal() {
  const subId = params.get('suscripcion');
  const state = params.get('paypal');
  history.replaceState(null, '', location.pathname);
  if (state === 'cancelado') return h('p', { class: 'notice' }, 'Has salido de PayPal sin completar la suscripción. No se ha cobrado nada.');
  if (state !== 'aprobado' || !subId) return null;
  for (let i = 0; i < 6; i++) {
    try {
      const { status } = await api('POST', `/checkout/subscriptions/${subId}/confirm`);
      const { subscriptions } = await api('GET', '/account/overview');
      if (subscriptions.find((s) => s.id === subId)?.status === 'active') {
        return h('p', { class: 'notice' }, '¡Pago confirmado! Te enviamos la clave por correo y ya la tienes en “Mis licencias”.');
      }
      if (status === 'expired' || status === 'suspended') break;
    } catch { /* se reintenta */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return h('p', { class: 'notice' }, 'PayPal aprobó tu suscripción. Estamos esperando la confirmación del cobro; en unos minutos verás aquí tu licencia y te llegará por correo.');
}

(async () => {
  user = await me().catch(() => null);
  if (!user) return location.replace(`../entrar/?next=${encodeURIComponent(location.pathname)}`);
  render(params.has('paypal') ? await returnedFromPayPal() : null);
})();
