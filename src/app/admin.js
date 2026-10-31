import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../styles.css';
import './app.css';
import { api, logout, me } from './api.js';
import { langSelect, t, useLang } from './i18n.js';
import {
  badge, brand, dialog, field, fmtDate, fmtDateTime, fmtInterval, fmtMoney, h, loading, pager, showErrors, statusLabel, table, toast,
} from './ui.js';

const root = document.getElementById('app');
let user;

const SECTIONS = [
  ['resumen', 'Resumen'],
  ['usuarios', 'Usuarios'],
  ['productos', 'Productos y planes'],
  ['suscripciones', 'Suscripciones'],
  ['pagos', 'Pagos'],
  ['licencias', 'Licencias'],
  ['integraciones', 'Integraciones'],
  ['auditoria', 'Auditoría'],
];

const reasonField = () => ({ name: 'reason', label: t('Motivo (queda registrado)'), required: true });
const yesNo = (v) => (v ? t('Sí') : t('No'));

// Ejecuta una acción con confirmación y motivo obligatorio, y refresca la vista.
async function act({ title, body, path, fields = [reasonField()], danger, done, transform = (v) => v }) {
  const values = await dialog({ title, body, fields, danger, confirmLabel: title });
  if (!values) return;
  try {
    await api('POST', path, transform(values));
    toast(t('Hecho'), 'good');
    done?.();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function listView({ title, path, filters = [], roles = false, columns, onRow, intro, heading = 'h1' }) {
  const state = { page: 1, search: '', status: '', role: '' };
  const results = h('div', {});
  const load = async () => {
    results.replaceChildren(loading());
    const q = new URLSearchParams({ page: state.page });
    if (state.search) q.set('search', state.search);
    if (state.status) q.set('status', state.status);
    if (state.role) q.set('role', state.role);
    try {
      const data = await api('GET', `${path}?${q}`);
      results.replaceChildren(table(columns(load), data.items, { onRow }), pager({ ...data, page: state.page }, (p) => { state.page = p; load(); }));
    } catch (err) {
      results.replaceChildren(h('p', { class: 'notice notice-bad' }, err.message));
    }
  };
  const form = h('form', { class: 'toolbar', role: 'search' },
    field({ name: 'search', label: t('Buscar'), type: 'search' }),
    filters.length > 0 && field({ name: 'status', label: t('Estado'), options: [['', t('Todos')], ...filters.map((s) => [s, statusLabel(s)])] }),
    roles && field({ name: 'role', label: t('Rol'), options: [['', t('Todos')], ['customer', t('Cliente')], ['admin', t('Administrador')]] }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, t('Filtrar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    Object.assign(state, { page: 1, search: v.search || '', status: v.status || '', role: v.role || '' });
    load();
  });
  load();
  return [h(heading, { class: heading === 'h1' ? 'app-title' : 'h3' }, title), intro, h('section', { class: 'card' }, form, results)];
}

// ---------- Resumen ----------
async function resumen() {
  const d = await api('GET', '/admin/dashboard');
  const stat = (label, value, note) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value), note && h('small', {}, note));
  const money = (rows, key) => (rows.length ? rows.map((r) => fmtMoney(r[key], r.currency)).join(' · ') : fmtMoney(0, 'USD'));
  const sum = (o, keys) => keys.reduce((n, k) => n + (o[k] || 0), 0);
  const errors = d.integrationErrors.webhooks + d.integrationErrors.jobs + d.integrationErrors.emails;
  return [
    h('h1', { class: 'app-title' }, t('Resumen')),
    d.licenseEngine === 'simulated' && h('p', { class: 'notice notice-bad' },
      t('Motor de licencias SIMULADO: las licencias no se crean en el sistema real de RT Indicators. Falta conectar el sistema actual.')),
    h('h2', { class: 'h3' }, t('Ingresos')),
    h('dl', { class: 'grid' },
      stat(t('Cobrado hoy'), money(d.revenue, 'today_cents'), t('Pagos completados, menos reembolsos')),
      stat(t('Cobrado este mes'), money(d.revenue, 'month_cents'), t('Pagos completados, menos reembolsos')),
      stat(t('Recurrente mensual estimado'), money(d.mrr, 'mrr_cents'), t('Estimación, no es dinero cobrado'))),
    h('h2', { class: 'h3' }, t('Clientes y suscripciones')),
    h('dl', { class: 'grid' },
      stat(t('Usuarios'), d.users.total, t('{n} nuevos este mes', { n: d.users.new_this_month })),
      stat(t('Suscripciones activas'), sum(d.subscriptions, ['active', 'grace']), t('{n} en gracia', { n: d.subscriptions.grace || 0 })),
      stat(t('Pendientes'), sum(d.subscriptions, ['approval_pending', 'payment_pending'])),
      stat(t('Canceladas (con acceso)'), d.subscriptions.canceled || 0),
      stat(t('Vencidas o impagadas'), sum(d.subscriptions, ['expired', 'unpaid', 'suspended']))),
    h('h2', { class: 'h3' }, t('Pagos y licencias')),
    h('dl', { class: 'grid' },
      stat(t('Pagos confirmados'), d.payments.completed || 0),
      stat(t('Pagos fallidos'), d.payments.failed || 0),
      stat(t('Reembolsos y contracargos'), sum(d.payments, ['refunded', 'partially_refunded', 'reversed'])),
      stat(t('Licencias activas'), d.licenses.active || 0),
      stat(t('Licencias pendientes'), d.licenses.pending || 0),
      stat(t('Licencias suspendidas'), d.licenses.suspended || 0),
      stat(t('Licencias vencidas'), d.licenses.expired || 0),
      stat(t('Errores de integración'), errors, t('{webhooks} webhooks · {jobs} tareas · {emails} correos', d.integrationErrors))),
  ];
}

// ---------- Usuarios ----------
async function newUser() {
  const v = await dialog({
    title: t('Añadir usuario'),
    body: t('Crea la cuenta con el correo ya verificado. La persona elige su contraseña con el enlace de invitación (válido 7 días). Un administrador tiene acceso completo a este panel.'),
    confirmLabel: t('Crear cuenta'),
    fields: [
      { name: 'name', label: t('Nombre'), required: true },
      { name: 'email', label: t('Correo'), type: 'email', required: true },
      { name: 'role', label: t('Rol'), options: [['customer', t('Cliente')], ['admin', t('Administrador')]], value: 'customer' },
      { name: 'sendInvite', label: t('Enviar invitación por correo'), options: [['1', t('Sí, ahora')], ['0', t('No, la envío después')]], value: '1' },
      { name: 'note', label: t('Nota interna (opcional)'), type: 'textarea', placeholder: t('Ej.: pagó por transferencia el 30/10') },
    ],
  });
  if (!v) return;
  try {
    const { id } = await api('POST', '/admin/users', { ...v, sendInvite: v.sendInvite === '1' });
    toast(v.sendInvite === '1' ? t('Cuenta creada e invitación enviada') : t('Cuenta creada'), 'good');
    location.hash = `#usuarios/${id}`;
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function usuarios() {
  return listView({
    title: t('Usuarios'), path: '/admin/users', filters: ['active', 'suspended'], roles: true,
    intro: h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', onclick: newUser }, t('Añadir usuario'))),
    onRow: (u) => { location.hash = `#usuarios/${u.id}`; },
    columns: () => [
      { label: t('Nombre'), cell: (u) => u.name },
      { label: t('Correo'), cell: (u) => u.email },
      { label: t('Rol'), cell: (u) => statusLabel(u.role) },
      { label: t('Estado'), cell: (u) => badge(u.status) },
      { label: t('Verificado'), cell: (u) => yesNo(u.email_verified_at) },
      { label: t('Alta'), cell: (u) => fmtDate(u.created_at) },
    ],
  });
}

async function usuario(id) {
  const d = await api('GET', `/admin/users/${id}`);
  const reload = () => route();
  const u = d.user;
  const noteForm = h('form', { class: 'form' },
    field({ name: 'body', label: t('Nueva nota interna'), type: 'textarea', required: true }), h('p', { 'data-error': '' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, t('Añadir nota')));
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/admin/users/${id}/notes`, Object.fromEntries(new FormData(noteForm))); reload(); } catch (err) { showErrors(noteForm, err); }
  });
  const suspended = u.status === 'suspended';
  const isAdmin = u.role === 'admin';
  return [
    h('p', {}, h('a', { href: '#usuarios' }, `← ${t('Usuarios')}`)),
    h('div', { class: 'card-head' }, h('h1', { class: 'app-title' }, u.name), badge(u.status)),
    h('section', { class: 'card' },
      h('dl', { class: 'kv' },
        h('dt', {}, t('Correo')), h('dd', {}, u.email),
        h('dt', {}, t('Rol')), h('dd', {}, statusLabel(u.role)),
        h('dt', {}, t('Correo verificado')), h('dd', {}, u.email_verified_at ? fmtDateTime(u.email_verified_at) : t('No')),
        h('dt', {}, t('Registro')), h('dd', {}, fmtDateTime(u.created_at))),
      u.id !== user.id && h('div', { class: 'actions' },
        h('button', { class: `btn btn-sm ${suspended ? '' : 'btn-danger'}`, onclick: () => act({
          title: suspended ? t('Reactivar cuenta') : t('Suspender cuenta'),
          body: suspended ? t('El cliente podrá volver a entrar.') : t('Se cerrarán sus sesiones y no podrá entrar. Sus licencias no cambian.'),
          path: `/admin/users/${id}/status`, danger: !suspended, done: reload,
          transform: (v) => ({ ...v, status: suspended ? 'active' : 'suspended' }),
        }) }, suspended ? t('Reactivar cuenta') : t('Suspender cuenta')),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => manualLicense(id, reload) }, t('Crear licencia manual')),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({
          title: isAdmin ? t('Quitar administrador') : t('Hacer administrador'),
          body: isAdmin
            ? t('Pasará a ser cliente y perderá el acceso a este panel. Se cerrarán sus sesiones.')
            : t('Tendrá acceso completo a este panel: clientes, licencias, pagos y roles. Se cerrarán sus sesiones para aplicar el cambio.'),
          path: `/admin/users/${id}/role`, danger: !isAdmin, done: reload,
          transform: (v) => ({ ...v, role: isAdmin ? 'customer' : 'admin' }),
        }) }, isAdmin ? t('Quitar administrador') : t('Hacer administrador')),
        !suspended && h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({
          title: t('Enviar invitación'),
          body: t('Se envía a {email} un enlace para elegir contraseña, válido 7 días. Anula los enlaces anteriores.', { email: u.email }),
          path: `/admin/users/${id}/invite`, fields: [], done: reload,
        }) }, t('Enviar invitación')))),
    h('section', { class: 'card' }, h('h2', {}, t('Suscripciones')), table([
      { label: t('Producto'), cell: (s) => `${s.product} · ${s.plan}` },
      { label: t('Estado'), cell: (s) => badge(s.status) },
      { label: 'PayPal', cell: (s) => h('span', { class: 'mono' }, s.paypal_subscription_id || '—') },
      { label: t('Acceso hasta'), cell: (s) => fmtDate(s.access_until) },
      { label: t('Renovación'), cell: (s) => (s.cancel_at_period_end ? t('Cancelada') : fmtDate(s.current_period_end)) },
    ], d.subscriptions, { onRow: (s) => { location.hash = `#suscripciones/${s.id}`; } })),
    h('section', { class: 'card' }, h('h2', {}, t('Licencias')), table([
      { label: t('Producto'), cell: (l) => l.product },
      { label: t('ID externo'), cell: (l) => h('span', { class: 'mono' }, l.external_license_id || '—') },
      { label: t('Clave'), cell: (l) => (l.key_hint ? `•••• ${l.key_hint}` : '—') },
      { label: t('Estado'), cell: (l) => badge(l.status) },
      { label: t('Vence'), cell: (l) => fmtDate(l.expires_at) },
    ], d.licenses, { onRow: (l) => { location.hash = `#licencias/${l.id}`; } })),
    h('section', { class: 'card' }, h('h2', {}, t('Pagos')), paymentsTable(d.payments)),
    h('section', { class: 'card' }, h('h2', {}, t('Notas de soporte')),
      d.notes.length ? h('ul', { style: 'display:grid;gap:.75rem' }, ...d.notes.map((n) => h('li', {},
        h('p', {}, n.body), h('small', { class: 'note' }, `${n.author} · ${fmtDateTime(n.created_at)}`)))) : h('p', { class: 'note' }, t('Sin notas.')),
      noteForm),
    h('section', { class: 'card' }, h('h2', {}, t('Historial')), auditTable(d.actions)),
  ];
}

async function manualLicense(userId, done) {
  const { products } = await api('GET', '/admin/products');
  await act({
    title: t('Crear licencia manual'),
    body: t('Crea una licencia sin suscripción (soporte, pruebas o acuerdos especiales). Se envía la clave al correo de la cuenta.'),
    path: '/admin/licenses',
    fields: [
      { name: 'productId', label: t('Producto'), options: products.map((p) => [p.id, p.name]), required: true },
      { name: 'days', label: t('Días de vigencia'), type: 'number', min: 1, max: 3660, required: true, value: '30' },
      reasonField(),
    ],
    transform: (v) => ({ ...v, userId, days: Number(v.days) }),
    done,
  });
}

// ---------- Productos y planes ----------
async function productos() {
  const { products } = await api('GET', '/admin/products');
  const reload = () => route();
  const productFields = (p = {}) => [
    { name: 'name', label: t('Nombre'), required: true, value: p.name || '' },
    { name: 'slug', label: t('Identificador interno'), required: true, value: p.slug || '', hint: t('Minúsculas, números y guiones. No cambia después.') },
    { name: 'platform', label: t('Plataforma compatible'), required: true, value: p.platform || '', placeholder: 'NinjaTrader 8' },
    { name: 'description', label: t('Descripción'), type: 'textarea', value: p.description || '' },
    { name: 'licenseProductRef', label: t('ID del producto en el sistema de licencias'), value: p.license_product_ref || '' },
    { name: 'activationPolicy', label: t('Política de activaciones'), value: p.activation_policy || '', placeholder: t('Una máquina por licencia (HWID)') },
    { name: 'status', label: t('Estado'), options: [['draft', t('Borrador')], ['active', t('Activo')], ['archived', t('Archivado')]], value: p.status || 'draft' },
  ];
  const saveProduct = async (p) => {
    const v = await dialog({ title: p ? t('Editar producto') : t('Nuevo producto'), fields: productFields(p).filter((f) => !(p && f.name === 'slug')), confirmLabel: t('Guardar') });
    if (!v) return;
    try {
      await api(p ? 'PATCH' : 'POST', p ? `/admin/products/${p.id}` : '/admin/products', { ...v, licenseProductRef: v.licenseProductRef || null });
      toast(t('Producto guardado'), 'good');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  };
  const newPlan = async (p) => {
    const v = await dialog({
      title: t('Nuevo plan · {product}', { product: p.name }),
      body: t('El precio y la periodicidad no se pueden cambiar después de crear el plan en PayPal: para otro precio se crea otro plan.'),
      fields: [
        { name: 'name', label: t('Nombre'), required: true, placeholder: t('Mensual') },
        { name: 'price', label: t('Precio'), type: 'number', min: 1, step: '0.01', required: true },
        { name: 'currency', label: t('Moneda'), options: [['USD', 'USD'], ['EUR', 'EUR']], value: 'USD' },
        { name: 'interval', label: t('Periodicidad'), options: [['month', t('Mensual')], ['year', t('Anual')], ['week', t('Semanal')], ['day', t('Diaria')]], value: 'month' },
        { name: 'intervalCount', label: t('Cada cuántos periodos'), type: 'number', min: 1, max: 12, value: '1', required: true },
        { name: 'graceDays', label: t('Días de gracia ante impago'), type: 'number', min: 0, max: 30, value: '3', required: true },
      ],
      confirmLabel: t('Crear plan'),
    });
    if (!v) return;
    try {
      await api('POST', '/admin/plans', {
        productId: p.id, name: v.name, priceCents: Math.round(Number(v.price) * 100), currency: v.currency,
        interval: v.interval, intervalCount: Number(v.intervalCount), graceDays: Number(v.graceDays),
      });
      toast(t('Plan creado como borrador'), 'good');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  };
  const planAction = async (plan, path, body, message) => {
    try { await api(path.startsWith('PATCH') ? 'PATCH' : 'POST', path.replace(/^PATCH /, ''), body); toast(message, 'good'); reload(); } catch (err) { toast(err.message, 'bad'); }
  };
  return [
    h('div', { class: 'card-head' }, h('h1', { class: 'app-title' }, t('Productos y planes')),
      h('button', { class: 'btn btn-sm', onclick: () => saveProduct() }, t('Nuevo producto'))),
    products.length ? null : h('p', { class: 'empty' }, t('Crea tu primer producto, por ejemplo RT Magneto para NinjaTrader 8.')),
    ...products.map((p) => h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, p.name), h('div', { class: 'actions' }, badge(p.status),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => saveProduct(p) }, t('Editar')),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => newPlan(p) }, t('Nuevo plan')))),
      h('dl', { class: 'kv' },
        h('dt', {}, t('Identificador')), h('dd', { class: 'mono' }, p.slug),
        h('dt', {}, t('Plataforma')), h('dd', {}, p.platform),
        h('dt', {}, t('ID en licencias')), h('dd', { class: 'mono' }, p.license_product_ref || '—'),
        h('dt', {}, t('Activaciones')), h('dd', {}, p.activation_policy || '—')),
      table([
        { label: t('Plan'), cell: (pl) => pl.name },
        { label: t('Precio'), cell: (pl) => `${fmtMoney(pl.price_cents, pl.currency)} ${fmtInterval(pl.billing_interval, pl.interval_count)}` },
        { label: t('Gracia'), cell: (pl) => t('{n} días', { n: pl.grace_days }) },
        { label: 'PayPal', cell: (pl) => h('span', { class: 'mono' }, pl.paypal_plan_id || t('Sin crear')) },
        { label: t('Estado'), cell: (pl) => badge(pl.status) },
        { label: '', cell: (pl) => h('div', { class: 'actions' },
          !pl.paypal_plan_id && h('button', { class: 'btn-link', onclick: () => planAction(pl, `/admin/plans/${pl.id}/paypal`, undefined, t('Plan creado en PayPal')) }, t('Crear en PayPal')),
          pl.paypal_plan_id && pl.status !== 'active' && h('button', { class: 'btn-link', onclick: () => planAction(pl, `PATCH /admin/plans/${pl.id}`, { status: 'active' }, t('Plan activado')) }, t('Activar')),
          pl.status === 'active' && h('button', { class: 'btn-link', onclick: () => planAction(pl, `PATCH /admin/plans/${pl.id}`, { status: 'archived' }, t('Plan archivado')) }, t('Archivar'))) },
      ], p.plans, { empty: t('Sin planes.') }))),
  ];
}

