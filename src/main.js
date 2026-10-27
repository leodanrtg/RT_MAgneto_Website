import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { detect, setLang, t } from './i18n.js';

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
root.classList.add('js');
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = reducedQuery.matches;

const setYear = () => {
  const yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
};
setYear();

// ---------- Capa 3D ----------

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

let world = null;
const canvas = document.getElementById('world');

async function initWorld() {
  if (!hasWebGL()) {
    root.classList.add('no-webgl');
    return;
  }
  try {
    const { createWorld, SCENES } = await import('./scene.js');
    world = createWorld(canvas, { reduced });
    world.resize();
    window.addEventListener('resize', debounce(() => { world.resize(); if (reduced) world.renderOnce(); }, 120));
    if (reduced) bindScenesStatic(SCENES);
    else bindScenesScrubbed(SCENES);
    bindPointer();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) world.stop();
      else world.start();
    });
    world.start();
    if (reduced) world.renderOnce();
  } catch (err) {
    console.error(err);
    root.classList.add('no-webgl');
  }
}

// Un solo timeline, ligado al scroll de toda la página. Cada capítulo aporta
// un fotograma clave; la transición ocurre mientras el capítulo entra en pantalla.
function bindScenesScrubbed(SCENES) {
  let tl;
  const build = () => {
    if (tl) { tl.scrollTrigger?.kill(); tl.kill(); }
    const keys = collectKeys(SCENES);
    const max = Math.max(1, ScrollTrigger.maxScroll(window));
    Object.assign(world.state, keys[0].state);
    tl = gsap.timeline({
      defaults: { ease: 'sine.inOut' },
      scrollTrigger: { start: 0, end: max, scrub: 0.8 },
    });
    for (let i = 1; i < keys.length; i++) {
      const prev = keys[i - 1];
      const next = keys[i];
      const vh = window.innerHeight;
      const end = Math.max(prev.at + 1, next.at - vh * 0.1);
      const start = Math.max(prev.at, next.at - vh * 0.85);
      tl.fromTo(world.state, { ...prev.state }, { ...next.state, duration: Math.max(1, end - start), immediateRender: false }, start);
    }
    // Rellena hasta el final para que la duración del timeline sea la del scroll
    tl.to({}, { duration: 1 }, max - 1);
  };
  build();
  // Las posiciones cambian cuando cargan fuentes e imágenes o cambia el tamaño
  const rebuild = () => { build(); ScrollTrigger.refresh(); };
  window.addEventListener('load', rebuild);
  document.fonts?.ready.then(rebuild);
  window.addEventListener('resize', debounce(rebuild, 200));
  document.addEventListener('langchange', () => requestAnimationFrame(rebuild));
}

function collectKeys(SCENES) {
  const keys = [];
  document.querySelectorAll('[data-scene]').forEach((sec) => {
    const name = sec.dataset.scene;
    const top = sec.getBoundingClientRect().top + window.scrollY;
    const at = name === 'hero' ? 0 : top;
    if (SCENES[name]) keys.push({ at, state: SCENES[name] });
    // El capítulo de regímenes es largo: a mitad de recorrido pasa de gravedad a aceleración
    if (SCENES[name + '2']) keys.push({ at: top + sec.offsetHeight * 0.55, state: SCENES[name + '2'] });
  });
  keys.sort((a, b) => a.at - b.at);
  return keys;
}

// Movimiento reducido: cambio directo de escena al llegar a cada capítulo.
function bindScenesStatic(SCENES) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const name = e.target.dataset.scene;
      const s = SCENES[name + '2'] || SCENES[name];
      if (s) { Object.assign(world.state, s); world.renderOnce(); }
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('[data-scene]').forEach((s) => io.observe(s));
}

function bindPointer() {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;
  window.addEventListener('pointermove', (e) => {
    world.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  }, { passive: true });
}

// ---------- Revelados ----------

function bindReveals() {
  const targets = document.querySelectorAll('.chapter .wrap > *, .archetypes li, .scenarios li, .steps li, .spec-row, .channels li');
  if (reduced) return;
  targets.forEach((el) => el.setAttribute('data-reveal', ''));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const el = e.target;
        const siblings = el.parentElement ? [...el.parentElement.children] : [];
        const idx = Math.max(0, siblings.indexOf(el));
        el.style.transitionDelay = `${Math.min(idx, 5) * 70}ms`;
        el.classList.add('is-in');
        io.unobserve(el);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  targets.forEach((el) => io.observe(el));
}

// ---------- Navegación ----------

function bindNav() {
  const nav = document.querySelector('[data-nav]');
  let last = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const down = y > last + 4;
    const up = y < last - 4;
    if (down && y > 200) nav.classList.add('is-hidden');
    else if (up || y < 200) nav.classList.remove('is-hidden');
    last = y;
  }, { passive: true });
  nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));
}

// ---------- Escalera: volumen / desequilibrio ----------

function bindLadder() {
  const buttons = document.querySelectorAll('[data-ladder]');
  buttons.forEach((b) => b.addEventListener('click', () => {
    buttons.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    world?.setLadder(b.dataset.ladder);
  }));
}

// ---------- Captura del indicador ----------

