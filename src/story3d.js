import * as THREE from 'three';

// Dos escenas 3D propias para los capítulos «¿Operando en la niebla?» y
// «Sala de máquinas». Viven lejos del resto del mundo para que no se mezclen,
// y scene.js las enciende con state.story (niebla) y state.eng3d (sala).

const C = {
  pos: new THREE.Color('#5ee08a'),
  neg: new THREE.Color('#ef3fa6'),
  zero: new THREE.Color('#f5c84b'),
  long: new THREE.Color('#34d6f0'),
  short: new THREE.Color('#8f6bff'),
  up: new THREE.Color('#d8dde6'),
  down: new THREE.Color('#6b7488'),
};

const FX = -40; // centro de la escena de la niebla
const EZ = -90; // profundidad de la sala de máquinas
const GEX_POS = 2.6;
const GEX_NEG = -2.6;

function rnd(i) { const s = Math.sin(i * 78.233 + 12.9898) * 43758.5453; return s - Math.floor(s); }
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

// Cámaras por paso (las usa scene.js como fotogramas clave)
function cam(look, from, ox) {
  return { ox, lx: look[0], ly: look[1], lz: look[2], cx: from[0], cy: from[1], cz: from[2] };
}
export const FOG_CAMERAS = {
  fog0: cam([FX + 1, 0, 0], [FX + 3, 0.6, 12], 0.27),
  fog1: cam([FX - 1, -0.2, 0], [FX + 3, 7, 18], 0.24),
};
export const ENGINE_CAMERAS = {
  eng0: cam([1.5, 0.4, EZ], [0, 4, EZ + 29], -0.24),
  eng1: cam([-7, 0, EZ], [-9.5, 1.8, EZ + 13], -0.25),
  eng2: cam([0, 1.1, EZ + 1], [-1.6, 2.4, EZ + 10.5], -0.25),
  eng3: cam([8, 0, EZ], [5.2, 1, EZ + 10.5], -0.25),
};

function glowPoints(positions, color, size, glow, opacity = 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color, size, map: glow, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  return new THREE.Points(geo, mat);
}