// ---------- Suscripciones ----------
function suscripciones() {
  return listView({
    title: t('Suscripciones'), path: '/admin/subscriptions',
    filters: ['active', 'grace', 'payment_pending', 'approval_pending', 'canceled', 'unpaid', 'suspended', 'expired'],
    onRow: (s) => { location.hash = `#suscripciones/${s.id}`; },
    columns: () => [
      { label: t('Cliente'), cell: (s) => s.email },
      { label: t('Producto'), cell: (s) => `${s.product} · ${s.plan}` },
      { label: t('Estado'), cell: (s) => badge(s.status) },
      { label: 'PayPal', cell: (s) => h('span', { class: 'mono' }, `${s.paypal_subscription_id || '—'} ${s.provider_status ? `(${s.provider_status})` : ''}`) },
      { label: t('Acceso hasta'), cell: (s) => fmtDate(s.access_until) },
    ],
  });
}

async function suscripcion(id) {
  const s = await api('GET', `/admin/subscriptions/${id}`);
  const reload = () => route();
  return [
    h('p', {}, h('a', { href: `#usuarios/${s.user_id}` }, `← ${s.email}`)),
    h('div', { class: 'card-head' }, h('h1', { class: 'app-title' }, `${s.product} · ${s.plan}`), badge(s.status)),
    h('section', { class: 'card' },
      h('dl', { class: 'kv' },
        h('dt', {}, t('Cliente')), h('dd', {}, s.email),
        h('dt', {}, t('Suscripción PayPal')), h('dd', { class: 'mono' }, s.paypal_subscription_id || '—'),
        h('dt', {}, t('Estado en PayPal')), h('dd', {}, s.provider_status || '—'),
        h('dt', {}, t('Acceso hasta')), h('dd', {}, fmtDateTime(s.access_until)),
        h('dt', {}, t('Renovación automática')), h('dd', {}, s.cancel_at_period_end ? t('Cancelada') : t('Sí')),
        h('dt', {}, t('Creada')), h('dd', {}, fmtDateTime(s.created_at))),
      h('div', { class: 'actions' },
        s.paypal_subscription_id && h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { await api('POST', `/admin/subscriptions/${id}/refresh`); toast(t('Estado leído de PayPal'), 'good'); reload(); } catch (err) { toast(err.message, 'bad'); }
        } }, t('Leer estado de PayPal')),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({
          title: t('Ampliar acceso'), body: t('Días de cortesía sin cobro. La licencia se actualiza automáticamente.'),
          path: `/admin/subscriptions/${id}/extend`, done: reload,
          fields: [{ name: 'days', label: t('Días'), type: 'number', min: 1, max: 366, required: true, value: '7' }, reasonField()],
          transform: (v) => ({ ...v, days: Number(v.days) }),
        }) }, t('Ampliar acceso')),
        s.status === 'suspended'
          ? h('button', { class: 'btn btn-sm', onclick: () => act({ title: t('Reactivar acceso'), path: `/admin/subscriptions/${id}/reactivate`, done: reload }) }, t('Reactivar acceso'))
          : h('button', { class: 'btn btn-danger btn-sm', onclick: () => act({
            title: t('Suspender acceso'), body: t('Desactiva la licencia aunque el periodo esté pagado. No cancela el cobro en PayPal.'),
            path: `/admin/subscriptions/${id}/suspend`, danger: true, done: reload,
          }) }, t('Suspender acceso')))),
  ];
}

