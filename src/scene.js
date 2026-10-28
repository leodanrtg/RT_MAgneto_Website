import * as THREE from 'three';
import { buildIndicator, STEP_CAMERAS } from './indicator3d.js';
import { buildStory, FOG_CAMERAS, ENGINE_CAMERAS } from './story3d.js';
import { buildScenarios, SCENARIO_CAMERAS } from './scenarios3d.js';

// Colores del indicador (mismos valores que en styles.css)
const C = {
  ink: 0x06080d,
  pos: new THREE.Color('#5ee08a'),
  neg: new THREE.Color('#ef3fa6'),
  volNeg: new THREE.Color('#ff5a4e'),
  zero: new THREE.Color('#f5c84b'),
  long: new THREE.Color('#34d6f0'),
  short: new THREE.Color('#8f6bff'),
  white: new THREE.Color('#e9edf5'),
};

// Niveles en unidades de escena (eje Y = precio)
const WALL = 3;
const VOID = -3;
const FLIP_90 = -1.35;
const LADDER_X = 4.6;

// Estado que anima el scroll. main.js lo interpola entre capítulos.
export const SCENES = {
  hero:      { ox: 0.24, cx: -2.5, cy: 1.4, cz: 14, lx: -0.5, ly: 0.4, lz: 0, fog: 0.035, planes: 0.25, ladder: 0.55, spikes: 1, flow: 0.55, engine: 0, regime: 0.15, hero: 0, split: 0, horizon: 0, dim: 0 },
  fog:       { ox: 0.28, cx: -4, cy: 2.2, cz: 11, lx: 0.5, ly: 0, lz: 0, fog: 0.16, planes: 1, ladder: 0.25, spikes: 0.4, flow: 0.35, engine: 0, regime: 0.15, hero: 0, split: 0, horizon: 0, dim: 0 },
  engine:    { ox: -0.26, cx: -11, cy: 2.6, cz: 7.5, lx: -1.5, ly: 0, lz: -5, fog: 0.028, planes: 0.45, ladder: 0.35, spikes: 0.5, flow: 1, engine: 1, regime: 0.15, hero: 0, split: 0, horizon: 0, dim: 0 },
  hedge:     { ox: 0.3, cx: 5.5, cy: 1.2, cz: 11.5, lx: 1.2, ly: 0.8, lz: 0, fog: 0.03, planes: 0.75, ladder: 0.45, spikes: 0.6, flow: 1, engine: 0, regime: 0, hero: 0, split: 0, horizon: 0, dim: 0 },
  spike:     { ox: -0.05, cx: 0.5, cy: 0.6, cz: 11, lx: -1.2, ly: 0.3, lz: 0, fog: 0.04, planes: 0.2, ladder: 0.2, spikes: 0.35, flow: 0.3, engine: 0, regime: 0.15, hero: 1, split: 1, horizon: 0, dim: 0 },
  ladder:    { ox: 0.2, cx: 1.5, cy: 0.4, cz: 12, lx: 2.6, ly: 0, lz: 0, fog: 0.025, planes: 0.5, ladder: 1, spikes: 0.25, flow: 0.25, engine: 0, regime: 0.15, hero: 0, split: 0, horizon: 0, dim: 0 },
  regime:    { ox: -0.3, cx: -1.2, cy: 0.5, cz: 13.5, lx: -1.2, ly: 0, lz: 0, fog: 0.03, planes: 0.85, ladder: 0.45, spikes: 0.6, flow: 0.8, engine: 0, regime: 0, hero: 0, split: 0, horizon: 0, dim: 0 },
  regime2:   { ox: -0.3, cx: -1.6, cy: -0.4, cz: 13.5, lx: -1.4, ly: -1, lz: 0, fog: 0.03, planes: 0.85, ladder: 0.45, spikes: 0.7, flow: 1, engine: 0, regime: 1, hero: 0, split: 0, horizon: 0, dim: 0 },
  levels:    { ox: 0.26, cx: 8.5, cy: 6.5, cz: 10, lx: 0.5, ly: 0, lz: 0, fog: 0.025, planes: 1.25, ladder: 0.6, spikes: 0.3, flow: 0.45, engine: 0, regime: 0.3, hero: 0, split: 0, horizon: 0, dim: 0 },
  horizons:  { ox: -0.3, cx: -8.5, cy: 1.6, cz: 12, lx: 0, ly: -0.6, lz: 0, fog: 0.028, planes: 0.8, ladder: 0.35, spikes: 0.4, flow: 0.5, engine: 0, regime: 0.45, hero: 0, split: 0, horizon: 1, dim: 0 },
  indicator: { ox: 0, cx: -2, cy: 0.6, cz: 15, lx: 0, ly: 0, lz: 0, fog: 0.04, planes: 0.5, ladder: 0.4, spikes: 0.5, flow: 0.4, engine: 0, regime: 0.15, hero: 0, split: 0, horizon: 0, dim: 0.82 },
  sentiment: { ox: 0.3, cx: 2.5, cy: 0.2, cz: 13, lx: 0.5, ly: 0, lz: 0, fog: 0.035, planes: 0.6, ladder: 0.4, spikes: 0.8, flow: 0.6, engine: 0, regime: 0.1, hero: 0, split: 0, horizon: 0, dim: 0.35 },
  scenarios: { ox: 0, cx: 0, cy: 9, cz: 9, lx: 0, ly: 0, lz: 0, fog: 0.035, planes: 0.9, ladder: 0.4, spikes: 0.4, flow: 0.4, engine: 0, regime: 0.2, hero: 0, split: 0, horizon: 0, dim: 0.78 },
  method:    { ox: 0, cx: -6, cy: 3, cz: 12, lx: 0, ly: 0, lz: 0, fog: 0.035, planes: 0.6, ladder: 0.4, spikes: 0.4, flow: 0.4, engine: 0, regime: 0.2, hero: 0, split: 0, horizon: 0, dim: 0.85 },
  product:   { ox: 0, cx: 3, cy: 1, cz: 14, lx: 1, ly: 0, lz: 0, fog: 0.035, planes: 0.5, ladder: 0.6, spikes: 0.5, flow: 0.5, engine: 0, regime: 0.15, hero: 0, split: 0, horizon: 0, dim: 0.85 },
  access:    { ox: 0, cx: 0, cy: 0.5, cz: 16, lx: 0, ly: 0.5, lz: 0, fog: 0.03, planes: 0.7, ladder: 0.5, spikes: 0.6, flow: 0.7, engine: 0, regime: 0.1, hero: 0, split: 0, horizon: 0, dim: 0.55 },
  community: { ox: 0, cx: -3, cy: 2, cz: 15, lx: 0, ly: 0, lz: 0, fog: 0.035, planes: 0.5, ladder: 0.4, spikes: 0.5, flow: 0.5, engine: 0, regime: 0.15, hero: 0, split: 0, horizon: 0, dim: 0.8 },
};

