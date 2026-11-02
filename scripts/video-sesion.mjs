// Graba el video en bucle de la sesión simulada (scripts/video-sesion/sesion.html).
// Dibuja cada fotograma con Playwright y lo codifica con ffmpeg en MP4 (H.264) y WebM (VP9),
// más un póster WebP con la sesión terminada.
// Uso: npm run video:sesion            (STILL="10 26" guarda solo esos instantes en PNG)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const width = Number(process.env.W || 1920);
const outDir = path.join(root, 'public/video');
const tmp = path.join(root, '.video-tmp');

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width, height: Math.ceil(width * 0.57) + 20 } });
page.on('pageerror', (e) => console.error('error:', e.message));
await page.goto(`file://${path.join(here, 'video-sesion/sesion.html')}?still=0&w=${width}`);
const [duration, fps, touches] = await page.evaluate(() => [window.DURATION, window.FPS, window.TOUCHES]);
console.log(`duración ${duration.toFixed(2)} s · ${fps} fps · ${touches} toques`);
const canvas = page.locator('canvas');

async function frame(t) {
  await page.evaluate((x) => window.renderAt(x), t);
  return canvas.screenshot({ type: 'png' });
}

if (process.env.STILL) {
  await mkdir(tmp, { recursive: true });
  for (const t of process.env.STILL.split(/\s+/)) {
    const file = path.join(tmp, `still-${t}.png`);
    await page.evaluate((x) => window.renderAt(x), Number(t));
    await canvas.screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
await mkdir(outDir, { recursive: true });
const total = Math.round(duration * fps);
for (let f = 0; f < total; f++) {
  const buf = await frame(f / fps);
  await import('node:fs/promises').then((fs) => fs.writeFile(path.join(tmp, `f${String(f).padStart(5, '0')}.png`), buf));
  if (f % 60 === 0) console.log(`fotograma ${f}/${total}`);
}
// póster: la sesión completa, justo antes del fundido
await page.evaluate((x) => window.renderAt(x), duration - 1.2);
await canvas.screenshot({ path: path.join(tmp, 'poster.png') });
await browser.close();

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${c}`))));
  });
}
const input = ['-framerate', String(fps), '-i', path.join(tmp, 'f%05d.png')];
const name = `rt-magneto-sesion-${width}`;
await ffmpeg([...input, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', process.env.CRF_H264 || '19', '-tune', 'animation',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(outDir, `${name}.mp4`)]);
await ffmpeg([...input, '-c:v', 'libvpx-vp9', '-crf', process.env.CRF_VP9 || '31', '-b:v', '0', '-row-mt', '1',
  '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-an', path.join(outDir, `${name}.webm`)]);
await ffmpeg(['-i', path.join(tmp, 'poster.png'), '-c:v', 'libwebp', '-quality', '82', path.join(outDir, `${name}-poster.webp`)]);
await rm(tmp, { recursive: true, force: true });
console.log(`listo: public/video/${name}.{mp4,webm} y póster`);