// ---------- Pagos ----------
const paymentColumns = () => [
  { label: t('Fecha'), cell: (p) => fmtDateTime(p.paid_at || p.created_at) },
  { label: t('Cliente'), cell: (p) => p.email || '' },
  { label: t('Importe'), cell: (p) => fmtMoney(p.amount_cents, p.currency) },
  { label: t('Reembolsado'), cell: (p) => (p.refunded_cents ? fmtMoney(p.refunded_cents, p.currency) : '—') },
  { label: t('Tipo'), cell: (p) => (p.payment_type === 'initial' ? t('Alta') : t('Renovación')) },
  { label: t('Estado'), cell: (p) => badge(p.status) },
  { label: t('ID PayPal'), cell: (p) => h('span', { class: 'mono' }, p.provider_txn_id) },
];
const paymentsTable = (rows) => table(paymentColumns(), rows, { empty: t('Sin pagos.') });

function pagos() {
  return listView({
    title: t('Pagos'), path: '/admin/payments',
    filters: ['completed', 'pending', 'failed', 'refunded', 'partially_refunded', 'reversed'],
    columns: paymentColumns,
    onRow: (p) => { location.hash = `#usuarios/${p.user_id}`; },
  });
}

// ---------- Licencias ----------
function licencias() {
  const external = h('div', {});
  const loadExternal = async () => {
    external.replaceChildren(loading());
    try {
      const d = await api('GET', '/admin/licenses/external?page=1');
      external.replaceChildren(...[
        d.engine === 'simulated' && h('p', { class: 'notice notice-bad' }, t('Datos del SIMULADOR, no del sistema real.')),
        table([
          { label: 'ID', cell: (l) => h('span', { class: 'mono' }, l.licenseId) },
          { label: t('Cliente'), cell: (l) => l.customerName },
          { label: t('Clave'), cell: (l) => `•••• ${l.keyHint}` },
          { label: 'HWID', cell: (l) => h('span', { class: 'mono' }, l.hwid || t('Sin activar')) },
          { label: t('Vence'), cell: (l) => fmtDate(l.expiresAt) },
          { label: t('Activa'), cell: (l) => yesNo(l.active) },
        ], d.items, { empty: t('No hay licencias en el sistema.') }),
        h('p', { class: 'note' }, t('{n} licencias en total, incluidas las creadas con la app de escritorio.', { n: d.total }))].filter(Boolean));
    } catch (err) {
      external.replaceChildren(h('p', { class: 'notice notice-bad' }, t('No se pudo leer el sistema de licencias: {error}', { error: err.message })));
    }
  };
  return [
    ...listView({
      title: t('Licencias'), path: '/admin/licenses', filters: ['active', 'pending', 'suspended', 'expired', 'revoked'],
      intro: h('p', { class: 'muted' }, t('Licencias vinculadas a cuentas de la web. Las de suscripciones se gestionan desde su suscripción; las manuales, aquí.')),
      onRow: (l) => { location.hash = `#licencias/${l.id}`; },
      columns: () => [
        { label: t('Cliente'), cell: (l) => l.email },
        { label: t('Producto'), cell: (l) => l.product },
        { label: t('ID externo'), cell: (l) => h('span', { class: 'mono' }, l.external_license_id || '—') },
        { label: t('Clave'), cell: (l) => (l.key_hint ? `•••• ${l.key_hint}` : '—') },
        { label: t('Estado'), cell: (l) => badge(l.status) },
        { label: t('Vence'), cell: (l) => fmtDate(l.expires_at) },
        { label: t('Origen'), cell: (l) => (l.subscription_id ? t('Suscripción') : t('Manual')) },
      ],
    }),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, t('Sistema de licencias actual')),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: loadExternal }, t('Consultar'))),
      external),
  ];
}

