import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../styles.css';
import './app.css';
import { api, logout, me } from './api.js';
import {
  STATUS_LABEL, badge, brand, dialog, field, fmtDate, fmtDateTime, fmtInterval, fmtMoney, h, loading, pager, showErrors, table, toast,
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

// Ejecuta una acción con confirmación y motivo obligatorio, y refresca la vista.
async function act({ title, body, path, fields = [{ name: 'reason', label: 'Motivo (queda registrado)', required: true }], danger, done, transform = (v) => v }) {
  const values = await dialog({ title, body, fields, danger, confirmLabel: title });
  if (!values) return;
  try {
    await api('POST', path, transform(values));
    toast('Hecho', 'good');
    done?.();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function listView({ title, path, filters = [], columns, onRow, intro, heading = 'h1' }) {
  const state = { page: 1, search: '', status: '' };
  const results = h('div', {});
  const load = async () => {
    results.replaceChildren(loading());
    const q = new URLSearchParams({ page: state.page });
    if (state.search) q.set('search', state.search);
    if (state.status) q.set('status', state.status);
    try {
      const data = await api('GET', `${path}?${q}`);
      results.replaceChildren(table(columns(load), data.items, { onRow }), pager({ ...data, page: state.page }, (p) => { state.page = p; load(); }));
    } catch (err) {
      results.replaceChildren(h('p', { class: 'notice notice-bad' }, err.message));
    }
  };
  const form = h('form', { class: 'toolbar', role: 'search' },
    field({ name: 'search', label: 'Buscar', type: 'search' }),
    filters.length > 0 && field({ name: 'status', label: 'Estado', options: [['', 'Todos'], ...filters.map((s) => [s, STATUS_LABEL[s] || s])] }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, 'Filtrar'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    Object.assign(state, { page: 1, search: v.search || '', status: v.status || '' });
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
    h('h1', { class: 'app-title' }, 'Resumen'),
    d.licenseEngine === 'simulated' && h('p', { class: 'notice notice-bad' },
      'Motor de licencias SIMULADO: las licencias no se crean en el sistema real de RT Indicators. Falta conectar el sistema actual.'),
    h('h2', { class: 'h3' }, 'Ingresos'),
    h('dl', { class: 'grid' },
      stat('Cobrado hoy', money(d.revenue, 'today_cents'), 'Pagos completados, menos reembolsos'),
      stat('Cobrado este mes', money(d.revenue, 'month_cents'), 'Pagos completados, menos reembolsos'),
      stat('Recurrente mensual estimado', money(d.mrr, 'mrr_cents'), 'Estimación, no es dinero cobrado')),
    h('h2', { class: 'h3' }, 'Clientes y suscripciones'),
    h('dl', { class: 'grid' },
      stat('Usuarios', d.users.total, `${d.users.new_this_month} nuevos este mes`),
      stat('Suscripciones activas', sum(d.subscriptions, ['active', 'grace']), `${d.subscriptions.grace || 0} en gracia`),
      stat('Pendientes', sum(d.subscriptions, ['approval_pending', 'payment_pending'])),
      stat('Canceladas (con acceso)', d.subscriptions.canceled || 0),
      stat('Vencidas o impagadas', sum(d.subscriptions, ['expired', 'unpaid', 'suspended']))),
    h('h2', { class: 'h3' }, 'Pagos y licencias'),
    h('dl', { class: 'grid' },
      stat('Pagos confirmados', d.payments.completed || 0),
      stat('Pagos fallidos', d.payments.failed || 0),
      stat('Reembolsos y contracargos', sum(d.payments, ['refunded', 'partially_refunded', 'reversed'])),
      stat('Licencias activas', d.licenses.active || 0),
      stat('Licencias pendientes', d.licenses.pending || 0),
      stat('Licencias suspendidas', d.licenses.suspended || 0),
      stat('Licencias vencidas', d.licenses.expired || 0),
      stat('Errores de integración', errors, `${d.integrationErrors.webhooks} webhooks · ${d.integrationErrors.jobs} tareas · ${d.integrationErrors.emails} correos`)),
  ];
}

// ---------- Usuarios ----------
function usuarios() {
  return listView({
    title: 'Usuarios', path: '/admin/users', filters: ['active', 'suspended'],
    onRow: (u) => { location.hash = `#usuarios/${u.id}`; },
    columns: () => [
      { label: 'Nombre', cell: (u) => u.name },
      { label: 'Correo', cell: (u) => u.email },
      { label: 'Rol', cell: (u) => STATUS_LABEL[u.role] },
      { label: 'Estado', cell: (u) => badge(u.status) },
      { label: 'Verificado', cell: (u) => (u.email_verified_at ? 'Sí' : 'No') },
      { label: 'Alta', cell: (u) => fmtDate(u.created_at) },
    ],
  });
}

async function usuario(id) {
  const d = await api('GET', `/admin/users/${id}`);
  const reload = () => route();
  const u = d.user;
  const noteForm = h('form', { class: 'form' },
    field({ name: 'body', label: 'Nueva nota interna', type: 'textarea', required: true }), h('p', { 'data-error': '' }),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, 'Añadir nota'));
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/admin/users/${id}/notes`, Object.fromEntries(new FormData(noteForm))); reload(); } catch (err) { showErrors(noteForm, err); }
  });
  const suspended = u.status === 'suspended';
  return [
    h('p', {}, h('a', { href: '#usuarios' }, '← Usuarios')),
    h('div', { class: 'card-head' }, h('h1', { class: 'app-title' }, u.name), badge(u.status)),
    h('section', { class: 'card' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Correo'), h('dd', {}, u.email),
        h('dt', {}, 'Rol'), h('dd', {}, STATUS_LABEL[u.role]),
        h('dt', {}, 'Correo verificado'), h('dd', {}, u.email_verified_at ? fmtDateTime(u.email_verified_at) : 'No'),
        h('dt', {}, 'Registro'), h('dd', {}, fmtDateTime(u.created_at))),
      u.id !== user.id && h('div', { class: 'actions' },
        h('button', { class: `btn btn-sm ${suspended ? '' : 'btn-danger'}`, onclick: () => act({
          title: suspended ? 'Reactivar cuenta' : 'Suspender cuenta',
          body: suspended ? 'El cliente podrá volver a entrar.' : 'Se cerrarán sus sesiones y no podrá entrar. Sus licencias no cambian.',
          path: `/admin/users/${id}/status`, danger: !suspended, done: reload,
          transform: (v) => ({ ...v, status: suspended ? 'active' : 'suspended' }),
        }) }, suspended ? 'Reactivar cuenta' : 'Suspender cuenta'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => manualLicense(id, reload) }, 'Crear licencia manual'))),
    h('section', { class: 'card' }, h('h2', {}, 'Suscripciones'), table([
      { label: 'Producto', cell: (s) => `${s.product} · ${s.plan}` },
      { label: 'Estado', cell: (s) => badge(s.status) },
      { label: 'PayPal', cell: (s) => h('span', { class: 'mono' }, s.paypal_subscription_id || '—') },
      { label: 'Acceso hasta', cell: (s) => fmtDate(s.access_until) },
      { label: 'Renovación', cell: (s) => (s.cancel_at_period_end ? 'Cancelada' : fmtDate(s.current_period_end)) },
    ], d.subscriptions, { onRow: (s) => { location.hash = `#suscripciones/${s.id}`; } })),
    h('section', { class: 'card' }, h('h2', {}, 'Licencias'), table([
      { label: 'Producto', cell: (l) => l.product },
      { label: 'ID externo', cell: (l) => h('span', { class: 'mono' }, l.external_license_id || '—') },
      { label: 'Clave', cell: (l) => (l.key_hint ? `•••• ${l.key_hint}` : '—') },
      { label: 'Estado', cell: (l) => badge(l.status) },
      { label: 'Vence', cell: (l) => fmtDate(l.expires_at) },
    ], d.licenses, { onRow: (l) => { location.hash = `#licencias/${l.id}`; } })),
    h('section', { class: 'card' }, h('h2', {}, 'Pagos'), paymentsTable(d.payments)),
    h('section', { class: 'card' }, h('h2', {}, 'Notas de soporte'),
      d.notes.length ? h('ul', { style: 'display:grid;gap:.75rem' }, ...d.notes.map((n) => h('li', {},
        h('p', {}, n.body), h('small', { class: 'note' }, `${n.author} · ${fmtDateTime(n.created_at)}`)))) : h('p', { class: 'note' }, 'Sin notas.'),
      noteForm),
    h('section', { class: 'card' }, h('h2', {}, 'Historial'), auditTable(d.actions)),
  ];
}

async function manualLicense(userId, done) {
  const { products } = await api('GET', '/admin/products');
  await act({
    title: 'Crear licencia manual',
    body: 'Crea una licencia sin suscripción (soporte, pruebas o acuerdos especiales). Se envía la clave al correo de la cuenta.',
    path: '/admin/licenses',
    fields: [
      { name: 'productId', label: 'Producto', options: products.map((p) => [p.id, p.name]), required: true },
      { name: 'days', label: 'Días de vigencia', type: 'number', min: 1, max: 3660, required: true, value: '30' },
      { name: 'reason', label: 'Motivo (queda registrado)', required: true },
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
    { name: 'name', label: 'Nombre', required: true, value: p.name || '' },
    { name: 'slug', label: 'Identificador interno', required: true, value: p.slug || '', hint: 'Minúsculas, números y guiones. No cambia después.' },
    { name: 'platform', label: 'Plataforma compatible', required: true, value: p.platform || '', placeholder: 'NinjaTrader 8' },
    { name: 'description', label: 'Descripción', type: 'textarea', value: p.description || '' },
    { name: 'licenseProductRef', label: 'ID del producto en el sistema de licencias', value: p.license_product_ref || '' },
    { name: 'activationPolicy', label: 'Política de activaciones', value: p.activation_policy || '', placeholder: 'Una máquina por licencia (HWID)' },
    { name: 'status', label: 'Estado', options: [['draft', 'Borrador'], ['active', 'Activo'], ['archived', 'Archivado']], value: p.status || 'draft' },
  ];
  const saveProduct = async (p) => {
    const v = await dialog({ title: p ? 'Editar producto' : 'Nuevo producto', fields: productFields(p).filter((f) => !(p && f.name === 'slug')), confirmLabel: 'Guardar' });
    if (!v) return;
    try {
      await api(p ? 'PATCH' : 'POST', p ? `/admin/products/${p.id}` : '/admin/products', { ...v, licenseProductRef: v.licenseProductRef || null });
      toast('Producto guardado', 'good');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  };
  const newPlan = async (p) => {
    const v = await dialog({
      title: `Nuevo plan · ${p.name}`,
      body: 'El precio y la periodicidad no se pueden cambiar después de crear el plan en PayPal: para otro precio se crea otro plan.',
      fields: [
        { name: 'name', label: 'Nombre', required: true, placeholder: 'Mensual' },
        { name: 'price', label: 'Precio', type: 'number', min: 1, step: '0.01', required: true },
        { name: 'currency', label: 'Moneda', options: [['USD', 'USD'], ['EUR', 'EUR']], value: 'USD' },
        { name: 'interval', label: 'Periodicidad', options: [['month', 'Mensual'], ['year', 'Anual'], ['week', 'Semanal'], ['day', 'Diaria']], value: 'month' },
        { name: 'intervalCount', label: 'Cada cuántos periodos', type: 'number', min: 1, max: 12, value: '1', required: true },
        { name: 'graceDays', label: 'Días de gracia ante impago', type: 'number', min: 0, max: 30, value: '3', required: true },
      ],
      confirmLabel: 'Crear plan',
    });
    if (!v) return;
    try {
      await api('POST', '/admin/plans', {
        productId: p.id, name: v.name, priceCents: Math.round(Number(v.price) * 100), currency: v.currency,
        interval: v.interval, intervalCount: Number(v.intervalCount), graceDays: Number(v.graceDays),
      });
      toast('Plan creado como borrador', 'good');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  };
  const planAction = async (plan, path, body, message) => {
    try { await api(path.startsWith('PATCH') ? 'PATCH' : 'POST', path.replace(/^PATCH /, ''), body); toast(message, 'good'); reload(); } catch (err) { toast(err.message, 'bad'); }
  };
  return [
    h('div', { class: 'card-head' }, h('h1', { class: 'app-title' }, 'Productos y planes'),
      h('button', { class: 'btn btn-sm', onclick: () => saveProduct() }, 'Nuevo producto')),
    products.length ? null : h('p', { class: 'empty' }, 'Crea tu primer producto, por ejemplo RT Magneto para NinjaTrader 8.'),
    ...products.map((p) => h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, p.name), h('div', { class: 'actions' }, badge(p.status),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => saveProduct(p) }, 'Editar'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => newPlan(p) }, 'Nuevo plan'))),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Identificador'), h('dd', { class: 'mono' }, p.slug),
        h('dt', {}, 'Plataforma'), h('dd', {}, p.platform),
        h('dt', {}, 'ID en licencias'), h('dd', { class: 'mono' }, p.license_product_ref || '—'),
        h('dt', {}, 'Activaciones'), h('dd', {}, p.activation_policy || '—')),
      table([
        { label: 'Plan', cell: (pl) => pl.name },
        { label: 'Precio', cell: (pl) => `${fmtMoney(pl.price_cents, pl.currency)} ${fmtInterval(pl.billing_interval, pl.interval_count)}` },
        { label: 'Gracia', cell: (pl) => `${pl.grace_days} días` },
        { label: 'PayPal', cell: (pl) => h('span', { class: 'mono' }, pl.paypal_plan_id || 'Sin crear') },
        { label: 'Estado', cell: (pl) => badge(pl.status) },
        { label: '', cell: (pl) => h('div', { class: 'actions' },
          !pl.paypal_plan_id && h('button', { class: 'btn-link', onclick: () => planAction(pl, `/admin/plans/${pl.id}/paypal`, undefined, 'Plan creado en PayPal') }, 'Crear en PayPal'),
          pl.paypal_plan_id && pl.status !== 'active' && h('button', { class: 'btn-link', onclick: () => planAction(pl, `PATCH /admin/plans/${pl.id}`, { status: 'active' }, 'Plan activado') }, 'Activar'),
          pl.status === 'active' && h('button', { class: 'btn-link', onclick: () => planAction(pl, `PATCH /admin/plans/${pl.id}`, { status: 'archived' }, 'Plan archivado') }, 'Archivar')) },
      ], p.plans, { empty: 'Sin planes.' }))),
  ];
}

