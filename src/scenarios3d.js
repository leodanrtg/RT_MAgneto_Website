import * as THREE from 'three';

// Los cuatro escenarios en 3D: cuatro gráficos de velas sobre los niveles
// Max GEX+, Zero Gamma y Max GEX−. scene.js los enciende con state.scn3d y
// state.scnStep (0 = vista general, 1..4 = escenario descrito).

const SX = -120; // lejos del resto del mundo
const POS = 2.2; // Max GEX+
const NEG = -2.2; // Max GEX−
const W = 8; // ancho de cada gráfico
const N = 44; // velas por escenario
const GAP_X = 9.6;
const GAP_Y = 8.8;

const C = {
  pos: new THREE.Color('#5ee08a'),
  neg: new THREE.Color('#ef3fa6'),
  zero: new THREE.Color('#f5c84b'),
  up: new THREE.Color('#e9edf5'),
  down: new THREE.Color('#6f7a91'),
  void: new THREE.Color('#b06cff'),
};

function rnd(i) { const s = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return s - Math.floor(s); }
function smooth(path, x) {
  for (let i = 1; i < path.length; i++) {
    if (x <= path[i][0]) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      const f = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * (f * f * (3 - 2 * f));
    }
  }
  return path[path.length - 1][1];
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Recorrido del precio (x de 0 a 1, y en niveles), vela de entrada y objetivo
const SCENARIOS = [
  { // 1 · El tirón de la gravedad: retroceso a Zero Gamma, compra, objetivo el imán GEX+
    path: [[0, -0.9], [0.16, -0.2], [0.3, 0.9], [0.42, 0.55], [0.5, 0.08], [0.62, 0.7], [0.78, 1.5], [0.9, 2.05], [1, 2.15]],
    entry: 0.5, target: POS, dir: 1, tone: C.pos,
  },
  { // 2 · La aceleración: rebote que falla en el pivote, venta, objetivo GEX−
    path: [[0, 1.2], [0.18, 0.6], [0.32, -0.7], [0.44, -0.35], [0.52, -0.05], [0.62, -0.6], [0.78, -1.5], [0.9, -2.05], [1, -2.15]],
    entry: 0.52, target: NEG, dir: -1, tone: C.neg,
  },
  { // 3 · El muro: el precio toca Max GEX+, se confirma el giro y vuelve a Zero Gamma
    path: [[0, -0.4], [0.18, 0.5], [0.34, 1.4], [0.46, 2.1], [0.52, 2.2], [0.58, 2.05], [0.7, 1.2], [0.86, 0.35], [1, 0.05]],
    entry: 0.56, target: 0, dir: -1, tone: C.zero,
  },
  { // 4 · El vacío: llega a Max GEX−, consolida y rompe con impulso
    path: [[0, 0.5], [0.2, -0.6], [0.36, -1.7], [0.44, -2.1], [0.52, -1.95], [0.6, -2.12], [0.66, -2.0], [0.74, -2.6], [0.88, -3.2], [1, -3.45]],
    entry: 0.7, target: -3.45, dir: -1, tone: C.void,
  },
];

// Disposición en cuadrícula 2 × 2, como las cuatro tarjetas
const CENTERS = [[-GAP_X / 2, GAP_Y / 2], [GAP_X / 2, GAP_Y / 2], [-GAP_X / 2, -GAP_Y / 2], [GAP_X / 2, -GAP_Y / 2]];