async function licencia(id) {
  const d = await api('GET', `/admin/licenses/${id}`);
  const reload = () => route();
  const m = d.mapping;
  const manual = !m.subscription_id;
  const live = m.status !== 'revoked';
  const daysFields = () => [{ name: 'days', label: t('Días'), type: 'number', min: 1, max: 3660, required: true, value: '30' }, reasonField()];
  return [
    h('p', {}, h('a', { href: `#usuarios/${m.user_id}` }, `← ${t('Cliente')}`)),
    h('div', { class: 'card-head' }, h('h1', { class: 'app-title' }, t('Licencia')), badge(m.status)),
    h('section', { class: 'card' },
      h('dl', { class: 'kv' },
        h('dt', {}, t('ID en el sistema de licencias')), h('dd', { class: 'mono' }, m.external_license_id || t('Aún no emitida')),
        h('dt', {}, t('Clave')), h('dd', {}, m.key_hint ? `•••• ${m.key_hint}` : '—'),
        h('dt', {}, t('Vence (web)')), h('dd', {}, fmtDateTime(m.expires_at)),
        h('dt', {}, t('Origen')), h('dd', {}, manual ? t('Manual') : h('a', { href: `#suscripciones/${m.subscription_id}` }, t('Suscripción'))),
        h('dt', {}, t('Última sincronización')), h('dd', {}, fmtDateTime(m.last_synced_at)),
        d.external && [
          h('dt', {}, t('Vence (sistema actual)')), h('dd', {}, fmtDateTime(d.external.expiresAt)),
          h('dt', {}, t('Activa (sistema actual)')), h('dd', {}, yesNo(d.external.active)),
          h('dt', {}, 'HWID'), h('dd', { class: 'mono' }, d.external.hwid || t('Sin activar en ningún equipo')),
        ]),
      live && h('div', { class: 'actions' },
        manual && h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({
          title: t('Renovar licencia'), path: `/admin/licenses/${id}/renew`, done: reload,
          fields: daysFields(),
          transform: (v) => ({ ...v, days: Number(v.days) }),
        }) }, t('Renovar')),
        manual && m.status === 'active' && h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({ title: t('Suspender licencia'), path: `/admin/licenses/${id}/suspend`, danger: true, done: reload }) }, t('Suspender')),
        manual && m.status === 'suspended' && h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({ title: t('Reactivar licencia'), path: `/admin/licenses/${id}/reactivate`, done: reload }) }, t('Reactivar')),
        !manual && h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { await api('POST', `/admin/licenses/${id}/sync`); toast(t('Sincronizada'), 'good'); reload(); } catch (err) { toast(err.message, 'bad'); }
        } }, t('Sincronizar ahora')),
        m.status === 'active' && h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { await api('POST', `/admin/licenses/${id}/resend-key`); toast(t('Clave reenviada al correo de la cuenta'), 'good'); } catch (err) { toast(err.message, 'bad'); }
        } }, t('Reenviar clave')),
        h('button', { class: 'btn btn-danger btn-sm', onclick: () => act({
          title: t('Revocar licencia'), body: t('Desactiva la licencia en el sistema actual y la retira de la cuenta. No se borra nada y queda en el historial.'),
          path: `/admin/licenses/${id}/revoke`, danger: true, done: reload,
        }) }, t('Revocar')))),
    h('section', { class: 'card' }, h('h2', {}, t('Historial de operaciones')), auditTable(d.history)),
  ];
}

