import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../styles.css';
import './app.css';
import { api, me } from './api.js';
import { t, langSelect, useLang } from './i18n.js';
import { brand, busy, field, h, showErrors } from './ui.js';

const root = document.getElementById('app');
let view = () => {}; // vista actual, para volver a pintarla al cambiar de idioma
const params = new URLSearchParams(location.search);
const nextParam = (() => {
  const n = params.get('next');
  // solo rutas internas, para no abrir una redirección a otra web
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
})();
// sin destino pedido, el administrador va a su panel y el cliente a su cuenta
const next = (user) => nextParam ?? (user?.role === 'admin' ? '../admin/' : '../cuenta/');

function clearSecretsFromUrl() {
  history.replaceState(null, '', location.pathname);
}

function shell(mode, ...content) {
  const tab = (m, label, href) => h('a', { href, 'aria-current': mode === m ? 'page' : undefined }, label);
  root.replaceChildren(h('main', { class: 'auth' },
    h('div', { class: 'auth-card card' },
      h('div', { class: 'card-head' }, brand(), langSelect(h, () => view())),
      (mode === 'login' || mode === 'register') && h('nav', { class: 'tabs', 'aria-label': t('Acceso') },
        tab('login', t('Entrar'), '?'), tab('register', t('Crear cuenta'), '?registro=1')),
      ...content)));
}

function form(fields, submitLabel, onSubmit, extra = []) {
  const button = h('button', { class: 'btn', type: 'submit' }, submitLabel);
  const f = h('form', { class: 'form', novalidate: true }, ...fields.map(field), h('p', { 'data-error': '', role: 'alert' }), button, ...extra);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    busy(button, () => onSubmit(Object.fromEntries(new FormData(f)), f)).catch((err) => showErrors(f, err));
  });
  return f;
}

const done = (title, text, link) => [h('h1', { class: 'app-title' }, title), h('p', { class: 'muted' }, text), link];

function login(notice) {
  view = () => login(notice);
  shell('login',
    notice && h('p', { class: 'notice' }, notice),
    form([
      { name: 'email', label: t('Correo'), type: 'email', required: true, autocomplete: 'email' },
      { name: 'password', label: t('Contraseña'), type: 'password', required: true, autocomplete: 'current-password' },
    ], t('Entrar'), async (data) => {
      const res = await api('POST', '/auth/login', data);
      location.assign(next(res?.user));
    }, [h('a', { class: 'note', href: '?recuperar=1' }, t('¿Olvidaste la contraseña?'))]));
}

function register() {
  view = register;
  shell('register', form([
    { name: 'name', label: t('Nombre'), required: true, autocomplete: 'name' },
    { name: 'email', label: t('Correo'), type: 'email', required: true, autocomplete: 'email' },
    { name: 'password', label: t('Contraseña'), type: 'password', required: true, autocomplete: 'new-password', hint: t('Mínimo 10 caracteres.') },
  ], t('Crear cuenta'), async (data, f) => {
    const r = await api('POST', '/auth/register', data);
    f.replaceWith(...done(t('Revisa tu correo'), `${r.message} ${t('Después podrás entrar y elegir tu plan.')}`, h('a', { class: 'btn btn-ghost', href: '?' }, t('Ir a entrar'))));
  }));
}

function forgot() {
  view = forgot;
  shell('forgot', h('h1', { class: 'app-title' }, t('Recuperar contraseña')), form([
    { name: 'email', label: t('Correo de tu cuenta'), type: 'email', required: true, autocomplete: 'email' },
  ], t('Enviar enlace'), async (data, f) => {
    const r = await api('POST', '/auth/forgot-password', data);
    f.replaceWith(h('p', { class: 'form-ok' }, r.message));
  }, [h('a', { class: 'note', href: '?' }, t('Volver'))]));
}

function reset(token) {
  view = () => reset(token);
  clearSecretsFromUrl();
  shell('reset', h('h1', { class: 'app-title' }, t('Nueva contraseña')), form([
    { name: 'password', label: t('Nueva contraseña'), type: 'password', required: true, autocomplete: 'new-password', hint: t('Mínimo 10 caracteres.') },
  ], t('Guardar'), async (data) => {
    await api('POST', '/auth/reset-password', { token, password: data.password });
    login(t('Contraseña actualizada. Ya puedes entrar.'));
  }));
}

async function verify(token) {
  clearSecretsFromUrl();
  try {
    await api('POST', '/auth/verify-email', { token });
    const u = await me();
    if (u) return location.assign(next(u));
    login(t('Correo confirmado. Ya puedes entrar.'));
  } catch (err) {
    login(err.message);
  }
}

useLang().then(() => {
  if (params.get('verificar')) verify(params.get('verificar'));
  else if (params.get('restablecer')) reset(params.get('restablecer'));
  else if (params.get('recuperar')) forgot();
  else if (params.get('registro')) register();
  else me().then((u) => (u ? location.replace(next(u)) : login())).catch(() => login());
});