for (const k in SCENES) Object.assign(SCENES[k], { ind: 0, ind3d: 0, story: 0, fogStep: 0, eng3d: 0, engStep: 0, scn3d: 0, scnStep: 0, pz: 1, ...SCENES[k] });
// Escenas propias de la niebla y de la sala de máquinas: el resto del mundo se apaga
const OFF = { dim: 0, fog: 0.008, planes: 0, ladder: 0, spikes: 0, flow: 0, engine: 0, regime: 0, hero: 0, split: 0, horizon: 0 };
Object.keys(FOG_CAMERAS).forEach((k, i) => { SCENES[k] = { ...SCENES.fog, ...OFF, ...FOG_CAMERAS[k], story: 1, fogStep: i }; });
Object.keys(ENGINE_CAMERAS).forEach((k, i) => { SCENES[k] = { ...SCENES.engine, ...OFF, ...ENGINE_CAMERAS[k], eng3d: 1, engStep: i }; });
Object.keys(SCENARIO_CAMERAS).forEach((k, i) => { SCENES[k] = { ...SCENES.scenarios, ...OFF, ...SCENARIO_CAMERAS[k], scn3d: 1, scnStep: i, pz: i ? 1.3 : 1 }; });
// Recorrido del indicador en 3D: un fotograma por paso, el resto del mundo apagado
Object.keys(STEP_CAMERAS).forEach((k, i) => {
  SCENES[k] = { ...SCENES.indicator, ...STEP_CAMERAS[k], ind: i, ind3d: 1, dim: 0, fog: 0.008, planes: 0, ladder: 0, spikes: 0, flow: 0, hero: 0, split: 0, horizon: 0 };
});
SCENES.capture = { ...SCENES.indicator, ind: 0, ind3d: 0, dim: 0.85 };