// ---------- Integraciones ----------
function integraciones() {
  const section = (title, path, filters, columns) => listView({ title, path, filters, columns, heading: 'h2' });
  const retry = (path, label, load) => h('button', { class: 'btn-link', onclick: async (e) => {
    e.stopPropagation();
    try { await api('POST', path); toast(t('Reintento programado'), 'good'); load(); } catch (err) { toast(err.message, 'bad'); }
  } }, label);
  return [
    h('h1', { class: 'app-title' }, t('Integraciones')),
    ...section(t('Webhooks de PayPal'), '/admin/webhooks', ['failed', 'processed', 'ignored', 'received'], (load) => [
      { label: t('Recibido'), cell: (w) => fmtDateTime(w.received_at) },
      { label: t('Evento'), cell: (w) => h('span', { class: 'mono' }, w.event_type) },
      { label: t('Estado'), cell: (w) => badge(w.processing_status) },
      { label: t('Intentos'), cell: (w) => w.attempts },
      { label: t('Detalle'), cell: (w) => w.error_summary || '' },
      { label: '', cell: (w) => (w.processing_status === 'failed' ? retry(`/admin/webhooks/${w.id}/reprocess`, t('Reprocesar'), load) : '') },
    ]),
    ...section(t('Tareas en segundo plano'), '/admin/jobs', ['dead', 'pending', 'running', 'done'], (load) => [
      { label: t('Creada'), cell: (j) => fmtDateTime(j.created_at) },
      { label: t('Tipo'), cell: (j) => h('span', { class: 'mono' }, j.type) },
      { label: t('Estado'), cell: (j) => badge(j.status) },
      { label: t('Intentos'), cell: (j) => `${j.attempts}/${j.max_attempts}` },
      { label: t('Último error'), cell: (j) => j.last_error || '' },
      { label: '', cell: (j) => (j.status === 'dead' ? retry(`/admin/jobs/${j.id}/retry`, t('Reintentar'), load) : '') },
    ]),
    ...section(t('Correos'), '/admin/emails', ['failed', 'queued', 'sent'], (load) => [
      { label: t('Creado'), cell: (m) => fmtDateTime(m.created_at) },
      { label: t('Para'), cell: (m) => m.to_email },
      { label: t('Tipo'), cell: (m) => m.message_type },
      { label: t('Estado'), cell: (m) => badge(m.status) },
      { label: t('Error'), cell: (m) => m.last_error || '' },
      { label: '', cell: (m) => (m.status === 'failed' ? retry(`/admin/emails/${m.id}/retry`, t('Reenviar'), load) : '') },
    ]),
  ];
}

