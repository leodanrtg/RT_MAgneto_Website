import es from './i18n/es.json';
import { LANGS, detect, remember as rememberLang } from './lang.js';

export { LANGS, detect };

// Español es el idioma del HTML. El resto se carga bajo demanda.
const loaders = import.meta.glob(['./i18n/*.json', '!./i18n/es.json'], { import: 'default' });

let dict = es;
export const t = (key) => dict[key] ?? es[key] ?? key;

export async function setLang(lang, { remember = false } = {}) {
  if (!LANGS.includes(lang)) lang = 'es';
  dict = lang === 'es' ? es : await loaders[`./i18n/${lang}.json`]();
  if (remember) rememberLang(lang);

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