// ---------- Suscripciones ----------
function suscripciones() {
  return listView({
    title: 'Suscripciones', path: '/admin/subscriptions',
    filters: ['active', 'grace', 'payment_pending', 'approval_pending', 'canceled', 'unpaid', 'suspended', 'expired'],
    onRow: (s) => { location.hash = `#suscripciones/${s.id}`; },
    columns: () => [
      { label: 'Cliente', cell: (s) => s.email },
      { label: 'Producto', cell: (s) => `${s.product} · ${s.plan}` },
      { label: 'Estado', cell: (s) => badge(s.status) },
      { label: 'PayPal', cell: (s) => h('span', { class: 'mono' }, `${s.paypal_subscription_id || '—'} ${s.provider_status ? `(${s.provider_status})` : ''}`) },
      { label: 'Acceso hasta', cell: (s) => fmtDate(s.access_until) },
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
        h('dt', {}, 'Cliente'), h('dd', {}, s.email),
        h('dt', {}, 'Suscripción PayPal'), h('dd', { class: 'mono' }, s.paypal_subscription_id || '—'),
        h('dt', {}, 'Estado en PayPal'), h('dd', {}, s.provider_status || '—'),
        h('dt', {}, 'Acceso hasta'), h('dd', {}, fmtDateTime(s.access_until)),
        h('dt', {}, 'Renovación automática'), h('dd', {}, s.cancel_at_period_end ? 'Cancelada' : 'Sí'),
        h('dt', {}, 'Creada'), h('dd', {}, fmtDateTime(s.created_at))),
      h('div', { class: 'actions' },
        s.paypal_subscription_id && h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { await api('POST', `/admin/subscriptions/${id}/refresh`); toast('Estado leído de PayPal', 'good'); reload(); } catch (err) { toast(err.message, 'bad'); }
        } }, 'Leer estado de PayPal'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({
          title: 'Ampliar acceso', body: 'Días de cortesía sin cobro. La licencia se actualiza automáticamente.',
          path: `/admin/subscriptions/${id}/extend`, done: reload,
          fields: [{ name: 'days', label: 'Días', type: 'number', min: 1, max: 366, required: true, value: '7' }, { name: 'reason', label: 'Motivo (queda registrado)', required: true }],
          transform: (v) => ({ ...v, days: Number(v.days) }),
        }) }, 'Ampliar acceso'),
        s.status === 'suspended'
          ? h('button', { class: 'btn btn-sm', onclick: () => act({ title: 'Reactivar acceso', path: `/admin/subscriptions/${id}/reactivate`, done: reload }) }, 'Reactivar acceso')
          : h('button', { class: 'btn btn-danger btn-sm', onclick: () => act({
            title: 'Suspender acceso', body: 'Desactiva la licencia aunque el periodo esté pagado. No cancela el cobro en PayPal.',
            path: `/admin/subscriptions/${id}/suspend`, danger: true, done: reload,
          }) }, 'Suspender acceso'))),
  ];
}

