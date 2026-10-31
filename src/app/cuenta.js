import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../styles.css';
import './app.css';
import { api, logout, me } from './api.js';
import { langSelect, t, useLang } from './i18n.js';
import { badge, brand, busy, dialog, fmtDate, fmtInterval, fmtMoney, h, loading, showErrors, field, table, toast } from './ui.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
let user;
let banner = null;

function nav() {
  return h('header', { class: 'app-nav' },
    brand(),
    h('div', { class: 'nav-end' },
      h('span', { class: 'app-user' }, user.email),
      langSelect(h, () => render()),
      user.role === 'admin' && h('a', { class: 'btn btn-ghost btn-sm', href: '../admin/' }, t('Administración')),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await logout(); location.assign('../'); } }, t('Salir'))));
}

const CANCELABLE = ['active', 'grace', 'payment_pending', 'unpaid', 'suspended'];

function licensesCard(licenses) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-lic' },
    h('h2', { id: 'h-lic' }, t('Mis licencias')),
    licenses.length ? h('div', { class: 'grid' }, ...licenses.map((l) => {
      const keyBox = h('div', {});
      const reveal = h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
        const v = await dialog({
          title: t('Ver clave de activación'),
          body: t('Por seguridad, escribe tu contraseña.'),
          fields: [{ name: 'password', label: t('Contraseña'), type: 'password', required: true, autocomplete: 'current-password' }],
          confirmLabel: t('Ver clave'),
        });
        if (!v) return;
        try {
          const { licenseKey } = await api('POST', `/account/licenses/${l.id}/reveal`, v);
          keyBox.replaceChildren(
            h('p', { class: 'key' }, licenseKey),
            h('button', { class: 'btn btn-sm', onclick: async () => { await navigator.clipboard.writeText(licenseKey); toast(t('Clave copiada'), 'good'); } }, t('Copiar clave')));
          reveal.remove();
        } catch (err) { toast(err.message, 'bad'); }
      } }, t('Ver clave'));
      return h('article', { class: 'lic' },
        h('div', { class: 'card-head' }, h('strong', {}, l.product), badge(l.status)),
        h('dl', { class: 'kv', style: 'margin-top:.75rem' },
          h('dt', {}, t('Plataforma')), h('dd', {}, l.platform),
          h('dt', {}, t('Vence')), h('dd', {}, fmtDate(l.expires_at)),
          h('dt', {}, t('Clave')), h('dd', { class: 'mono' }, l.issued ? `•••• ${l.key_hint}` : t('Generándose…'))),
        l.issued && l.status !== 'revoked' && h('div', { style: 'margin-top:.75rem' }, reveal, keyBox));
    })) : h('p', { class: 'empty' }, t('Todavía no tienes licencias. Elige un plan para empezar.')));
}

function subscriptionsCard(subs, reload) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-subs' },
    h('h2', { id: 'h-subs' }, t('Mis suscripciones')),
    table([
      { label: t('Producto'), cell: (s) => `${s.product} · ${s.plan}` },
      { label: t('Precio'), cell: (s) => `${fmtMoney(s.price_cents, s.currency)} ${fmtInterval(s.billing_interval, s.interval_count)}` },
      { label: t('Estado'), cell: (s) => badge(s.status) },
      { label: t('Acceso hasta'), cell: (s) => fmtDate(s.access_until) },
      { label: t('Renovación'), cell: (s) => (s.cancel_at_period_end ? t('No se renovará') : s.status === 'active' ? fmtDate(s.current_period_end) : '—') },
      { label: '', cell: (s) => (CANCELABLE.includes(s.status) && !s.cancel_at_period_end
        ? h('button', { class: 'btn-link', onclick: async () => {
          const ok = await dialog({
            title: t('Cancelar la renovación'),
            body: t('Se cancelará en PayPal y no se volverá a cobrar. Conservas el acceso hasta el {date}.', { date: fmtDate(s.access_until) }),
            confirmLabel: t('Cancelar renovación'), danger: true,
          });
          if (!ok) return;
          try {
            await api('POST', `/account/subscriptions/${s.id}/cancel`);
            toast(t('Renovación cancelada'), 'good');
            reload();
          } catch (err) { toast(err.message, 'bad'); }
        } }, t('Cancelar'))
        : '') },
    ], subs, { empty: t('No tienes suscripciones.') }));
}

function plansCard(catalog, subs) {
  const live = new Set(subs.filter((s) => ['active', 'grace', 'payment_pending', 'canceled'].includes(s.status)).map((s) => s.product));
  const products = catalog.products.filter((p) => !live.has(p.name));
  if (!products.length) return null;
  return h('section', { class: 'card', 'aria-labelledby': 'h-plans' },
    h('h2', { id: 'h-plans' }, t('Planes disponibles')),
    !user.emailVerified && h('p', { class: 'notice' }, t('Confirma tu correo para poder suscribirte.')),
    h('div', { class: 'grid' }, ...products.flatMap((p) => p.plans.map((plan) => {
      const button = h('button', { class: 'btn', disabled: !user.emailVerified, onclick: () => busy(button, async () => {
        try {
          const r = await api('POST', '/checkout/subscriptions', { planId: plan.id });
          location.assign(r.approveUrl);
        } catch (err) { toast(err.message, 'bad'); }
      }) }, t('Suscribirme con PayPal'));
      return h('article', { class: 'stat plan' },
        h('strong', {}, `${p.name} · ${plan.name}`),
        h('span', { class: 'note' }, p.platform),
        h('span', { class: 'plan-price' }, fmtMoney(plan.priceCents, plan.currency)),
        h('span', { class: 'muted' }, `${fmtInterval(plan.interval, plan.intervalCount)}. ${t('Cancela cuando quieras.')}`),
        button);
    }))));
}

