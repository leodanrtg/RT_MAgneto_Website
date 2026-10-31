// Idiomas de la web y preferencia del visitante. Lo comparten la landing y los paneles,
// así que el idioma elegido en uno se mantiene en el otro.
export const LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it', 'tr', 'fa', 'ar'];
export const RTL = ['fa', 'ar'];
export const dirOf = (lang) => (RTL.includes(lang) ? 'rtl' : 'ltr');
const STORE_KEY = 'rtm-lang';

function stored() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

export function remember(lang) {
  try { localStorage.setItem(STORE_KEY, lang); } catch { /* sin almacenamiento */ }
}

// Idioma guardado o, si no hay, el del navegador del visitante. Si no hablamos ninguno de sus idiomas, inglés.
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