// Escalera ilustrativa: dos perfiles de GEX por strike (volumen y desequilibrio)
const STRIKES = 31;
const STRIKE_STEP = 0.4;
function gauss(y, mu, s) { return Math.exp(-((y - mu) ** 2) / (2 * s * s)); }
function rnd(i, k) { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }
function profile(kind) {
  const out = [];
  for (let i = 0; i < STRIKES; i++) {
    const y = (i - (STRIKES - 1) / 2) * STRIKE_STEP;
    let v;
    if (kind === 'volume') {
      v = 3.4 * gauss(y, WALL, 0.35) + 1.2 * gauss(y, 1.5, 0.45) + 0.9 * gauss(y, 4.6, 0.5)
        - 3.0 * gauss(y, VOID, 0.4) - 1.1 * gauss(y, -1.6, 0.4) - 0.8 * gauss(y, -4.8, 0.5);
      v += (rnd(i, 1) - 0.5) * 0.5;
    } else {
      v = 2.4 * gauss(y, WALL + 0.4, 0.5) + 1.8 * gauss(y, 2, 0.3) + 0.5 * gauss(y, 5, 0.6)
        - 3.4 * gauss(y, VOID - 0.4, 0.45) - 0.6 * gauss(y, -0.9, 0.3) - 1.3 * gauss(y, -5, 0.5);
      v += (rnd(i, 2) - 0.5) * 0.7;
    }
    if (Math.abs(y) < 0.25) v *= 0.25;
    out.push({ y, v });
  }
  return out;
}
const LADDERS = { volume: profile('volume'), imbalance: profile('imbalance') };

function glowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWorld(canvas, { reduced = false } = {}) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.setClearColor(C.ink, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(C.ink, 0.035);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);

  const state = { ...SCENES.hero };
  const glow = glowTexture();
  const disposables = [];
  const track = (o) => (disposables.push(o), o);

  // ---------- Suelo y planos de nivel ----------
  const floor = new THREE.GridHelper(60, 60, 0x1b2335, 0x111827);
  floor.position.y = -7;
  floor.material.transparent = true;
  floor.material.opacity = 0.5;
  scene.add(floor);

  function levelPlane(y, color, w = 22, d = 12, dashed = false) {
    const g = new THREE.Group();
    const plane = new THREE.Mesh(
      track(new THREE.PlaneGeometry(w, d)),
      track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }))
    );
    plane.rotation.x = -Math.PI / 2;
    g.add(plane);
    // Línea frontal brillante: el nivel visto en el gráfico
    const pts = [];
    const segs = dashed ? 90 : 1;
    for (let i = 0; i <= segs; i++) pts.push(new THREE.Vector3(-w / 2 + (w * i) / segs, 0, d / 2 - 6));
    const lineGeo = track(new THREE.BufferGeometry().setFromPoints(pts));
    const lineMat = track(dashed
      ? new THREE.PointsMaterial({ color, size: 0.09, transparent: true, depthWrite: false })
      : new THREE.LineBasicMaterial({ color, transparent: true }));
    const line = dashed ? new THREE.Points(lineGeo, lineMat) : new THREE.Line(lineGeo, lineMat);
    g.add(line);
    const edges = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(plane.geometry)),
      track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 }))
    );
    edges.rotation.x = -Math.PI / 2;
    g.add(edges);
    g.position.y = y;
    g.userData = { plane, line, edges };
    scene.add(g);
    return g;
  }
  const wall = levelPlane(WALL, C.pos);
  const pivot = levelPlane(0, C.zero, 22, 12, true);
  const voidP = levelPlane(VOID, C.neg);
  const flip90 = levelPlane(FLIP_90, C.zero, 22, 12, true);
  flip90.position.z = -2.5;

  const zeroGrid = new THREE.GridHelper(22, 22, C.zero, C.zero);
  zeroGrid.material.transparent = true;
  zeroGrid.material.opacity = 0.05;
  zeroGrid.material.depthWrite = false;
  pivot.add(zeroGrid);

  // ---------- Escalera gamma (InstancedMesh) ----------
  const barGeo = track(new THREE.BoxGeometry(1, STRIKE_STEP * 0.62, 0.32));
  barGeo.translate(0.5, 0, 0);
  const barMat = track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  const bars = new THREE.InstancedMesh(barGeo, barMat, STRIKES);
  bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bars);
  const ladderNow = LADDERS.volume.map((d) => d.v);
  let ladderTarget = LADDERS.volume.map((d) => d.v);
  const axisGeo = track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(LADDER_X, -6.4, 0), new THREE.Vector3(LADDER_X, 6.4, 0)]));
  const axisMat = track(new THREE.LineBasicMaterial({ color: 0x8a94a8, transparent: true, opacity: 0.4 }));
  scene.add(new THREE.Line(axisGeo, axisMat));

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const tmpC = new THREE.Color();
  function updateBars(dt) {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 5);
    const grow = state.ladder;
    for (let i = 0; i < STRIKES; i++) {
      ladderNow[i] += (ladderTarget[i] - ladderNow[i]) * k;
      const v = ladderNow[i];
      const len = Math.max(0.02, Math.abs(v) * 1.05 * Math.min(1, grow * 1.2));
      const y = LADDERS.volume[i].y;
      s3.set(v >= 0 ? len : -len, 1, 1);
      v3.set(LADDER_X, y, 0);
      m4.compose(v3, q, s3);
      bars.setMatrixAt(i, m4);
      const mag = Math.min(1, Math.abs(v) / 3.4);
      tmpC.copy(v >= 0 ? C.pos : C.neg).multiplyScalar(0.25 + 0.95 * mag);
      bars.setColorAt(i, tmpC);
    }
    bars.instanceMatrix.needsUpdate = true;
    if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    barMat.opacity = Math.min(1, grow) * 0.95;
    axisMat.opacity = 0.4 * Math.min(1, grow);
  }

  // ---------- Precio: punto y traza ----------
  const TRAIL = 140;
  const TRAIL_DX = 0.042;
  const PUCK_X = LADDER_X - 0.6;
  const trailY = new Float32Array(TRAIL).fill(0.8);
  const trailPos = new Float32Array(TRAIL * 3);
  const trailCol = new Float32Array(TRAIL * 3);
  const trailGeo = track(new THREE.BufferGeometry());
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  const trailMat = track(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true }));
  const trail = new THREE.Line(trailGeo, trailMat);
  scene.add(trail);

  const puck = new THREE.Mesh(track(new THREE.SphereGeometry(0.14, 24, 16)), track(new THREE.MeshBasicMaterial({ color: C.white })));
  scene.add(puck);
  const puckGlow = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glow, color: C.white, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 })));
  puckGlow.scale.setScalar(1.6);
  puck.add(puckGlow);

  const price = { y: 0.8, v: 0, t: 0 };
  function stepPrice(dt) {
    price.t += dt;
    const r = state.regime;
    // Gravedad: reversión hacia el muro con amortiguación alta (rango, pinning).
    // Aceleración: atracción débil hacia el vacío, poca amortiguación y más ruido.
    const target = THREE.MathUtils.lerp(1.9, VOID - 1.1, r);
    const k = THREE.MathUtils.lerp(2.2, 0.55, r);
    const damp = THREE.MathUtils.lerp(2.6, 0.5, r);
    const noiseAmp = THREE.MathUtils.lerp(2.6, 6.5, r);
    const t = price.t;
    const noise = (Math.sin(t * 2.3) * 0.6 + Math.sin(t * 5.1 + 1.3) * 0.3 + Math.sin(t * 11.7 + 0.4) * 0.25 + (Math.random() - 0.5) * 1.6) * noiseAmp;
    // El muro se resiste a ser atravesado en gravedad
    const wallPush = (1 - r) * (price.y > WALL ? -(price.y - WALL) * 9 : 0);
    const a = -k * (price.y - target) - damp * price.v + noise + wallPush;
    price.v += a * dt;
    price.y += price.v * dt;
    price.y = THREE.MathUtils.clamp(price.y, -6.2, 6.2);
  }
  let trailAcc = 0;
  function updateTrail(dt) {
    trailAcc += dt;
    const stepT = 1 / 40;
    let shifted = false;
    while (trailAcc >= stepT) {
      trailAcc -= stepT;
      stepPrice(stepT);
      trailY.copyWithin(0, 1);
      trailY[TRAIL - 1] = price.y;
      shifted = true;
      maybeSpawnSpike();
    }
    if (!shifted && !reduced) return;
    for (let i = 0; i < TRAIL; i++) {
      const x = PUCK_X - (TRAIL - 1 - i) * TRAIL_DX;
      const y = trailY[i];
      trailPos[i * 3] = x;
      trailPos[i * 3 + 1] = y;
      trailPos[i * 3 + 2] = 0;
      const f = i / (TRAIL - 1);
      const base = y >= 0 ? C.pos : C.neg;
      tmpC.copy(C.white).lerp(base, 0.35).multiplyScalar(0.15 + 0.85 * f);
      trailCol[i * 3] = tmpC.r;
      trailCol[i * 3 + 1] = tmpC.g;
      trailCol[i * 3 + 2] = tmpC.b;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    puck.position.set(PUCK_X, trailY[TRAIL - 1], 0);
  }

  // ---------- Spikes de flujo de opciones ----------
  const MAXS = small ? 36 : 70;
  const ringGeo = track(new THREE.TorusGeometry(0.2, 0.032, 8, 40));
  const coreGeo = track(new THREE.SphereGeometry(0.095, 16, 12));
  const ringMat = track(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const coreMat = track(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, MAXS);
  const cores = new THREE.InstancedMesh(coreGeo, coreMat, MAXS);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(rings, cores);
  const spikes = Array.from({ length: MAXS }, () => ({ alive: false, age: 0, x: 0, y: 0, size: 1, type: 0, idx: 0 }));
  let spikeHead = 0;
  let spikeClock = 0;
  // Arquetipos: [anillo, núcleo]
  const ARCH = [
    [C.long, C.pos],   // Long Call
    [C.long, C.volNeg],// Long Put
    [C.short, C.volNeg],// Short Call
    [C.short, C.pos],  // Short Put
  ];
  function maybeSpawnSpike() {
    spikeClock += 1;
    const every = Math.round(THREE.MathUtils.lerp(9, 4, state.regime));
    if (spikeClock % every !== 0) return;
    const s = spikes[spikeHead];
    spikeHead = (spikeHead + 1) % MAXS;
    s.alive = true;
    s.age = 0;
    s.x = PUCK_X;
    s.y = price.y + (Math.random() - 0.5) * 0.5;
    s.size = 0.6 + Math.random() * 1.1;
    // En aceleración hay más convexidad larga (cian); en gravedad más corta (morado)
    const long = Math.random() < THREE.MathUtils.lerp(0.35, 0.75, state.regime);
    const posCore = Math.random() < THREE.MathUtils.lerp(0.6, 0.3, state.regime);
    s.type = long ? (posCore ? 0 : 1) : (posCore ? 3 : 2);
  }
  function updateSpikes(dt) {
    const speed = TRAIL_DX * 40;
    for (let i = 0; i < MAXS; i++) {
      const s = spikes[i];
      if (s.alive) {
        s.age += dt;
        s.x -= speed * dt;
        if (s.x < PUCK_X - TRAIL * TRAIL_DX) s.alive = false;
      }
      const pop = s.alive ? Math.min(1, s.age * 4) : 0;
      const sc = s.alive ? s.size * (0.4 + 0.6 * (1 - Math.pow(1 - pop, 3))) * state.spikes : 0;
      s3.setScalar(Math.max(sc, 0.0001));
      v3.set(s.x, s.y, 0.02);
      m4.compose(v3, q, s3);
      rings.setMatrixAt(i, m4);
      cores.setMatrixAt(i, m4);
      const [rc, cc] = ARCH[s.type];
      rings.setColorAt(i, rc);
      cores.setColorAt(i, cc);
    }
    rings.instanceMatrix.needsUpdate = true;
    cores.instanceMatrix.needsUpdate = true;
    rings.instanceColor.needsUpdate = true;
    cores.instanceColor.needsUpdate = true;
    ringMat.opacity = Math.min(1, state.spikes);
    coreMat.opacity = Math.min(1, state.spikes);
  }

  // ---------- Spike protagonista (anatomía) ----------
  const heroG = new THREE.Group();
  heroG.position.set(-3.6, 0.4, 3.2);
  const heroRingMat = track(new THREE.MeshBasicMaterial({ color: C.long, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const heroCoreMat = track(new THREE.MeshBasicMaterial({ color: C.pos, transparent: true }));
  const heroRing = new THREE.Mesh(track(new THREE.TorusGeometry(1.25, 0.16, 24, 96)), heroRingMat);
  const heroCore = new THREE.Mesh(track(new THREE.SphereGeometry(0.62, 40, 28)), heroCoreMat);
  const heroRingGlow = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glow, color: C.long, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 })));
  heroRingGlow.scale.setScalar(5);
  const heroCoreGlow = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glow, color: C.pos, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })));
  heroCoreGlow.scale.setScalar(2.6);
  heroRing.add(heroRingGlow);
  heroCore.add(heroCoreGlow);
  heroG.add(heroRing, heroCore);
  scene.add(heroG);
  let heroArch = 0;
  let heroClock = 0;

  function updateHero(dt, t) {
    const vis = state.hero;
    heroG.visible = vis > 0.01;
    if (!heroG.visible) return;
    heroClock += dt;
    if (!reduced && heroClock > 2.6) { heroClock = 0; heroArch = (heroArch + 1) % 4; }
    const [rc, cc] = ARCH[heroArch];
    const k = reduced ? 1 : 1 - Math.exp(-dt * 4);
    heroRingMat.color.lerp(rc, k);
    heroCoreMat.color.lerp(cc, k);
    heroRingGlow.material.color.copy(heroRingMat.color);
    heroCoreGlow.material.color.copy(heroCoreMat.color);
    heroG.scale.setScalar(0.6 + 0.4 * vis);
    heroRingMat.opacity = vis;
    heroCoreMat.opacity = vis;
    heroRingGlow.material.opacity = 0.35 * vis;
    heroCoreGlow.material.opacity = 0.55 * vis;
    // Separar anillo y núcleo en profundidad y volver a unir
    const split = state.split * (0.5 + 0.5 * Math.sin(t * 0.7));
    heroRing.position.set(-0.9 * split, 0.25 * split, -1.6 * split);
    heroCore.position.set(0.9 * split, -0.2 * split, 1.2 * split);
    heroG.rotation.y = -0.5 + Math.sin(t * 0.4) * 0.25 + split * 0.4;
    heroG.rotation.x = Math.sin(t * 0.3) * 0.12;
  }

  // ---------- Flujo de cobertura (partículas) ----------
  const P = small ? 900 : 2400;
  const pPos = new Float32Array(P * 3);
  const pCol = new Float32Array(P * 3);
  const pVel = new Float32Array(P * 3);
  const pSeed = new Float32Array(P);
  const BOUND = { x0: -12, x1: 9, y0: -6.5, y1: 6.5, z0: -14, z1: 4 };
  function respawn(i, initial) {
    const engine = state.engine > 0.5;
    if (engine && !initial) {
      // Desde la sala de máquinas: nacen al fondo y viajan hacia el gráfico
      pPos[i * 3] = -6 + (Math.random() - 0.5) * 4;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pPos[i * 3 + 2] = BOUND.z0 + Math.random() * 2;
    } else {
      pPos[i * 3] = initial ? THREE.MathUtils.lerp(BOUND.x0, BOUND.x1, Math.random()) : BOUND.x0 + Math.random() * 1.5;
      pPos[i * 3 + 1] = THREE.MathUtils.lerp(BOUND.y0, BOUND.y1, Math.random());
      pPos[i * 3 + 2] = THREE.MathUtils.lerp(BOUND.z0 + 4, BOUND.z1, Math.random());
    }
    pVel[i * 3] = pVel[i * 3 + 1] = pVel[i * 3 + 2] = 0;
    pSeed[i] = Math.random();
  }
  for (let i = 0; i < P; i++) respawn(i, true);
  const pGeo = track(new THREE.BufferGeometry());
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = track(new THREE.PointsMaterial({ size: small ? 0.11 : 0.085, map: glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  const points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  function updateFlow(dt, t) {
    const r = state.regime;
    const eng = state.engine;
    const vis = state.flow;
    pMat.opacity = Math.min(1, vis) * 0.9;
    points.visible = vis > 0.01;
    if (!points.visible) return;
    for (let i = 0; i < P; i++) {
      const ix = i * 3;
      const x = pPos[ix], y = pPos[ix + 1], z = pPos[ix + 2];
      const sd = pSeed[i];
      // Deriva temporal (izquierda a derecha, como el gráfico)
      let ax = 1.4 + sd * 0.8;
      let ay = 0;
      let az = 0;
      // Gravedad: los flujos convergen a los imanes y se frenan allí
      const magnet = y > 0 ? WALL : VOID;
      ay += (1 - r) * (magnet - y) * 0.9;
      ay += (1 - r) * Math.sin(t * 1.3 + sd * 20 + x * 0.6) * 0.5;
      // Aceleración: empuje bajista que crece con la distancia al pivote
      ay += r * (-1.8 - Math.abs(y) * 0.5);
      ax += r * 1.4;
      // Sala de máquinas: viajan hacia la cámara desde el fondo
      az += eng * (5 + sd * 3) - (1 - eng) * z * 0.15;
      pVel[ix] += (ax - pVel[ix]) * Math.min(1, dt * 2);
      pVel[ix + 1] += (ay - pVel[ix + 1]) * Math.min(1, dt * 2);
      pVel[ix + 2] += (az - pVel[ix + 2]) * Math.min(1, dt * 2);
      pPos[ix] = x + pVel[ix] * dt;
      pPos[ix + 1] = y + pVel[ix + 1] * dt;
      pPos[ix + 2] = z + pVel[ix + 2] * dt;
      if (pPos[ix] > BOUND.x1 || pPos[ix + 1] < BOUND.y0 || pPos[ix + 1] > BOUND.y1 || pPos[ix + 2] > BOUND.z1 + 2) respawn(i, false);
      // Color por lado del pivote; algunas son flujo de convexidad (cian/morado)
      const yy = pPos[ix + 1];
      let col;
      if (sd < 0.12) col = C.long;
      else if (sd < 0.2) col = C.short;
      else col = yy >= 0 ? C.pos : C.neg;
      const near = Math.max(0, 1 - Math.min(Math.abs(yy - WALL), Math.abs(yy - VOID)) / 2.2);
      const b = 0.35 + 0.65 * near;
      pCol[ix] = col.r * b;
      pCol[ix + 1] = col.g * b;
      pCol[ix + 2] = col.b * b;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  function updatePlanes(t) {
    const solo = Math.max(state.ind3d, state.story, state.eng3d, state.scn3d); // escenas propias
    const away = solo > 0.9;
    trail.visible = !away;
    puck.visible = !away;
    floor.material.opacity = 0.5 * (1 - solo);
    const o = state.planes;
    const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 2);
    for (const [g, base] of [[wall, 1], [pivot, 1], [voidP, 1]]) {
      g.userData.plane.material.opacity = 0.045 * o * base;
      g.userData.line.material.opacity = Math.min(1, 0.9 * o) * pulse;
      g.userData.edges.material.opacity = 0.22 * o;
    }
    zeroGrid.material.opacity = 0.06 * o;
    const h = state.horizon;
    flip90.visible = h > 0.01;
    flip90.userData.plane.material.opacity = 0.05 * h;
    flip90.userData.line.material.opacity = 0.9 * h;
    flip90.userData.edges.material.opacity = 0.3 * h;
    flip90.userData.line.material.color.copy(C.long);
    flip90.userData.edges.material.color.copy(C.long);
    flip90.userData.plane.material.color.copy(C.long);
  }

  // ---------- Indicador en 3D ----------
  const indicator = buildIndicator(glow);
  scene.add(indicator.group);
  const story = buildStory(glow);
  story.groups.forEach((g) => scene.add(g));
  const scenarios = buildScenarios(glow);
  scene.add(scenarios.group);

  // ---------- Cámara ----------
  const look = new THREE.Vector3();
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  function updateCamera(dt, t) {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3);
    pointer.sx += (pointer.x - pointer.sx) * k;
    pointer.sy += (pointer.y - pointer.sy) * k;
    const drift = reduced ? 0 : 1;
    camera.position.set(
      state.cx + pointer.sx * 0.8 * drift + Math.sin(t * 0.13) * 0.3 * drift,
      state.cy + pointer.sy * 0.5 * drift + Math.sin(t * 0.17) * 0.15 * drift,
      state.lz + (state.cz - state.lz) * (portrait ? portraitPush * state.pz : 1) // en vertical se aleja desde el punto de mira
    );
    look.set(state.lx, state.ly, state.lz);
    camera.lookAt(look);
    scene.fog.density = state.fog;
    // Desplaza la escena hacia el lado contrario al texto
    if (!portrait) {
      camera.setViewOffset(vw, vh, -state.ox * vw, 0, vw, vh);
      camera.updateProjectionMatrix();
    }
  }

  let portraitPush = 1;
  let portrait = false;
  let vw = 1;
  let vh = 1;
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    vw = w;
    vh = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    portrait = w / h < 0.9;
    camera.fov = portrait ? 58 : 42;
    portraitPush = portrait ? 1.12 : 1;
    // En vertical el texto va abajo: subimos la escena al tercio superior
    if (portrait) camera.setViewOffset(w, h, 0, h * 0.22, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  // Pre-simular para que la traza ya exista en el primer fotograma
  for (let i = 0; i < TRAIL + 40; i++) { updateTrail(1 / 40); updateSpikes(1 / 40); }

  const timer = new THREE.Timer();
  let raf = 0;
  let running = false;
  let elapsed = 0;

  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    elapsed += dt;
    draw(dt, elapsed);
    raf = requestAnimationFrame(frame);
  }

  function draw(dt, t) {
    canvas.style.opacity = String(1 - state.dim);
    if (state.dim > 0.97) return;
    updateCamera(dt, t);
    if (!reduced) {
      updateTrail(dt);
      updateSpikes(dt);
      updateFlow(dt, t);
    }
    updateBars(dt);
    updateHero(dt, t);
    updatePlanes(t);
    indicator.update(state, t, reduced);
    story.update(state, t, reduced);
    scenarios.update(state, t, reduced);
    renderer.render(scene, camera);
  }

  return {
    state,
    resize,
    setLadder(kind) {
      ladderTarget = LADDERS[kind].map((d) => d.v);
      if (reduced) renderOnce();
    },
    setPointer(x, y) { pointer.x = x; pointer.y = y; },
    start() {
      if (running || reduced) return;
      running = true;
      timer.update();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    renderOnce,
  };

  function renderOnce() {
    // Movimiento reducido: un fotograma fijo por capítulo, sin animación continua
    updateSpikes(0);
    for (let i = 0; i < 3; i++) updateFlow(1 / 30, 0);
    draw(1, 0);
  }
}