function paymentsCard(payments) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-pay' },
    h('h2', { id: 'h-pay' }, t('Pagos')),
    table([
      { label: t('Fecha'), cell: (p) => fmtDate(p.paid_at || p.created_at) },
      { label: t('Producto'), cell: (p) => p.product || '—' },
      { label: t('Importe'), cell: (p) => fmtMoney(p.amount_cents, p.currency) },
      { label: t('Tipo'), cell: (p) => (p.payment_type === 'initial' ? t('Alta') : t('Renovación')) },
      { label: t('Estado'), cell: (p) => badge(p.status) },
    ], payments, { empty: t('Aún no hay pagos.') }),
    h('p', { class: 'note' }, t('Los recibos oficiales están en tu cuenta de PayPal.')));
}

function installCard(supportEmail) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-inst' },
    h('h2', { id: 'h-inst' }, t('Instalación y soporte')),
    h('ol', { style: 'list-style:decimal;padding-left:1.25rem;display:grid;gap:.4rem' },
      h('li', {}, t('En NinjaTrader 8, importa el indicador desde Herramientas › Importar › Complemento NinjaScript con el archivo que te facilita el soporte.')),
      h('li', {}, t('Añade RT Magneto a un gráfico de futuros.')),
      h('li', {}, t('Introduce tu clave de activación cuando el indicador la pida. La clave queda vinculada a tu equipo.'))),
    h('p', { class: 'muted' }, t('¿Necesitas ayuda o cambiar de equipo? Escribe a'), ' ', h('a', { href: `mailto:${supportEmail}` }, supportEmail), '.'));
}

function profileCard() {
  const nameForm = h('form', { class: 'form' },
    field({ name: 'name', label: t('Nombre'), required: true, value: user.name, autocomplete: 'name' }),
    h('p', { 'data-error': '' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, t('Guardar nombre')));
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PATCH', '/account/profile', Object.fromEntries(new FormData(nameForm)));
      toast(t('Nombre actualizado'), 'good');
    } catch (err) { showErrors(nameForm, err); }
  });
  const pwForm = h('form', { class: 'form' },
    field({ name: 'currentPassword', label: t('Contraseña actual'), type: 'password', required: true, autocomplete: 'current-password' }),
    field({ name: 'newPassword', label: t('Nueva contraseña'), type: 'password', required: true, autocomplete: 'new-password', hint: t('Mínimo 10 caracteres.') }),
    h('p', { 'data-error': '' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, t('Cambiar contraseña')));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/auth/change-password', Object.fromEntries(new FormData(pwForm)));
      pwForm.reset();
      toast(r.message, 'good');
    } catch (err) { showErrors(pwForm, err); }
  });
  return h('section', { class: 'card', 'aria-labelledby': 'h-prof' },
    h('h2', { id: 'h-prof' }, t('Mi perfil')),
    h('p', { class: 'muted' }, t('Correo: {email}', { email: user.email })),
    h('div', { class: 'form-row' }, nameForm, pwForm));
}

async function render() {
  const title = () => h('h1', { class: 'app-title' }, t('Hola, {name}', { name: user.name }));
  const main = h('main', { class: 'app-main', id: 'contenido' }, title(), loading());
  root.replaceChildren(nav(), main);
  try {
    const [overview, catalog] = await Promise.all([api('GET', '/account/overview'), api('GET', '/catalog')]);
    main.replaceChildren(...[
      title(),
      banner?.(),
      !user.emailVerified && h('p', { class: 'notice' }, t('Confirma tu correo con el enlace que te enviamos.'), ' ',
        h('button', { class: 'btn-link', onclick: async () => { await api('POST', '/auth/resend-verification'); toast(t('Correo enviado'), 'good'); } }, t('Reenviar correo'))),
      licensesCard(overview.licenses),
      subscriptionsCard(overview.subscriptions, render),
      plansCard(catalog, overview.subscriptions),
      paymentsCard(overview.payments),
      installCard(catalog.supportEmail),
      profileCard()].filter(Boolean));
  } catch (err) {
    main.replaceChildren(h('p', { class: 'notice notice-bad' }, err.message));
  }
}

// Vuelta desde PayPal: se pregunta al servidor, que consulta PayPal; el acceso llega con el cobro confirmado.
// Devuelve una función para que el aviso se traduzca si cambia el idioma.
async function returnedFromPayPal() {
  const subId = params.get('suscripcion');
  const state = params.get('paypal');
  history.replaceState(null, '', location.pathname);
  const notice = (text) => () => h('p', { class: 'notice' }, t(text));
  if (state === 'cancelado') return notice('Has salido de PayPal sin completar la suscripción. No se ha cobrado nada.');
  if (state !== 'aprobado' || !subId) return null;
  for (let i = 0; i < 6; i++) {
    try {
      const { status } = await api('POST', `/checkout/subscriptions/${subId}/confirm`);
      const { subscriptions } = await api('GET', '/account/overview');
      if (subscriptions.find((s) => s.id === subId)?.status === 'active') {
        return notice('¡Pago confirmado! Te enviamos la clave por correo y ya la tienes en “Mis licencias”.');
      }
      if (status === 'expired' || status === 'suspended') break;
    } catch { /* se reintenta */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return notice('PayPal aprobó tu suscripción. Estamos esperando la confirmación del cobro; en unos minutos verás aquí tu licencia y te llegará por correo.');
}

(async () => {
  await useLang();
  user = await me().catch(() => null);
  if (!user) return location.replace(`../entrar/?next=${encodeURIComponent(location.pathname)}`);
  banner = params.has('paypal') ? await returnedFromPayPal() : null;
  render();
})();