// ---------- Auditoría ----------
function auditTable(rows) {
  return table([
    { label: t('Fecha'), cell: (a) => fmtDateTime(a.created_at) },
    { label: t('Acción'), cell: (a) => h('span', { class: 'mono' }, a.action) },
    { label: t('Por'), cell: (a) => a.actor || t('Sistema') },
    { label: t('Detalle'), cell: (a) => (a.metadata && Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : '') },
  ], rows, { empty: t('Sin acciones registradas.') });
}

function auditoria() {
  return listView({
    title: t('Auditoría'), path: '/admin/audit',
    columns: () => [
      { label: t('Fecha'), cell: (a) => fmtDateTime(a.created_at) },
      { label: t('Acción'), cell: (a) => h('span', { class: 'mono' }, a.action) },
      { label: t('Por'), cell: (a) => a.actor || t('Sistema') },
      { label: t('Objetivo'), cell: (a) => `${a.target_type || ''} ${a.target_id || ''}` },
      { label: 'IP', cell: (a) => a.ip || '' },
      { label: t('Detalle'), cell: (a) => (Object.keys(a.metadata || {}).length ? JSON.stringify(a.metadata) : '') },
    ],
  });
}

// ---------- Enrutado ----------
const VIEWS = { resumen, usuarios, productos, suscripciones, pagos, licencias, integraciones, auditoria };
const DETAIL = { usuarios: usuario, suscripciones: suscripcion, licencias: licencia };

