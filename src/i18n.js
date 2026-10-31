import es from './i18n/es.json';

// Español es el idioma del HTML. El resto se carga bajo demanda.
export const LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const loaders = import.meta.glob(['./i18n/*.json', '!./i18n/es.json'], { import: 'default' });
const STORE_KEY = 'rtm-lang';

let dict = es;
export const t = (key) => dict[key] ?? es[key] ?? key;

function stored() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

// Idioma del navegador del visitante, que sigue la configuración de su país o sistema.
// Si no hablamos ninguno de sus idiomas, inglés.
export function detect() {
  const saved = stored();
  if (LANGS.includes(saved)) return saved;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'es'];
  for (const p of prefs) {
    const code = String(p).toLowerCase().split('-')[0];
    if (LANGS.includes(code)) return code;
  }
  return 'en';
}

export async function setLang(lang, { remember = false } = {}) {
  if (!LANGS.includes(lang)) lang = 'es';
  dict = lang === 'es' ? es : await loaders[`./i18n/${lang}.json`]();
  if (remember) { try { localStorage.setItem(STORE_KEY, lang); } catch { /* sin almacenamiento */ } }

  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = dict[el.dataset.i18n];
    if (v != null) el.innerHTML = v;
  });
  for (const attr of ['alt', 'aria-label', 'placeholder', 'title']) {
    document.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
      const v = dict[el.getAttribute(`data-i18n-${attr}`)];
      if (v != null) el.setAttribute(attr, v);
    });
  }
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  document.querySelectorAll('[data-lang]').forEach((s) => { s.value = lang; });
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  return lang;
}