function cam(look, from, ox = -0.25) {
  return { ox, lx: look[0], ly: look[1], lz: look[2], cx: from[0], cy: from[1], cz: from[2] };
}
export const SCENARIO_CAMERAS = {
  scn0: cam([SX - 1, -0.3, 0], [SX - 4, 3, 40], -0.22),
  ...Object.fromEntries(CENTERS.map(([x, y], i) => [`scn${i + 1}`, cam([SX + x, y - 0.3, 0], [SX + x - 2.4, y + 1.6, 16], -0.22)])),
};

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  g.font = '500 26px "IBM Plex Mono", ui-monospace, monospace';
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 4, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowLine(x0, x1, y, z, color, glow, size = 0.13, step = 0.12) {
  const pts = [];
  for (let x = x0; x <= x1; x += step) pts.push(x, y, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
}

function buildStage(sc, glow) {
  const g = new THREE.Group();
  const mats = [];
  const reg = (m) => (m.transparent = true, m.userData.base = m.opacity, mats.push(m), m);

  const panel = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.8, 8.2), reg(new THREE.MeshBasicMaterial({ color: 0x0c111c, opacity: 0.94, depthWrite: false })));
  panel.position.set(0, -0.35, -0.6);
  panel.renderOrder = -2;
  g.add(panel);
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W + 0.8, 8.2)), reg(new THREE.LineBasicMaterial({ color: 0x2a3448 })));
  frame.position.copy(panel.position);
  g.add(frame);

  // Niveles: losa translúcida en profundidad + línea brillante + etiqueta
  [[POS, C.pos, 'Max GEX+', '#5ee08a'], [0, C.zero, 'Zero Gamma', '#f5c84b'], [NEG, C.neg, 'Max GEX−', '#ef3fa6']].forEach(([y, col, name, css]) => {
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4), reg(new THREE.MeshBasicMaterial({ color: col, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })));
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(0, y, 0.6);
    g.add(slab);
    const line = glowLine(-W / 2, W / 2, y, 0.05, col, glow, y === 0 ? 0.11 : 0.14, y === 0 ? 0.2 : 0.1);
    reg(line.material);
    g.add(line);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), reg(new THREE.MeshBasicMaterial({ map: labelTexture(name, css), depthWrite: false, opacity: 0.85 })));
    label.position.set(-W / 2 + 1.05, y + 0.3, 0.1);
    g.add(label);
  });

  // Velas OHLC: cuerpo 3D y mecha, generadas sobre el recorrido del escenario
  const step = W / N;
  const bodyGeo = new THREE.BoxGeometry(step * 0.64, 1, 0.22);
  const bodies = new THREE.InstancedMesh(bodyGeo, reg(new THREE.MeshBasicMaterial({ color: 0xffffff })), N);
  const wickPos = new Float32Array(N * 6);
  const candles = [];
  let prev = smooth(sc.path, 0);
  for (let i = 0; i < N; i++) {
    const f = (i + 0.5) / N;
    const close = smooth(sc.path, f) + (rnd(i * 7 + sc.dir * 3) - 0.5) * 0.36;
    const open = prev;
    const hi = Math.max(open, close) + 0.06 + rnd(i + 31) * 0.28;
    const lo = Math.min(open, close) - 0.06 - rnd(i + 77) * 0.28;
    candles.push({ x: -W / 2 + step * (i + 0.5), open, close, hi, lo });
    bodies.setColorAt(i, close >= open ? C.up : C.down);
    prev = close;
  }
  const wickGeo = new THREE.BufferGeometry();
  wickGeo.setAttribute('position', new THREE.BufferAttribute(wickPos, 3));
  const wicks = new THREE.LineSegments(wickGeo, reg(new THREE.LineBasicMaterial({ color: 0x9aa4b8, opacity: 0.85 })));
  g.add(bodies, wicks);

  // Entrada (esfera amarilla con halo), objetivo (anillo del color del escenario) y trayecto
  const ei = Math.round(sc.entry * N - 0.5);
  const entryC = candles[ei];
  const entry = new THREE.Group();
  entry.position.set(entryC.x, entryC.close, 0.3);
  entry.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), reg(new THREE.MeshBasicMaterial({ color: C.zero }))));
  const halo = new THREE.Sprite(reg(new THREE.SpriteMaterial({ map: glow, color: C.zero, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 })));
  halo.scale.setScalar(1.2);
  entry.add(halo);
  g.add(entry);
  const target = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 48), reg(new THREE.MeshBasicMaterial({ color: sc.tone })));
  target.position.set(candles[N - 1].x - 0.15, sc.target, 0.3);
  g.add(target);
  const tradePts = [];
  for (let k = 0; k <= 40; k++) {
    const f = k / 40;
    tradePts.push(entryC.x + (target.position.x - entryC.x) * f, entryC.close + (sc.target - entryC.close) * f + Math.sin(f * Math.PI) * 0.35 * sc.dir, 0.35);
  }
  const tradeGeo = new THREE.BufferGeometry();
  tradeGeo.setAttribute('position', new THREE.Float32BufferAttribute(tradePts, 3));
  const trade = new THREE.Points(tradeGeo, reg(new THREE.PointsMaterial({ color: sc.tone, size: 0.13, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  g.add(trade);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  // p: cuántas velas se ven (0..1). La última crece desde la apertura.
  function layout(p) {
    const shown = p * N;
    for (let i = 0; i < N; i++) {
      const c = candles[i];
      const k = clamp01(shown - i);
      const close = c.open + (c.close - c.open) * k;
      const h = Math.max(0.035, Math.abs(close - c.open)) * (k > 0 ? 1 : 0.0001);
      v.set(c.x, (close + c.open) / 2, k > 0 ? 0 : -50);
      s.set(1, h, 1);
      bodies.setMatrixAt(i, m4.compose(v, q, s));
      const hi = c.open + (c.hi - c.open) * k;
      const lo = c.open + (c.lo - c.open) * k;
      wickPos.set(k > 0 ? [c.x, hi, 0, c.x, lo, 0] : [0, 0, -50, 0, 0, -50], i * 6);
    }
    bodies.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    wickGeo.attributes.position.needsUpdate = true;
  }

  return { group: g, mats, layout, entry, halo, target, trade, sc, ei };
}

export function buildScenarios(glow) {
  const group = new THREE.Group();
  group.position.set(SX, 0, 0);
  const stages = SCENARIOS.map((sc, i) => {
    const st = buildStage(sc, glow);
    st.group.position.set(CENTERS[i][0], CENTERS[i][1], 0);
    group.add(st.group);
    return st;
  });
  let clock = 0;
  let lastStep = -1;

  function update(state, t, reduced) {
    const vis = state.scn3d;
    group.visible = vis > 0.01;
    if (!group.visible) return;
    const s = state.scnStep;
    const active = Math.round(s);
    // Al llegar a un escenario, sus velas se vuelven a dibujar desde el principio
    if (active !== lastStep) { lastStep = active; clock = t; }
    const overview = Math.max(0, 1 - s);
    stages.forEach((st, i) => {
      const w = Math.max(0, 1 - Math.abs(s - (i + 1)));
      const o = (0.3 + 0.7 * Math.max(overview, w)) * vis;
      st.mats.forEach((m) => { m.opacity = m.userData.base * o; });
      // Escenario descrito: las velas se dibujan una a una y luego se repite
      let p = 1;
      if (!reduced && active === i + 1) p = clamp01(((t - clock) % 7.5) / 4.5);
      else if (!reduced && active === 0) p = clamp01(((t + i * 0.8) % 8) / 5);
      st.layout(p);
      const reached = clamp01((p - st.sc.entry) * 12);
      const done = clamp01((p - 0.96) * 25);
      const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 6);
      st.entry.scale.setScalar(Math.max(0.001, reached) * (1 + w * 0.4));
      st.halo.material.opacity = 0.9 * reached * pulse * o;
      st.trade.material.opacity = done * o;
      st.target.material.opacity = (0.35 + 0.65 * done) * o;
      st.target.rotation.y = reduced ? 0.5 : t * 1.5;
      st.target.scale.setScalar(1 + done * (reduced ? 0.2 : 0.25 * Math.sin(t * 4) + 0.25));
      st.group.position.z = w * 0.8;
    });
  }
  return { group, update };
}
