// Utilidades de interfaz para los paneles. Todo el texto entra con textContent: nada de innerHTML con datos.
import { lang, t } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Formatos según el idioma elegido
const fmtCache = new Map();
const intl = (kind, opts) => {
  const key = `${lang()}|${kind}|${JSON.stringify(opts)}`;
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl[kind](lang(), opts));
  return fmtCache.get(key);
};
export const fmtDate = (v) => (v ? intl('DateTimeFormat', { dateStyle: 'medium' }).format(new Date(v)) : '—');
export const fmtDateTime = (v) => (v ? intl('DateTimeFormat', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—');
export const fmtMoney = (cents, currency) =>
  intl('NumberFormat', { style: 'currency', currency: currency || 'USD' }).format((cents || 0) / 100);

const EVERY = { day: 'cada día', week: 'cada semana', month: 'cada mes', year: 'cada año' };
const EVERY_N = { day: 'cada {n} días', week: 'cada {n} semanas', month: 'cada {n} meses', year: 'cada {n} años' };
export const fmtInterval = (unit, count = 1) => (count === 1 ? t(EVERY[unit]) : t(EVERY_N[unit], { n: count }));

const STATUS_LABEL = {
  approval_pending: 'Pendiente de aprobación', active: 'Activa', grace: 'En periodo de gracia', payment_pending: 'Pago pendiente',
  unpaid: 'Impagada', suspended: 'Suspendida', canceled: 'Cancelada', expired: 'Terminada',
  pending: 'Pendiente', completed: 'Completado', failed: 'Fallido', refunded: 'Reembolsado', partially_refunded: 'Reembolso parcial', reversed: 'Revertido',
  revoked: 'Revocada', draft: 'Borrador', archived: 'Archivado',
  processed: 'Procesado', ignored: 'Ignorado', received: 'Recibido', queued: 'En cola', sent: 'Enviado', dead: 'Fallo definitivo', done: 'Hecho', running: 'En curso',
  customer: 'Cliente', admin: 'Administrador',
};
const TONE = {
  active: 'good', completed: 'good', processed: 'good', sent: 'good', done: 'good',
  grace: 'warn', payment_pending: 'warn', pending: 'warn', approval_pending: 'warn', queued: 'warn', partially_refunded: 'warn', canceled: 'warn',
  unpaid: 'bad', suspended: 'bad', failed: 'bad', refunded: 'bad', reversed: 'bad', revoked: 'bad', dead: 'bad',
};
export const statusLabel = (status) => (STATUS_LABEL[status] ? t(STATUS_LABEL[status]) : status);
export const badge = (status) => h('span', { class: `badge ${TONE[status] ? `badge-${TONE[status]}` : ''}` }, statusLabel(status));

let toastTimer;
export function toast(message, tone = 'info') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 4500);
}

// Diálogo modal accesible. fields: [{ name, label, type, required, value, options }]
// Devuelve los valores o null si se cancela.
export function dialog({ title, body, fields = [], confirmLabel = t('Confirmar'), danger = false }) {
  return new Promise((resolve) => {
    const form = h('form', { class: 'dialog-form', method: 'dialog' },
      h('h2', { class: 'dialog-title' }, title),
      body && h('p', { class: 'muted' }, body),
      ...fields.map((f) => field(f)),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', value: 'cancel', onclick: () => { dlg.close(); } }, t('Cancelar')),
        h('button', { type: 'submit', class: `btn btn-sm ${danger ? 'btn-danger' : ''}` }, confirmLabel)),
    );
    const dlg = h('dialog', { class: 'dialog' }, form);
    let result = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      result = Object.fromEntries(new FormData(form));
      dlg.close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function field({ name, label, type = 'text', required = false, value = '', options, autocomplete, hint, min, max, step, placeholder }) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const control = options
    ? h('select', { id, name, required }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)))
    : type === 'textarea'
      ? h('textarea', { id, name, required, rows: 4, placeholder }, value)
      : h('input', { id, name, type, required, value, autocomplete, min, max, step, placeholder });
  return h('label', { class: 'f-field', for: id }, h('span', {}, label), control, hint && h('small', { class: 'note' }, hint));
}

// Muestra los errores de validación del servidor junto a cada campo.
export function showErrors(form, err) {
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
  const general = form.querySelector('[data-error]');
  if (general) general.textContent = err.fields?.length ? '' : err.message;
  for (const f of err.fields || []) {
    const input = form.querySelector(`[name="${CSS.escape(f.field)}"]`);
    input?.closest('.f-field')?.append(h('small', { class: 'field-error' }, f.message));
  }
}

export async function busy(button, fn) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

// Tabla con estado vacío y paginación. columns: [{ label, cell: (row) => Node|string }]
export function table(columns, rows, { empty = t('No hay resultados.'), onRow } = {}) {
  if (!rows.length) return h('p', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ...columns.map((c) => h('th', { scope: 'col' }, c.label)))),
      h('tbody', {}, ...rows.map((r) => h('tr', { class: onRow ? 'is-link' : undefined, onclick: onRow ? () => onRow(r) : undefined },
        ...columns.map((c) => h('td', { 'data-label': c.label }, c.cell(r))))))));
}

export function pager({ page, total, pageSize }, go) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return h('p', { class: 'note' }, total === 1 ? t('1 resultado') : t('{n} resultados', { n: total }));
  return h('nav', { class: 'pager', 'aria-label': t('Paginación') },
    h('button', { class: 'btn btn-ghost btn-sm', disabled: page <= 1, onclick: () => go(page - 1) }, t('Anterior')),
    h('span', { class: 'note' }, t('Página {page} de {pages} · {total} resultados', { page, pages, total })),
    h('button', { class: 'btn btn-ghost btn-sm', disabled: page >= pages, onclick: () => go(page + 1) }, t('Siguiente')));
}

export const loading = () => h('p', { class: 'loading', role: 'status' }, t('Cargando…'));

export const brand = () => {
  const svg = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 9h22" stroke="var(--gex-pos)" stroke-width="2.4" stroke-linecap="round"/><path d="M5 16h22" stroke="var(--zero)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 4.2"/><path d="M5 23h22" stroke="var(--gex-neg)" stroke-width="2.4" stroke-linecap="round"/><circle cx="19" cy="9" r="3.6" fill="var(--ink)" stroke="var(--text)" stroke-width="2"/></svg>',
    'image/svg+xml').documentElement;
  return h('a', { class: 'brand', href: '../' }, document.importNode(svg, true), h('span', {}, 'RT Magneto'));
};