// ---------- Niebla: el precio sin mapa y la estructura que aparece debajo ----------
function buildFog(glow) {
  const group = new THREE.Group();
  group.position.set(FX, 0, 0);

  // Precio: velas instanciadas que pasan de ruido a un recorrido entre niveles
  const N = 110;
  const X0 = -11;
  const X1 = 11;
  const xs = Array.from({ length: N + 1 }, (_, i) => X0 + ((X1 - X0) * i) / N);
  let walk = 0;
  const noisy = xs.map((x, i) => {
    walk += (rnd(i) - 0.5) * 1.1;
    walk *= 0.94;
    return walk + Math.sin(x * 2.3) * 0.9 + (rnd(i + 300) - 0.5) * 1.6;
  });
  const STRUCT = [[-11, -0.4], [-8.5, 2.3], [-6.5, 0.3], [-4.5, 2.5], [-2.2, 0.2], [-0.2, -0.6], [1.6, -2.4], [3.4, -1.1], [5.2, -2.5], [7.4, 0.1], [9.2, 2.2], [11, 2.5]];
  const structured = xs.map((x, i) => smooth(STRUCT, x) + (rnd(i + 900) - 0.5) * 0.35);
  const bodyGeo = new THREE.BoxGeometry(((X1 - X0) / N) * 0.62, 1, 0.14);
  const candleMat = new THREE.MeshBasicMaterial({ transparent: true });
  const candles = new THREE.InstancedMesh(bodyGeo, candleMat, N);
  candles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  group.add(candles);
  const wickGeo = new THREE.BufferGeometry();
  wickGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3));
  const wickMat = new THREE.LineBasicMaterial({ color: 0x8b95a8, transparent: true, opacity: 0.7 });
  group.add(new THREE.LineSegments(wickGeo, wickMat));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const v = new THREE.Vector3();
  let lastS = -1;
  function layoutCandles(s) {
    if (Math.abs(s - lastS) < 0.002) return;
    lastS = s;
    const wp = wickGeo.attributes.position.array;
    const y = (i) => noisy[i] * (1 - s) + structured[i] * s;
    for (let i = 0; i < N; i++) {
      const a = y(i);
      const b = y(i + 1);
      const h = Math.max(0.06, Math.abs(b - a));
      v.set((xs[i] + xs[i + 1]) / 2, (a + b) / 2, 0);
      sc.set(1, h, 1);
      candles.setMatrixAt(i, m4.compose(v, q, sc));
      candles.setColorAt(i, b >= a ? C.up : C.down);
      const ext = 0.12 + rnd(i + 50) * 0.35;
      wp.set([v.x, Math.max(a, b) + ext, 0, v.x, Math.min(a, b) - ext, 0], i * 6);
    }
    candles.instanceMatrix.needsUpdate = true;
    candles.instanceColor.needsUpdate = true;
    wickGeo.attributes.position.needsUpdate = true;
  }

  // Indicadores que se contradicen: curvas de colores que se cruzan sin sentido
  const noise = [];
  [[C.long, 1.7, 0.2, 1.6], [C.zero, 0.9, 1.9, 2.1], [C.neg, 2.6, 3.1, 1.2], [C.short, 1.2, 4.4, 2.6], [C.pos, 3.4, 5.5, 0.9]].forEach(([col, f, ph, amp], k) => {
    const pts = [];
    for (let x = X0; x <= X1; x += 0.11) {
      pts.push(x, Math.sin(x * f * 0.5 + ph) * amp + Math.sin(x * f * 1.7 + ph * 2) * amp * 0.35, 0.3 + k * 0.25);
    }
    const p = glowPoints(pts, col, 0.16, glow, 0.9);
    noise.push(p);
    group.add(p);
  });

  // Niebla: grandes manchas suaves que derivan despacio
  const F = 160;
  const fogBase = [];
  for (let i = 0; i < F; i++) fogBase.push((rnd(i) - 0.5) * 30, (rnd(i + 1e3) - 0.5) * 10, (rnd(i + 2e3) - 0.5) * 14 - 1);
  const fogGeo = new THREE.BufferGeometry();
  fogGeo.setAttribute('position', new THREE.Float32BufferAttribute(fogBase.slice(), 3));
  const fogMat = new THREE.PointsMaterial({ color: 0x8592ad, size: 7, map: glow, transparent: true, opacity: 0.16, depthWrite: false });
  const fogPts = new THREE.Points(fogGeo, fogMat);
  group.add(fogPts);

  // Los tres planos de la cobertura: GEX+, Zero Gamma y GEX−
  const planes = [[GEX_POS, C.pos], [0, C.zero], [GEX_NEG, C.neg]].map(([y, col]) => {
    const g = new THREE.Group();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(23, 9),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.z = -2.5;
    g.add(plane);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(23, 9)),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0 }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.z = -2.5;
    g.add(edge);
    const front = [];
    for (let x = -11.5; x <= 11.5; x += 0.14) front.push(x, 0, 2);
    const line = glowPoints(front, col, 0.2, glow, 0);
    g.add(line);
    g.userData = { y, plane, edge, line };
    group.add(g);
    return g;
  });

  function update(state, t, reduced) {
    const vis = state.story;
    group.visible = vis > 0.01;
    if (!group.visible) return;
    const s = clamp01(state.fogStep);
    const clear = s * s * (3 - 2 * s);
    layoutCandles(clear);
    candleMat.opacity = vis;
    wickMat.opacity = 0.7 * vis;
    noise.forEach((p, k) => {
      p.material.opacity = 0.9 * (1 - clear) * vis;
      p.position.y = reduced ? 0 : Math.sin(t * (0.6 + k * 0.17) + k) * 0.35 * (1 - clear);
    });
    fogMat.opacity = 0.17 * (1 - clear * 0.94) * vis;
    if (!reduced) {
      const a = fogGeo.attributes.position.array;
      for (let i = 0; i < F; i++) {
        a[i * 3] = fogBase[i * 3] + Math.sin(t * 0.12 + i) * 1.4 + clear * (fogBase[i * 3] > 0 ? 9 : -9);
        a[i * 3 + 1] = fogBase[i * 3 + 1] + Math.cos(t * 0.1 + i * 1.7) * 0.5;
      }
      fogGeo.attributes.position.needsUpdate = true;
    }
    planes.forEach((g, k) => {
      const d = g.userData;
      const rise = clamp01(clear * 1.3 - k * 0.15);
      g.position.y = d.y - (1 - rise) * 2;
      d.plane.material.opacity = 0.07 * rise * vis;
      d.edge.material.opacity = 0.35 * rise * vis;
      const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 2 + k);
      d.line.material.opacity = rise * vis * pulse;
    });
  }
  return { group, update };
}