// ---------- Pagos ----------
const PAYMENT_COLUMNS = [
  { label: 'Fecha', cell: (p) => fmtDateTime(p.paid_at || p.created_at) },
  { label: 'Cliente', cell: (p) => p.email || '' },
  { label: 'Importe', cell: (p) => fmtMoney(p.amount_cents, p.currency) },
  { label: 'Reembolsado', cell: (p) => (p.refunded_cents ? fmtMoney(p.refunded_cents, p.currency) : '—') },
  { label: 'Tipo', cell: (p) => (p.payment_type === 'initial' ? 'Alta' : 'Renovación') },
  { label: 'Estado', cell: (p) => badge(p.status) },
  { label: 'ID PayPal', cell: (p) => h('span', { class: 'mono' }, p.provider_txn_id) },
];
const paymentsTable = (rows) => table(PAYMENT_COLUMNS, rows, { empty: 'Sin pagos.' });

function pagos() {
  return listView({
    title: 'Pagos', path: '/admin/payments',
    filters: ['completed', 'pending', 'failed', 'refunded', 'partially_refunded', 'reversed'],
    columns: () => PAYMENT_COLUMNS,
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
        d.engine === 'simulated' && h('p', { class: 'notice notice-bad' }, 'Datos del SIMULADOR, no del sistema real.'),
        table([
          { label: 'ID', cell: (l) => h('span', { class: 'mono' }, l.licenseId) },
          { label: 'Cliente', cell: (l) => l.customerName },
          { label: 'Clave', cell: (l) => `•••• ${l.keyHint}` },
          { label: 'HWID', cell: (l) => h('span', { class: 'mono' }, l.hwid || 'Sin activar') },
          { label: 'Vence', cell: (l) => fmtDate(l.expiresAt) },
          { label: 'Activa', cell: (l) => (l.active ? 'Sí' : 'No') },
        ], d.items, { empty: 'No hay licencias en el sistema.' }),
        h('p', { class: 'note' }, `${d.total} licencias en total, incluidas las creadas con la app de escritorio.`)].filter(Boolean));
    } catch (err) {
      external.replaceChildren(h('p', { class: 'notice notice-bad' }, `No se pudo leer el sistema de licencias: ${err.message}`));
    }
  };
  return [
    ...listView({
      title: 'Licencias', path: '/admin/licenses', filters: ['active', 'pending', 'suspended', 'expired', 'revoked'],
      intro: h('p', { class: 'muted' }, 'Licencias vinculadas a cuentas de la web. Las de suscripciones se gestionan desde su suscripción; las manuales, aquí.'),
      onRow: (l) => { location.hash = `#licencias/${l.id}`; },
      columns: () => [
        { label: 'Cliente', cell: (l) => l.email },
        { label: 'Producto', cell: (l) => l.product },
        { label: 'ID externo', cell: (l) => h('span', { class: 'mono' }, l.external_license_id || '—') },
        { label: 'Clave', cell: (l) => (l.key_hint ? `•••• ${l.key_hint}` : '—') },
        { label: 'Estado', cell: (l) => badge(l.status) },
        { label: 'Vence', cell: (l) => fmtDate(l.expires_at) },
        { label: 'Origen', cell: (l) => (l.subscription_id ? 'Suscripción' : 'Manual') },
      ],
    }),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Sistema de licencias actual'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: loadExternal }, 'Consultar')),
      external),
  ];
}

