// Traducción de los paneles. El texto en español del código es la clave; cada idioma tiene su JSON
// en ./i18n/ con la traducción de cada frase. Lo que falte se muestra en español.
import { LANGS, detect, remember } from '../lang.js';

const loaders = import.meta.glob('./i18n/*.json', { import: 'default' });
const NAMES = { es: 'ES', en: 'EN', pt: 'PT', fr: 'FR', de: 'DE', it: 'IT' };

let dict = {};
let current = 'es';

export const lang = () => current;

// t('Hola, {name}', { name }) → «Hello, Ana»
export function t(text, vars) {
  const out = dict[text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : out;
}

export async function useLang(l = detect(), { save = false } = {}) {
  if (!LANGS.includes(l)) l = 'es';
  dict = l === 'es' ? {} : await loaders[`./i18n/${l}.json`]();
  current = l;
  if (save) remember(l);
  document.documentElement.lang = l;
  return l;
}

// Selector de idioma igual al de la landing. onChange vuelve a pintar la página.
export function langSelect(h, onChange) {
  const id = `lang-${Math.random().toString(36).slice(2, 7)}`;
  const select = h('select', { id, class: 'lang', 'aria-label': t('Idioma') },
    ...LANGS.map((l) => h('option', { value: l, selected: l === current }, NAMES[l])));
  select.addEventListener('change', async () => {
    await useLang(select.value, { save: true });
    onChange();
  });
  return select;
}