const content = h('div', { class: 'content', id: 'contenido' });
const side = h('nav', { class: 'side' });

async function route() {
  const [section = 'resumen', id] = location.hash.slice(1).split('/');
  const key = VIEWS[section] ? section : 'resumen';
  for (const a of side.querySelectorAll('a')) {
    if (a.dataset.k === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  content.replaceChildren(loading());
  try {
    const view = id && DETAIL[key] ? await DETAIL[key](id) : await VIEWS[key]();
    content.replaceChildren(...[view].flat().filter(Boolean));
  } catch (err) {
    content.replaceChildren(h('p', { class: 'notice notice-bad' }, err.message));
  }
  content.querySelector('h1')?.focus?.();
}

// Pinta la estructura en el idioma actual; se repite al cambiar de idioma.
function shell() {
  side.setAttribute('aria-label', t('Secciones'));
  side.replaceChildren(...SECTIONS.map(([k, label]) => h('a', { href: `#${k}`, dataset: { k } }, t(label))));
  root.replaceChildren(
    h('header', { class: 'app-nav' }, brand(), h('div', { class: 'nav-end' },
      h('span', { class: 'app-user' }, user.email),
      langSelect(h, shell),
      h('a', { class: 'btn btn-ghost btn-sm', href: '../cuenta/' }, t('Mi cuenta')),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await logout(); location.assign('../'); } }, t('Salir')))),
    h('main', { class: 'app-main' }, h('div', { class: 'layout' }, side, content)));
  route();
}

(async () => {
  await useLang();
  user = await me().catch(() => null);
  if (!user) return location.replace(`../entrar/?next=${encodeURIComponent(location.pathname)}`);
  if (user.role !== 'admin') {
    return root.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'card auth-card' },
      h('h1', { class: 'app-title' }, t('Sin acceso')), h('p', { class: 'muted' }, t('Esta sección es solo para administradores.')),
      h('a', { class: 'btn', href: '../cuenta/' }, t('Ir a mi cuenta')))));
  }
  window.addEventListener('hashchange', route);
  shell();
})();