function bindHotspots() {
  const focus = document.querySelector('[data-focus]');
  const items = [...document.querySelectorAll('.hotspots li')];
  if (!focus || !items.length) return;
  const boxes = [];
  const ensure = (n) => {
    while (boxes.length < n) {
      const b = document.createElement('div');
      b.className = 'box';
      focus.appendChild(b);
      boxes.push(b);
    }
  };
  const activate = (li) => {
    items.forEach((o) => o.classList.toggle('is-active', o === li));
    const rects = li.dataset.spot.split(';').map((r) => r.split(',').map(Number));
    ensure(rects.length);
    boxes.forEach((b, i) => {
      const r = rects[i];
      if (!r) { b.style.opacity = '0'; return; }
      b.style.opacity = '1';
      b.style.left = r[0] + '%';
      b.style.top = r[1] + '%';
      b.style.width = r[2] + '%';
      b.style.height = r[3] + '%';
    });
  };
  activate(items[0]);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) activate(e.target);
  }, { rootMargin: '-40% 0px -50% 0px' });
  items.forEach((li) => {
    io.observe(li);
    li.addEventListener('click', () => activate(li));
  });
}

// ---------- Sentimiento y escenarios ----------

function bindSentiment() {
  const rect = document.querySelector('.sent-reveal');
  if (!rect || reduced) return;
  gsap.fromTo(rect, { attr: { width: 0 } }, {
    attr: { width: 600 }, ease: 'none',
    scrollTrigger: { trigger: '.sentiment-fig', start: 'top 85%', end: 'bottom 45%', scrub: 0.6 },
  });
}

const MINI = {
  // [puntos del precio], punto de entrada
  'pull-up':   { pts: [[8, 112], [30, 104], [52, 92], [70, 66], [88, 58], [104, 70], [118, 76], [138, 64], [160, 52], [182, 44], [204, 37], [232, 34]], entry: [118, 76] },
  'pull-down': { pts: [[8, 44], [30, 52], [52, 64], [70, 86], [88, 94], [104, 82], [118, 74], [138, 88], [160, 100], [182, 108], [204, 114], [232, 117]], entry: [118, 74] },
  'fade':      { pts: [[8, 92], [28, 80], [48, 68], [68, 54], [86, 44], [102, 36], [114, 31], [124, 38], [142, 50], [164, 62], [190, 72], [232, 76]], entry: [118, 33] },
  'break':     { pts: [[8, 60], [28, 72], [48, 86], [66, 100], [84, 112], [100, 117], [114, 120], [128, 117], [140, 121], [160, 130], [190, 138], [232, 146]], entry: [142, 121] },
};

function buildMinis() {
  const ns = 'http://www.w3.org/2000/svg';
  document.querySelectorAll('[data-mini]').forEach((svg) => {
    const d = MINI[svg.dataset.mini];
    if (!d) return;
    const add = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      svg.appendChild(el);
      return el;
    };
    add('line', { x1: 0, x2: 240, y1: 35, y2: 35, class: 'lvl lvl-pos' });
    add('line', { x1: 0, x2: 240, y1: 75, y2: 75, class: 'lvl lvl-zero' });
    add('line', { x1: 0, x2: 240, y1: 115, y2: 115, class: 'lvl lvl-neg' });
    add('text', { x: 6, y: 29 }).textContent = 'Max GEX+';
    add('text', { x: 6, y: 69 }).textContent = 'Zero Gamma';
    add('text', { x: 6, y: 109 }).textContent = 'Max GEX−';
    const path = add('path', { class: 'price', d: smoothPath(d.pts) });
    const dot = add('circle', { class: 'entry', cx: d.entry[0], cy: d.entry[1], r: 4.5 });
    if (!reduced) {
      const len = path.getTotalLength();
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
      dot.style.opacity = '0';
      ScrollTrigger.create({
        trigger: svg, start: 'top 85%', once: true,
        onEnter: () => {
          gsap.to(path.style, { strokeDashoffset: 0, duration: 1.6, ease: 'power3.out' });
          gsap.to(dot.style, { opacity: 1, duration: 0.4, delay: 0.7 });
        },
      });
    }
  });
}

function smoothPath(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

// ---------- Formulario ----------

function bindSignup() {
  const form = document.querySelector('[data-signup]');
  if (!form) return;
  const input = form.querySelector('input');
  const msg = form.querySelector('.form-msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim());
    input.setAttribute('aria-invalid', String(!ok));
    msg.classList.toggle('is-error', !ok);
    if (!ok) {
      msg.textContent = t('js.emailInvalid');
      input.focus();
      return;
    }
    const endpoint = form.dataset.endpoint;
    if (!endpoint) {
      // Aún no hay servicio de correo conectado
      msg.textContent = t('js.emailPending');
      return;
    }
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.value.trim() }) });
      if (!res.ok) throw new Error(String(res.status));
      msg.textContent = t('js.emailOk');
      form.reset();
    } catch {
      msg.classList.add('is-error');
      msg.textContent = t('js.emailError');
    }
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Idioma ----------

function bindLang() {
  document.addEventListener('langchange', () => {
    setYear();
    // Los textos cambian de longitud: recalcular posiciones del scroll
    requestAnimationFrame(() => ScrollTrigger.refresh());
  });
  document.querySelectorAll('[data-lang]').forEach((sel) => {
    sel.addEventListener('change', () => setLang(sel.value, { remember: true }));
  });
  const lang = detect();
  if (lang !== 'es') setLang(lang);
  else document.querySelectorAll('[data-lang]').forEach((s) => { s.value = 'es'; });
}

bindLang();
buildMinis();
bindReveals();
bindNav();
bindLadder();
bindHotspots();
bindSentiment();
bindSignup();
initWorld();