async function licencia(id) {
  const d = await api('GET', `/admin/licenses/${id}`);
  const reload = () => route();
  const m = d.mapping;
  const manual = !m.subscription_id;
  const live = m.status !== 'revoked';
  return [
    h('p', {}, h('a', { href: `#usuarios/${m.user_id}` }, '← Cliente')),
    h('div', { class: 'card-head' }, h('h1', { class: 'app-title' }, 'Licencia'), badge(m.status)),
    h('section', { class: 'card' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'ID en el sistema de licencias'), h('dd', { class: 'mono' }, m.external_license_id || 'Aún no emitida'),
        h('dt', {}, 'Clave'), h('dd', {}, m.key_hint ? `•••• ${m.key_hint}` : '—'),
        h('dt', {}, 'Vence (web)'), h('dd', {}, fmtDateTime(m.expires_at)),
        h('dt', {}, 'Origen'), h('dd', {}, manual ? 'Manual' : h('a', { href: `#suscripciones/${m.subscription_id}` }, 'Suscripción')),
        h('dt', {}, 'Última sincronización'), h('dd', {}, fmtDateTime(m.last_synced_at)),
        d.external && [
          h('dt', {}, 'Vence (sistema actual)'), h('dd', {}, fmtDateTime(d.external.expiresAt)),
          h('dt', {}, 'Activa (sistema actual)'), h('dd', {}, d.external.active ? 'Sí' : 'No'),
          h('dt', {}, 'HWID'), h('dd', { class: 'mono' }, d.external.hwid || 'Sin activar en ningún equipo'),
        ]),
      live && h('div', { class: 'actions' },
        manual && h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({
          title: 'Renovar licencia', path: `/admin/licenses/${id}/renew`, done: reload,
          fields: [{ name: 'days', label: 'Días', type: 'number', min: 1, max: 3660, required: true, value: '30' }, { name: 'reason', label: 'Motivo (queda registrado)', required: true }],
          transform: (v) => ({ ...v, days: Number(v.days) }),
        }) }, 'Renovar'),
        manual && m.status === 'active' && h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({ title: 'Suspender licencia', path: `/admin/licenses/${id}/suspend`, danger: true, done: reload }) }, 'Suspender'),
        manual && m.status === 'suspended' && h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({ title: 'Reactivar licencia', path: `/admin/licenses/${id}/reactivate`, done: reload }) }, 'Reactivar'),
        !manual && h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { await api('POST', `/admin/licenses/${id}/sync`); toast('Sincronizada', 'good'); reload(); } catch (err) { toast(err.message, 'bad'); }
        } }, 'Sincronizar ahora'),
        m.status === 'active' && h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { await api('POST', `/admin/licenses/${id}/resend-key`); toast('Clave reenviada al correo de la cuenta', 'good'); } catch (err) { toast(err.message, 'bad'); }
        } }, 'Reenviar clave'),
        h('button', { class: 'btn btn-danger btn-sm', onclick: () => act({
          title: 'Revocar licencia', body: 'Desactiva la licencia en el sistema actual y la retira de la cuenta. No se borra nada y queda en el historial.',
          path: `/admin/licenses/${id}/revoke`, danger: true, done: reload,
        }) }, 'Revocar'))),
    h('section', { class: 'card' }, h('h2', {}, 'Historial de operaciones'), auditTable(d.history)),
  ];
}