// ---------- Sala de máquinas: motor de opciones → RT Magneto → tu futuro ----------
function buildEngine(glow) {
  const group = new THREE.Group();
  group.position.set(0, 0, EZ);
  const parts = []; // { obj, mats, step }
  const fade = (obj, step) => {
    const mats = [];
    obj.traverse((o) => {
      if (!o.material) return;
      o.material.transparent = true;
      o.material.userData.base = o.material.opacity;
      mats.push(o.material);
    });
    parts.push({ obj, mats, step });
    return obj;
  };

  // Luces solo para el imán metálico (el resto usa materiales sin iluminación)
  const key = new THREE.PointLight(0xffffff, 60, 30, 1.6);
  key.position.set(-2, 5, 6);
  const rim = new THREE.PointLight(0x34d6f0, 30, 20, 1.6);
  rim.position.set(3, -1, 3);
  group.add(key, rim, new THREE.AmbientLight(0x404a60, 1.2));

  // Motor de opciones: núcleo, anillos giroscópicos y contratos en órbita
  const reactor = new THREE.Group();
  reactor.position.set(-7, 0, 0);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), new THREE.MeshBasicMaterial({ color: 0xe9f6ff }));
  reactor.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: C.long, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
  halo.scale.setScalar(6.5);
  reactor.add(halo);
  const rings = [[1.6, C.long, [0.3, 0, 0]], [2.15, C.short, [1.1, 0.4, 0]], [2.7, C.zero, [-0.6, 1.2, 0.3]]].map(([r, col, rot]) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 10, 120), new THREE.MeshBasicMaterial({ color: col }));
    m.rotation.set(...rot);
    reactor.add(m);
    return m;
  });
  const K = 56;
  const contracts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), K);
  const orbit = [];
  for (let i = 0; i < K; i++) {
    orbit.push({ r: 3.1 + rnd(i) * 1.2, a: rnd(i + 7) * Math.PI * 2, tilt: (rnd(i + 13) - 0.5) * 1.4, sp: 0.25 + rnd(i + 19) * 0.35 });
    contracts.setColorAt(i, i % 2 ? C.pos : C.neg); // calls y puts
  }
  reactor.add(contracts);
  group.add(fade(reactor, 1));

  // Conducto: la fuerza viaja de las opciones al futuro
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4.2, 0, 0), new THREE.Vector3(-2, 0.9, 0.6), new THREE.Vector3(0, 0.6, 1),
    new THREE.Vector3(2.2, 0.9, 0.6), new THREE.Vector3(4.3, 0, 0),
  ]);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.13, 12), new THREE.MeshBasicMaterial({ color: C.long, opacity: 0.22, depthWrite: false }));
  group.add(fade(tube, 2));
  const P = 90;
  const flow = glowPoints(new Array(P * 3).fill(0), C.long, 0.34, glow);
  group.add(fade(flow, 2));
  const tmp = new THREE.Vector3();
  function layoutFlow(t, speed) {
    const a = flow.geometry.attributes.position.array;
    for (let i = 0; i < P; i++) {
      curve.getPointAt((i / P + t * speed) % 1, tmp);
      a.set([tmp.x, tmp.y + Math.sin(i * 2.1) * 0.06, tmp.z + Math.cos(i * 1.3) * 0.06], i * 3);
    }
    flow.geometry.attributes.position.needsUpdate = true;
  }

  // RT Magneto: un imán de herradura metálico con polos rojo y azul
  const magnet = new THREE.Group();
  magnet.position.set(0, 1.55, 1);
  const steel = new THREE.MeshPhongMaterial({ color: 0xb9c2cf, specular: 0xffffff, shininess: 90 });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.27, 20, 48, Math.PI), steel);
  magnet.add(arc);
  [[-0.8, 0xe5484d], [0.8, 0x3b6cf0]].forEach(([x, col]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.45, 20), steel);
    leg.position.set(x, -0.22, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.42, 20), new THREE.MeshPhongMaterial({ color: col, specular: 0xffffff, shininess: 60 }));
    pole.position.set(x, -0.65, 0);
    magnet.add(leg, pole);
  });
  const field = [];
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      pts.push(Math.cos(a) * (1.4 + k * 0.45), -0.6 + Math.sin(a) * (0.55 + k * 0.25), 0);
    }
    const f = glowPoints(pts, C.zero, 0.1, glow, 0.6);
    field.push(f);
    magnet.add(f);
  }
  group.add(fade(magnet, 2));

  // Tu futuro: un gráfico de velas que recibe los niveles
  const chart = new THREE.Group();
  chart.position.set(8.2, 0, 0);
  chart.rotation.y = -0.32;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 5.6), new THREE.MeshBasicMaterial({ color: 0x0c111c, opacity: 0.94, depthWrite: false }));
  panel.position.z = -0.2;
  chart.add(panel);
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(7.4, 5.6)), new THREE.MeshBasicMaterial({ color: 0x3a4660 }));
  frame.position.z = -0.19;
  chart.add(frame);
  const M = 46;
  const cGeo = new THREE.BoxGeometry(0.085, 1, 0.08);
  const cMesh = new THREE.InstancedMesh(cGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), M);
  const wick = [];
  const LV = [[1.55, C.pos], [0.15, C.zero], [-1.55, C.neg]];
  const path = [[-3.3, -0.4], [-2.4, 1.35], [-1.6, 0.3], [-0.8, 1.5], [0, 0.2], [0.8, -1.4], [1.6, -0.6], [2.4, -1.5], [3.3, 0.4]];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  let prev = smooth(path, -3.3);
  for (let i = 0; i < M; i++) {
    const x = -3.3 + (6.6 * (i + 0.5)) / M;
    const y = smooth(path, x) + (rnd(i + 40) - 0.5) * 0.3;
    const h = Math.max(0.05, Math.abs(y - prev));
    cMesh.setMatrixAt(i, m4.compose(tmp.set(x, (y + prev) / 2, 0), q, sc.set(1, h, 1)));
    cMesh.setColorAt(i, y >= prev ? C.up : C.down);
    wick.push(x, Math.max(y, prev) + 0.15, 0, x, Math.min(y, prev) - 0.15, 0);
    prev = y;
  }
  chart.add(cMesh);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wick, 3));
  chart.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x8b95a8, opacity: 0.7 })));
  const levels = LV.map(([y, col]) => {
    const pts = [];
    for (let x = 0; x <= 6.8; x += 0.1) pts.push(x, 0, 0.12);
    const l = glowPoints(pts, col, 0.17, glow);
    l.position.set(-3.4, y, 0);
    chart.add(l);
    return l;
  });
  group.add(fade(chart, 3));

  function update(state, t, reduced) {
    const vis = state.eng3d;
    group.visible = vis > 0.01;
    if (!group.visible) return;
    const s = state.engStep;
    const overview = Math.max(0, 1 - s);
    const w = (i) => Math.max(0, 1 - Math.abs(s - i));
    for (const p of parts) {
      const o = (0.22 + 0.78 * Math.max(overview, w(p.step))) * vis;
      p.mats.forEach((m) => { m.opacity = (m.userData.base ?? 1) * o; });
    }
    const tt = reduced ? 0.6 : t;
    // El motor gira más rápido cuando se describe
    const rpm = 0.5 + w(1) * 1.2;
    rings.forEach((r, i) => { r.rotation.z = tt * rpm * (i % 2 ? -1 : 1) * (0.6 + i * 0.25); r.rotation.y += reduced ? 0 : 0.002 * (i + 1); });
    core.scale.setScalar(1 + (reduced ? 0 : Math.sin(t * 3) * 0.05) + w(1) * 0.15);
    for (let i = 0; i < K; i++) {
      const o = orbit[i];
      const a = o.a + tt * o.sp * rpm;
      tmp.set(Math.cos(a) * o.r, Math.sin(a) * o.r * Math.sin(o.tilt), Math.sin(a) * o.r * Math.cos(o.tilt));
      contracts.setMatrixAt(i, m4.compose(tmp, q, sc.setScalar(1 + w(1) * 0.25)));
    }
    contracts.instanceMatrix.needsUpdate = true;
    layoutFlow(tt, 0.08 + w(2) * 0.1);
    magnet.rotation.y = reduced ? -0.35 : Math.sin(t * 0.5) * 0.5;
    magnet.scale.setScalar(1 + w(2) * 0.35);
    field.forEach((f, k) => { f.scale.setScalar(1 + (reduced ? 0 : ((t * 0.6 + k / 3) % 1) * 0.25)); });
    // Los niveles se dibujan sobre tu gráfico al llegar al futuro (y en la vista general)
    const draw = Math.max(overview, clamp01((s - 2.2) / 0.8));
    levels.forEach((l, k) => { l.scale.x = Math.max(0.001, clamp01(draw * 1.4 - k * 0.2)); });
  }
  return { group, update };
}

export function buildStory(glow) {
  const fog = buildFog(glow);
  const engine = buildEngine(glow);
  return {
    groups: [fog.group, engine.group],
    update(state, t, reduced) {
      fog.update(state, t, reduced);
      engine.update(state, t, reduced);
    },
  };
}
