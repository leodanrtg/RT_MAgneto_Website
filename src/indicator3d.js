import * as THREE from 'three';

// Recreación 3D del indicador RT Magneto a partir de la captura de NinjaTrader
// (img/rt-magneto-indicador.webp, 1523×1080 px). Las coordenadas en píxeles de la
// captura se pasan a unidades de escena con px() / py(), así que cada elemento
// queda donde está en la imagen real.

export const ORIGIN_X = 40; // lejos del resto del mundo para que no se mezcle
const W = 24;
const IMG_W = 1523;
const MAIN_H = 820; // alto del panel principal en la captura
const px = (x) => ORIGIN_X - W / 2 + (x * W) / IMG_W;
const py = (y) => (y <= MAIN_H ? 7 - (y * 10) / MAIN_H : -3.5 - ((y - MAIN_H) * 4) / 260);

// Cámara por paso (las usa scene.js como fotogramas clave)
const P = (x, y) => [px(x), py(y)];
function cam(look, from, ox = -0.26) {
  return { ox, lx: look[0], ly: look[1], lz: 0, cx: from[0], cy: from[1], cz: from[2] };
}
const [ovx] = P(760, 0);
export const STEP_CAMERAS = {
  ind0: cam([ovx, 0.6], [ovx - 5, 2.5, 25]),
  ind1: cam(P(820, 84), [px(560), py(84) + 1.6, 9]),
  ind2: cam(P(1030, 200), [px(800), py(200) + 1.8, 9.5]),
  ind3: cam(P(880, 380), [px(780), py(380) + 1, 15]),
  ind4: cam(P(800, 500), [px(250), py(500) + 2.4, 12]),
  ind5: cam(P(1240, 562), [px(1060), py(562) + 1.2, 7]),
  ind6: cam(P(1000, 600), [px(760), py(600) - 1.6, 9]),
  ind7: cam(P(580, 900), [px(380), py(900) + 2.6, 10]),
  ind8: cam(P(1320, 1010), [px(1180), py(1010) + 2.2, 7]),
};

// Trazado aproximado del precio en la captura (x, y en píxeles)
const PRICE = [
  [0, 630], [55, 700], [120, 600], [180, 450], [240, 610], [330, 420], [360, 560], [430, 560], [470, 420],
  [500, 380], [550, 262], [610, 400], [650, 410], [700, 260], [760, 175], [860, 48], [920, 120], [960, 80],
  [1000, 130], [1040, 120], [1080, 150], [1110, 270], [1200, 330], [1250, 270], [1300, 280], [1380, 410],
  [1420, 300], [1440, 240], [1480, 280], [1515, 190],
];
const ZERO = [[90, 670], [250, 610], [430, 555], [580, 550], [760, 515], [900, 460], [1050, 395], [1180, 345], [1300, 345], [1515, 340]];
// Sentimiento: [x, y] del borde del área (y = 965 es el cero)
const SENT_POS = [[60, 965], [150, 950], [190, 930], [260, 945], [330, 935], [420, 945], [470, 925], [540, 905], [600, 920], [690, 880], [740, 860], [800, 835], [870, 855], [970, 840], [1020, 890], [1060, 905], [1100, 965]];
const SENT_NEG = [[1140, 965], [1180, 985], [1240, 975], [1300, 980], [1340, 1010], [1390, 1060], [1420, 1010], [1450, 975], [1500, 965]];

function lerpPath(path, x) {
  for (let i = 1; i < path.length; i++) {
    if (x <= path[i][0]) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      const f = (x - x0) / Math.max(1, x1 - x0);
      return y0 + (y1 - y0) * f;
    }
  }
  return path[path.length - 1][1];
}
const WHITE = new THREE.Color(0xffffff);
function rnd(i) { const s = Math.sin(i * 91.17 + 7.3) * 43758.5453; return s - Math.floor(s); }