// ---------- Integraciones ----------
function integraciones() {
  const section = (title, path, filters, columns) => listView({ title, path, filters, columns, heading: 'h2' });
  const retry = (path, label, load) => h('button', { class: 'btn-link', onclick: async (e) => {
    e.stopPropagation();
    try { await api('POST', path); toast('Reintento programado', 'good'); load(); } catch (err) { toast(err.message, 'bad'); }
  } }, label);
  return [
    h('h1', { class: 'app-title' }, 'Integraciones'),
    ...section('Webhooks de PayPal', '/admin/webhooks', ['failed', 'processed', 'ignored', 'received'], (load) => [
      { label: 'Recibido', cell: (w) => fmtDateTime(w.received_at) },
      { label: 'Evento', cell: (w) => h('span', { class: 'mono' }, w.event_type) },
      { label: 'Estado', cell: (w) => badge(w.processing_status) },
      { label: 'Intentos', cell: (w) => w.attempts },
      { label: 'Detalle', cell: (w) => w.error_summary || '' },
      { label: '', cell: (w) => (w.processing_status === 'failed' ? retry(`/admin/webhooks/${w.id}/reprocess`, 'Reprocesar', load) : '') },
    ]),
    ...section('Tareas en segundo plano', '/admin/jobs', ['dead', 'pending', 'running', 'done'], (load) => [
      { label: 'Creada', cell: (j) => fmtDateTime(j.created_at) },
      { label: 'Tipo', cell: (j) => h('span', { class: 'mono' }, j.type) },
      { label: 'Estado', cell: (j) => badge(j.status) },
      { label: 'Intentos', cell: (j) => `${j.attempts}/${j.max_attempts}` },
      { label: 'Último error', cell: (j) => j.last_error || '' },
      { label: '', cell: (j) => (j.status === 'dead' ? retry(`/admin/jobs/${j.id}/retry`, 'Reintentar', load) : '') },
    ]),
    ...section('Correos', '/admin/emails', ['failed', 'queued', 'sent'], (load) => [
      { label: 'Creado', cell: (m) => fmtDateTime(m.created_at) },
      { label: 'Para', cell: (m) => m.to_email },
      { label: 'Tipo', cell: (m) => m.message_type },
      { label: 'Estado', cell: (m) => badge(m.status) },
      { label: 'Error', cell: (m) => m.last_error || '' },
      { label: '', cell: (m) => (m.status === 'failed' ? retry(`/admin/emails/${m.id}/retry`, 'Reenviar', load) : '') },
    ]),
  ];
}

