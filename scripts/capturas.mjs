// Recorre la web capítulo a capítulo y guarda capturas de escritorio y móvil.
// Uso: npm run build && npm run preview (en otra terminal) y luego npm run capturas
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.env.URL || 'http://localhost:4173/';
const out = process.env.OUT || 'capturas';
const devices = {
  escritorio: { viewport: { width: 1440, height: 900 } },
  movil: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const [name, opts] of Object.entries(devices)) {
  const page = await browser.newPage(opts);
  page.on('pageerror', (e) => console.error(`[${name}] error:`, e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Secciones con escena propia y cada paso del recorrido 3D del indicador
  const ids = await page.$$eval('[data-scene], [data-cam]', (els) =>
    els.map((el) => (el.dataset.cam ? `cam:${el.dataset.cam}` : el.id)),
  );
  for (const [i, id] of ids.entries()) {
    await page.evaluate((id) => {
      document.documentElement.style.scrollBehavior = 'auto';
      const el = id.startsWith('cam:')
        ? document.querySelector(`[data-cam="${id.slice(4)}"]`)
        : document.getElementById(id);
      window.scrollTo(0, id === 'hero' ? 0 : el.getBoundingClientRect().top + window.scrollY);
    }, id);
    await page.waitForTimeout(1800); // deja que la escena 3D termine la transición
    const file = `${out}/${name}-${String(i + 1).padStart(2, '0')}-${id.replace('cam:', '')}.png`;
    await page.screenshot({ path: file });
    console.log(file);
  }
  await page.close();
}
await browser.close();