function dotsMaterial(color, size, glow) {
  return new THREE.PointsMaterial({ color, size, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}
function dottedRow(y, x0, x1, step, jitter = 0, seed = 0) {
  const pts = [];
  for (let x = x0, i = 0; x <= x1; x += step, i++) {
    if (rnd(i + seed) < 0.08) continue; // huecos como en el indicador
    pts.push(px(x), py(y + (rnd(i * 3 + seed) - 0.5) * jitter), 0);
  }
  return pts;
}

export function buildIndicator(glow) {
  const group = new THREE.Group();
  const parts = []; // { obj, mats, step, baseOpacity }

  // Panel de fondo con rejilla tenue y separador de subgráfico
  const panelMat = new THREE.MeshBasicMaterial({ color: 0x0c111c, transparent: true, opacity: 0.92, depthWrite: false });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.8, 15.4), panelMat);
  panel.position.set(ORIGIN_X, -0.35, -0.4);
  panel.renderOrder = -2; // el fondo siempre se pinta antes que los puntos
  group.add(panel);
  const grid = new THREE.GridHelper(W, 24, 0x1d2638, 0x161d2b);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(ORIGIN_X, 2, -0.35);
  grid.scale.set(1, 1, 10 / W);
  grid.material.transparent = true;
  grid.renderOrder = -1;
  group.add(grid);
  const sepGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(px(0), -3.1, -0.3), new THREE.Vector3(px(IMG_W), -3.1, -0.3)]);
  const frameMat = new THREE.LineBasicMaterial({ color: 0x3a4660, transparent: true });
  group.add(new THREE.Line(sepGeo, frameMat));
  const zeroSubGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(px(40), py(965), 0), new THREE.Vector3(px(1515), py(965), 0)]);
  group.add(new THREE.Line(zeroSubGeo, frameMat));
  const staticMats = [panelMat, grid.material, frameMat];

  // Velas (cuerpos instanciados + mechas)
  const N = 260;
  const step = IMG_W / N;
  const bodyGeo = new THREE.BoxGeometry(step * (W / IMG_W) * 0.62, 1, 0.12);
  const candleMat = new THREE.MeshBasicMaterial({ color: 0xd8dde6, transparent: true });
  const bodies = new THREE.InstancedMesh(bodyGeo, candleMat, N);
  const wickPts = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  let prevClose = lerpPath(PRICE, 0);
  for (let i = 0; i < N; i++) {
    const x = i * step + step / 2;
    const base = lerpPath(PRICE, x);
    const close = base + (rnd(i) - 0.5) * 34;
    const open = prevClose;
    const hi = Math.min(open, close) - rnd(i + 99) * 22;
    const lo = Math.max(open, close) + rnd(i + 199) * 22;
    prevClose = close;
    const yTop = py(Math.min(open, close));
    const yBot = py(Math.max(open, close));
    v.set(px(x), (yTop + yBot) / 2, 0);
    s.set(1, Math.max(0.04, yTop - yBot), 1);
    m4.compose(v, q, s);
    bodies.setMatrixAt(i, m4);
    bodies.setColorAt(i, col.set(close < open ? 0xe9edf5 : 0x6f7a91)); // en la captura: sube = cuerpo claro
    wickPts.push(px(x), py(hi), 0, px(x), py(lo), 0);
  }
  const wickGeo = new THREE.BufferGeometry();
  wickGeo.setAttribute('position', new THREE.Float32BufferAttribute(wickPts, 3));
  const wickMat = new THREE.LineBasicMaterial({ color: 0x9aa4b8, transparent: true });
  const candles = new THREE.Group();
  candles.add(bodies, new THREE.LineSegments(wickGeo, wickMat));
  group.add(candles);
  const candleMats = [candleMat, wickMat];

  function dots(positions, color, size, stepIdx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = dotsMaterial(color, size, glow);
    const p = new THREE.Points(g, mat);
    // Halo del mismo color que parpadea cuando se describe la parte
    const halo = new THREE.Points(g, dotsMaterial(color, size * 3.4, glow));
    halo.material.opacity = 0;
    p.add(halo);
    group.add(p);
    parts.push({ obj: p, mats: [mat], step: stepIdx, halo });
    return p;
  }

  // 1 · Volume GEX+ (verde)
  dots(dottedRow(84, 120, 1515, 7, 4, 1), 0x5ee08a, 0.16, 1);
  // 2 · Convexidad + (cian)
  dots([...dottedRow(143, 545, 1080, 9, 8, 2), ...dottedRow(243, 1085, 1515, 9, 8, 3), ...dottedRow(148, 160, 200, 9, 4, 4)], 0x34d6f0, 0.15, 2);
  // 4 · Zero Gamma (amarillo), sigue la curva de la captura
  const zero = [];
  for (let x = 90, i = 0; x <= 1515; x += 8, i++) zero.push(px(x), py(lerpPath(ZERO, x) + (rnd(i + 40) - 0.5) * 22), 0);
  dots(zero, 0xf5c84b, 0.17, 4);
  // 5 · Convexidad − (azul)
  dots(dottedRow(562, 1070, 1415, 8, 8, 5), 0x7d95ff, 0.2, 5);
  // 6 · Volume GEX− (rojo)
  dots([...dottedRow(610, 637, 1300, 7, 3, 6), ...dottedRow(506, 1258, 1490, 8, 3, 7), ...dottedRow(401, 1280, 1515, 12, 3, 8), ...dottedRow(716, 535, 645, 8, 3, 9)], 0xff4d5e, 0.15, 6);

  // 3 · Spikes de flujo de opciones: anillo de convexidad + núcleo GEX
  const ringGeo = new THREE.TorusGeometry(0.3, 0.055, 12, 48);
  const coreGeo = new THREE.SphereGeometry(0.22, 24, 16);
  const SPIKES = [
    [500, 378, 0x34d6f0, 0xd23a55],
    [785, 152, 0x8f6bff, 0x3fbf6a],
    [1247, 315, 0x34d6f0, 0xd23a55],
    [1426, 300, 0x34d6f0, 0xd23a55],
    [1385, 402, 0x8f6bff, 0xd23a55],
  ];
  const spikeGroup = new THREE.Group();
  const spikeMats = [];
  SPIKES.forEach(([x, y, rc, cc]) => {
    const g = new THREE.Group();
    const rm = new THREE.MeshBasicMaterial({ color: rc, transparent: true });
    const cm = new THREE.MeshBasicMaterial({ color: cc, transparent: true });
    const gm = new THREE.SpriteMaterial({ map: glow, color: rc, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowS = new THREE.Sprite(gm);
    glowS.scale.setScalar(1.6);
    g.add(new THREE.Mesh(ringGeo, rm), new THREE.Mesh(coreGeo, cm), glowS);
    g.position.set(px(x), py(y), 0.05);
    g.userData.ring = g.children[0];
    g.userData.core = g.children[1];
    spikeGroup.add(g);
    spikeMats.push(rm, cm, gm);
  });
  group.add(spikeGroup);
  parts.push({ obj: spikeGroup, mats: spikeMats, step: 3, spikes: true });

  // 7 y 8 · Áreas del sentimiento, extruidas para darles volumen
  function area(path, color, stepIdx) {
    const shape = new THREE.Shape();
    shape.moveTo(px(path[0][0]), py(965));
    for (const [x, y] of path) shape.lineTo(px(x), py(y));
    shape.lineTo(px(path[path.length - 1][0]), py(965));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
    geo.translate(0, 0, -0.175);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3), transparent: true });
    mat.userData.color0 = mat.color.clone();
    const m = new THREE.Mesh(geo, mat);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat));
    group.add(m);
    parts.push({ obj: m, mats: [mat, edgeMat], step: stepIdx, area: mat });
  }
  area(SENT_POS, 0x35c95a, 7);
  area(SENT_NEG, 0x9b3fd0, 8);

  parts.forEach((p) => p.mats.forEach((m) => { m.userData.base = m.opacity ?? 1; }));
  [...staticMats, ...candleMats].forEach((m) => { m.userData.base = m.opacity ?? 1; });

  // ind: 0 = vista general, 1..8 = paso activo (interpolado por el scroll)
  function update(state, t, reduced) {
    const vis = state.ind3d;
    group.visible = vis > 0.01;
    if (!group.visible) return;
    const ind = state.ind;
    const overview = Math.max(0, 1 - ind); // en la vista general todo encendido
    const blink = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(t * 5.5); // parpadeo de la parte descrita
    for (const p of parts) {
      const w = Math.max(0, 1 - Math.abs(ind - p.step));
      const bright = Math.max(overview, w);
      const o = (0.18 + 0.82 * bright) * vis * (1 - 0.35 * w * (1 - blink));
      p.mats.forEach((m) => { m.opacity = m.userData.base * o; });
      if (p.halo) p.halo.material.opacity = w * vis * (0.25 + 0.55 * blink);
      if (p.area) p.area.color.copy(p.area.userData.color0).lerp(WHITE, 0.45 * w * blink);
      // La parte descrita se levanta hacia la cámara y respira
      const lift = w * 1.4;
      p.obj.position.z = lift;
      if (p.obj.isPoints) p.obj.material.size = (p.obj.userData.size0 ??= p.obj.material.size) * (1 + w * 0.9);
      if (p.spikes) {
        p.obj.children.forEach((g, i) => {
          const pulse = reduced ? 1 : 1 + 0.12 * Math.sin(t * 3 + i);
          g.scale.setScalar((1 + w * 0.8) * pulse);
          g.children[2].material.opacity = g.children[2].material.userData.base * (1 + w * (0.4 + 1.2 * blink)) * o;
          g.children[2].scale.setScalar(1.6 * (1 + w * 0.8 * blink));
          g.userData.ring.rotation.y = reduced ? 0.4 * w : t * 0.8 * w + i;
          g.userData.ring.position.z = -0.5 * w; // anillo y núcleo se separan en profundidad
          g.userData.core.position.z = 0.35 * w;
        });
      }
    }
    const dimOthers = 0.35 + 0.65 * overview;
    candleMats.forEach((m) => { m.opacity = m.userData.base * dimOthers * vis; });
    staticMats.forEach((m) => { m.opacity = m.userData.base * vis; });
  }

  return { group, update };
}
