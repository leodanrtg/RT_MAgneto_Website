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
    world.setLabels(t);
    document.addEventListener('langchange', () => world.setLabels(t));
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
  // Pasos del recorrido del indicador: un fotograma por paso
  document.querySelectorAll('[data-cam]').forEach((el) => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    if (SCENES[el.dataset.cam]) keys.push({ at: top, state: SCENES[el.dataset.cam] });
  });
  keys.sort((a, b) => a.at - b.at);
  return keys;
}

// Movimiento reducido: cambio directo de escena al llegar a cada capítulo.
function bindScenesStatic(SCENES) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const name = e.target.dataset.scene || e.target.dataset.cam;
      const s = SCENES[name + '2'] || SCENES[name];
      if (s) { Object.assign(world.state, s); world.renderOnce(); }
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('[data-scene], [data-cam]').forEach((s) => io.observe(s));
}

function bindPointer() {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;
  window.addEventListener('pointermove', (e) => {
    world.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  }, { passive: true });
}

// ---------- Revelados ----------

function bindReveals() {
  const targets = document.querySelectorAll('.chapter .wrap > *, .archetypes li, .steps li, .spec-row, .channels li');
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

// ---------- Recorrido del indicador y captura real ----------

function bindIndicator() {
  // En móvil se aclara el velo inferior para que se vea el modelo 3D
  const active = new Set();
  document.querySelectorAll('#indicador, .story').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec, start: 'top 60%', end: 'bottom 40%',
      onToggle: (self) => {
        active[self.isActive ? 'add' : 'delete'](sec);
        root.classList.toggle('in-indicator', active.size > 0);
      },
    });
  });
  const frame = document.querySelector('[data-tilt] .shot-frame');
  if (frame && !reduced) {
    gsap.fromTo(frame, { '--tilt': '28deg', '--tilt-scale': 0.88 }, {
      '--tilt': '0deg', '--tilt-scale': 1, ease: 'none',
      scrollTrigger: { trigger: frame, start: 'top 95%', end: 'top 35%', scrub: 0.6 },
    });
  }
}

// ---------- Sentimiento ----------

function bindSentiment() {
  const rect = document.querySelector('.sent-reveal');
  if (!rect || reduced) return;
  gsap.fromTo(rect, { attr: { width: 0 } }, {
    attr: { width: 600 }, ease: 'none',
    scrollTrigger: { trigger: '.sentiment-fig', start: 'top 85%', end: 'bottom 45%', scrub: 0.6 },
  });
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
bindReveals();
bindNav();
bindLadder();
bindIndicator();
bindSentiment();
bindSignup();
initWorld();