// ---------- Auditoría ----------
function auditTable(rows) {
  return table([
    { label: 'Fecha', cell: (a) => fmtDateTime(a.created_at) },
    { label: 'Acción', cell: (a) => h('span', { class: 'mono' }, a.action) },
    { label: 'Por', cell: (a) => a.actor || 'Sistema' },
    { label: 'Detalle', cell: (a) => (a.metadata && Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : '') },
  ], rows, { empty: 'Sin acciones registradas.' });
}

function auditoria() {
  return listView({
    title: 'Auditoría', path: '/admin/audit',
    columns: () => [
      { label: 'Fecha', cell: (a) => fmtDateTime(a.created_at) },
      { label: 'Acción', cell: (a) => h('span', { class: 'mono' }, a.action) },
      { label: 'Por', cell: (a) => a.actor || 'Sistema' },
      { label: 'Objetivo', cell: (a) => `${a.target_type || ''} ${a.target_id || ''}` },
      { label: 'IP', cell: (a) => a.ip || '' },
      { label: 'Detalle', cell: (a) => (Object.keys(a.metadata || {}).length ? JSON.stringify(a.metadata) : '') },
    ],
  });
}

// ---------- Enrutado ----------
const VIEWS = { resumen, usuarios, productos, suscripciones, pagos, licencias, integraciones, auditoria };
const DETAIL = { usuarios: usuario, suscripciones: suscripcion, licencias: licencia };

const content = h('div', { class: 'content', id: 'contenido' });
const side = h('nav', { class: 'side', 'aria-label': 'Secciones' }, ...SECTIONS.map(([k, label]) => h('a', { href: `#${k}`, dataset: { k } }, label)));

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

(async () => {
  user = await me().catch(() => null);
  if (!user) return location.replace(`../entrar/?next=${encodeURIComponent(location.pathname)}`);
  if (user.role !== 'admin') {
    return root.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'card auth-card' },
      h('h1', { class: 'app-title' }, 'Sin acceso'), h('p', { class: 'muted' }, 'Esta sección es solo para administradores.'),
      h('a', { class: 'btn', href: '../cuenta/' }, 'Ir a mi cuenta'))));
  }
  root.replaceChildren(
    h('header', { class: 'app-nav' }, brand(), h('div', { class: 'nav-end' },
      h('span', { class: 'app-user' }, user.email),
      h('a', { class: 'btn btn-ghost btn-sm', href: '../cuenta/' }, 'Mi cuenta'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await logout(); location.assign('../'); } }, 'Salir'))),
    h('main', { class: 'app-main' }, h('div', { class: 'layout' }, side, content)));
  window.addEventListener('hashchange', route);
  route();
})();
