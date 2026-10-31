// Comprueba que cada texto de los paneles tiene traducción en todos los idiomas.
// Uso: node scripts/check-panel-i18n.mjs [--list]   (--list imprime las claves en JSON)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'src/app';
const keys = new Set();
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(unq(m[1]));
  // tablas de textos que se traducen al usarse
  for (const b of src.matchAll(/const (?:STATUS_LABEL|EVERY|EVERY_N|SECTIONS) = [[{]([\s\S]*?)\n?[\]}];/g)) {
    for (const m of b[1].matchAll(/(?::|\[\s*'[a-z_]+',)\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(unq(m[1]));
  }
}
const list = [...keys].sort();
if (process.argv.includes('--list')) {
  console.log(JSON.stringify(list, null, 1));
  process.exit(0);
}
let missing = 0;
for (const lang of ['en', 'pt', 'fr', 'de', 'it']) {
  const dict = JSON.parse(readFileSync(join(dir, 'i18n', `${lang}.json`), 'utf8'));
  for (const k of list) {
    if (typeof dict[k] !== 'string' || !dict[k]) { console.error(`${lang}: falta «${k}»`); missing++; continue; }
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    if (vars(k) !== vars(dict[k])) { console.error(`${lang}: variables distintas en «${k}»`); missing++; }
  }
  for (const k of Object.keys(dict)) if (!keys.has(k)) console.warn(`${lang}: sobra «${k}»`);
}
if (missing) { console.error(`${missing} traducciones pendientes`); process.exit(1); }
console.log(`Paneles: ${list.length} textos traducidos en 5 idiomas.`);
