/* Ritlog — 3D-auto in speelgoedstijl, maar met het echte silhouet van het type auto.
   De zijkant wordt als profiel getekend (motorkap, voorruit, dak, achterkant, wielkasten)
   en in de breedte geëxtrudeerd met afgeronde randen; ruiten, lampen en wielen komen erbij.
   mountCar(container, { color, body, dims }) → { update(opts), destroy() }
   dims = { L, W, H, wb } in meters (uit cars.js); zonder dims gelden standaardmaten per vorm. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

// Profiel van de bovenkant, van achter (x=0) naar voor (x=1). h = hoogte als deel van (dak − bodem),
// waarbij 'b' de gordellijn (onderkant ramen) is. rw/ws = punten van achterruit en voorruit.
const PROFILES = {
  hatch: { belt: 0.47, top: (b) => [[0, b - 0.02], [0.02, b + 0.07], [0.11, 1], [0.56, 1], [0.73, b + 0.02], [0.96, b - 0.07], [1, b - 0.21]], rw: [1, 2], ws: [3, 4] },
  sedan: { belt: 0.47, top: (b) => [[0, b + 0.03], [0.17, b + 0.07], [0.27, b + 0.09], [0.41, 1], [0.64, 1], [0.78, b + 0.02], [0.97, b - 0.07], [1, b - 0.21]], rw: [2, 3], ws: [4, 5] },
  fastback: { belt: 0.47, top: (b) => [[0, b + 0.03], [0.07, b + 0.07], [0.37, 1], [0.62, 1], [0.77, b + 0.02], [0.97, b - 0.07], [1, b - 0.21]], rw: [1, 2], ws: [3, 4] },
  wagon: { belt: 0.47, top: (b) => [[0, b - 0.02], [0.015, b + 0.08], [0.05, 0.98], [0.62, 1], [0.75, b + 0.02], [0.97, b - 0.07], [1, b - 0.21]], rw: [1, 2], ws: [3, 4], rails: true },
  suv: { belt: 0.52, top: (b) => [[0, b - 0.02], [0.015, b + 0.08], [0.06, 0.98], [0.6, 1], [0.74, b + 0.02], [0.97, b - 0.05], [1, b - 0.19]], rw: [1, 2], ws: [3, 4], rails: true },
  crossover: { belt: 0.5, top: (b) => [[0, b - 0.02], [0.03, b + 0.08], [0.16, 0.97], [0.58, 1], [0.73, b + 0.02], [0.97, b - 0.06], [1, b - 0.2]], rw: [1, 2], ws: [3, 4] },
  van: { belt: 0.46, top: (b) => [[0, b + 0.02], [0.006, 0.97], [0.02, 1], [0.82, 1], [0.93, b + 0.06], [0.99, b - 0.06], [1, b - 0.22]], rw: [1, 2], ws: [3, 4], panel: true },
  mpv: { belt: 0.48, top: (b) => [[0, b], [0.01, 0.97], [0.03, 1], [0.72, 1], [0.86, b + 0.03], [0.98, b - 0.06], [1, b - 0.2]], rw: [1, 2], ws: [3, 4] },
  sport: { belt: 0.55, top: (b) => [[0, b], [0.12, b + 0.09], [0.32, 1], [0.52, 1], [0.62, b + 0.02], [0.95, b - 0.11], [1, b - 0.26]], rw: [1, 2], ws: [3, 4] },
  pickup: { belt: 0.5, top: (b) => [[0, b + 0.02], [0.4, b + 0.02], [0.41, 0.98], [0.42, 1], [0.66, 1], [0.77, b + 0.02], [0.97, b - 0.05], [1, b - 0.2]], rw: [1, 3], ws: [4, 5], bed: 0.4 },
};
// Standaardmaten (m) als het model onbekend is
const DEFAULT_DIMS = {
  hatch: { L: 4.0, W: 1.75, H: 1.48, wb: 2.55 }, sedan: { L: 4.7, W: 1.83, H: 1.45, wb: 2.8 },
  fastback: { L: 4.7, W: 1.85, H: 1.45, wb: 2.85 }, wagon: { L: 4.65, W: 1.8, H: 1.48, wb: 2.7 },
  suv: { L: 4.5, W: 1.85, H: 1.65, wb: 2.68 }, crossover: { L: 4.3, W: 1.8, H: 1.56, wb: 2.62 },
  van: { L: 4.95, W: 1.92, H: 1.98, wb: 2.95 }, mpv: { L: 4.5, W: 1.85, H: 1.82, wb: 2.75 },
  sport: { L: 4.3, W: 1.8, H: 1.28, wb: 2.4 }, pickup: { L: 5.3, W: 1.88, H: 1.85, wb: 3.1 },
};
const CLEARANCE = { suv: 0.19, crossover: 0.17, van: 0.17, mpv: 0.16, pickup: 0.23, sport: 0.11 };
const WHEEL = { suv: 0.37, crossover: 0.35, van: 0.35, mpv: 0.33, pickup: 0.39, sport: 0.34, sedan: 0.33, fastback: 0.34, wagon: 0.33 };
export const BODY_IDS = Object.keys(PROFILES);

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.32)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Polylijn met afgeronde hoeken toevoegen aan een (bestaand) pad
function roundedLine(path, pts, radii, prev, next) {
  pts.forEach((p, i) => {
    const a = i === 0 ? prev : pts[i - 1];
    const c = i === pts.length - 1 ? next : pts[i + 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lc = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const r = Math.min(radii[i], la / 2, lc / 2);
    if (r < 0.005) { path.lineTo(p[0], p[1]); return; }
    path.lineTo(p[0] + ((a[0] - p[0]) / la) * r, p[1] + ((a[1] - p[1]) / la) * r);
    path.quadraticCurveTo(p[0], p[1], p[0] + ((c[0] - p[0]) / lc) * r, p[1] + ((c[1] - p[1]) / lc) * r);
  });
}
function roundedShape(pts, r) {
  const s = new THREE.Shape();
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  s.moveTo(start[0], start[1]);
  roundedLine(s, pts, pts.map(() => r), pts[n - 1], pts[0]);
  s.lineTo(start[0], start[1]);
  return s;
}
// Glasvlak tussen twee profielpunten (voor-/achterruit), iets naar buiten geschoven
function slopePlane(A, B, width, mat, out) {
  const d = new THREE.Vector3(B[0] - A[0], B[1] - A[1], 0);
  const len = d.length(); d.normalize();
  const n = new THREE.Vector3(d.y, -d.x, 0);
  if (out < 0) n.negate();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.84, width), mat);
  const basis = new THREE.Matrix4().makeBasis(d, new THREE.Vector3(0, 0, 1), d.clone().cross(new THREE.Vector3(0, 0, 1)));
  m.quaternion.setFromRotationMatrix(basis);
  m.position.set((A[0] + B[0]) / 2 + n.x * 0.075, (A[1] + B[1]) / 2 + n.y * 0.075, 0);
  return m;
}

export function buildCar({ color = '#3b7ddd', body = 'hatch', dims } = {}) {
  const P = PROFILES[body] ? body : 'hatch';
  const prof = PROFILES[P];
  const D = { ...DEFAULT_DIMS[P], ...(dims || {}) };
  const { L, W, H } = D;
  const wb = Math.min(D.wb, L * 0.72);
  const g = CLEARANCE[P] ?? 0.14;
  const r = (WHEEL[P] ?? 0.32) * 1.08; // iets grotere wielen: speelgoedlook
  const car = new THREE.Group();
  // Zachte 'klei'-look zoals een miniatuur: matte lak, donker glas, lichte chroomdelen
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#15181d', roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: '#202124', roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: '#34353a', roughness: 0.65 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#eceef1', roughness: 0.28, metalness: 0.35 });
  const hub = new THREE.MeshStandardMaterial({ color: '#f3f3f1', roughness: 0.35, metalness: 0.15 });
  const seam = new THREE.MeshStandardMaterial({ color: '#000000', roughness: 1, transparent: true, opacity: 0.22 });
  const head = new THREE.MeshStandardMaterial({ color: '#f4f8fb', emissive: '#e8f0ff', emissiveIntensity: 0.25, roughness: 0.15 });
  const amber = new THREE.MeshStandardMaterial({ color: '#ff8a1f', emissive: '#e86a00', emissiveIntensity: 0.3, roughness: 0.35 });
  const tail = new THREE.MeshStandardMaterial({ color: '#e0403a', emissive: '#c42d27', emissiveIntensity: 0.35, roughness: 0.3 });
  const plate = new THREE.MeshStandardMaterial({ color: '#f7c600', roughness: 0.5 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); car.add(m); return m; };
  const rugged = P === 'suv' || P === 'pickup' || P === 'van';
  const rbox = (w, h, d, rad) => new RoundedBoxGeometry(w, h, d, 4, Math.min(rad, w / 2, h / 2, d / 2) * 0.999);

  const X = (f) => -L / 2 + f * L;
  const Y = (h) => g + h * (H - g);
  const top = prof.top(prof.belt).map(([f, h]) => [X(f), Y(h)]);
  const beltY = Y(prof.belt);
  const frontAxle = L / 2 - (L - wb) * 0.54, rearAxle = frontAxle - wb;

  // --- Carrosserie: zijprofiel met wielkasten, geëxtrudeerd met ronde randen ---
  const ra = r + 0.08; // straal wielkast
  const s = new THREE.Shape();
  s.moveTo(X(0) + 0.15, g);
  [rearAxle, frontAxle].forEach((ax) => {
    s.lineTo(ax - ra, g); s.lineTo(ax - ra, r);
    s.absarc(ax, r, ra, Math.PI, 0, true);
    s.lineTo(ax + ra, g);
  });
  const outline = [[X(1), g], ...top.slice().reverse(), [X(0), g]];
  const roofIdx = new Set([prof.rw[1], prof.ws[0]].map((i) => top.length - 1 - i + 1));
  const radii = outline.map((_, i) => (i === 0 || i === outline.length - 1 ? 0.12 : roofIdx.has(i) ? 0.3 : 0.1));
  roundedLine(s, outline, radii, [frontAxle + ra, g], [X(0) + 0.15, g]);
  const bt = 0.07, bs = 0.05;
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: W - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 5, curveSegments: 14 });
  bodyGeo.translate(0, 0, -(W - 2 * bt) / 2);
  add(bodyGeo, paint, 0, 0, 0);

  // --- Ruiten: zijramen (met B-stijl), voor- en achterruit ---
  const [rwA, rwB] = prof.rw.map((i) => top[i]);
  const [wsA, wsB] = prof.ws.map((i) => top[i]); // wsA = dak voor, wsB = voet voorruit
  const winTop = top[prof.ws[0]][1] - 0.09, winBot = beltY + 0.04;
  const onLine = (P1, P2, y) => P1[0] + (P2[0] - P1[0]) * ((y - P1[1]) / (P2[1] - P1[1] || 1));
  const frontX = (y) => onLine(wsB, wsA, y) - 0.08;
  const rearBot = Math.max(winBot, rwA[1] + 0.04);
  const rearX = (y) => onLine(rwA, rwB, y) + 0.08;
  const bX = prof.panel ? frontX(winTop) - 0.55 : rwB[0] + (wsA[0] - rwB[0]) * 0.52;
  const panes = [[[bX + 0.05, winBot], [frontX(winBot), winBot], [frontX(winTop), winTop], [bX + 0.05, winTop]]];
  if (!prof.panel) panes.push([[rearX(rearBot), rearBot], [bX - 0.05, rearBot], [bX - 0.05, winTop], [rearX(winTop), winTop]]);
  panes.forEach((pts) => {
    if (pts[1][0] - pts[0][0] < 0.12) return;
    const geo = new THREE.ExtrudeGeometry(roundedShape(pts, 0.07), { depth: 0.012, bevelEnabled: false, curveSegments: 6 });
    [-1, 1].forEach((sz) => {
      const m = add(geo, glass, 0, 0, sz > 0 ? W / 2 + 0.004 : -W / 2 - 0.016);
      if (sz < 0) m.userData.mirror = true;
    });
  });
  car.add(slopePlane(wsB, wsA, W * 0.74, glass, 1));
  car.add(slopePlane(rwA, rwB, W * 0.72, glass, -1));

  // --- Wielen ---
  const tireGeo = new THREE.CylinderGeometry(r, r, 0.26, 36);
  const hubGeo = new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.27, 28);
  const capGeo = new THREE.CylinderGeometry(r * 0.16, r * 0.2, 0.3, 18);
  [rearAxle, frontAxle].forEach((x) => [-1, 1].forEach((sz) => {
    const z = sz * (W / 2 - 0.13);
    add(tireGeo, rubber, x, r, z).rotation.x = Math.PI / 2;
    add(hubGeo, hub, x, r, z).rotation.x = Math.PI / 2;
    add(capGeo, chrome, x, r, z).rotation.x = Math.PI / 2;
  }));

  // --- Lampen, bumpers, grille, kenteken, spiegels ---
  const noseY = top[top.length - 1][1], tailTopY = top[0][1];
  const fx = X(1) + bs; // voorkant
  const lampR = Math.min(0.16, (noseY - g) * 0.3);
  const lampGeo = new THREE.CylinderGeometry(lampR, lampR, 0.06, 28);
  const ringGeo = new THREE.TorusGeometry(lampR, 0.022, 10, 28);
  [-1, 1].forEach((sz) => {
    // Ronde koplampen met chromen rand + oranje knipperlicht
    const ly = noseY - lampR - 0.04, lz = sz * W * 0.31;
    add(lampGeo, head, fx - 0.01, ly, lz).rotation.z = Math.PI / 2;
    add(ringGeo, chrome, fx + 0.02, ly, lz).rotation.y = Math.PI / 2;
    add(rbox(0.05, 0.06, 0.1, 0.025), amber, fx - 0.005, ly - lampR - 0.07, sz * W * 0.4);
    add(rbox(0.1, 0.12, 0.28, 0.05), tail, X(0) - bs + 0.02, tailTopY - 0.12, sz * W * 0.34);
    // Spiegel op een steeltje
    add(rbox(0.08, 0.04, 0.12, 0.015), trim, wsB[0] - 0.1, beltY + 0.05, sz * (W / 2 + 0.03));
    add(rbox(0.16, 0.11, 0.08, 0.035), paint, wsB[0] - 0.12, beltY + 0.1, sz * (W / 2 + 0.1));
  });
  // Bumpers: chroom bij gewone auto's, donker kunststof bij SUV/bus/pick-up
  const bump = rugged ? trim : chrome;
  const bh = rugged ? 0.16 : 0.09;
  add(rbox(0.12, bh, W * 1.02, bh / 2), bump, fx - 0.02, g + 0.1, 0);
  add(rbox(0.12, bh, W * 1.02, bh / 2), bump, X(0) - bs + 0.02, g + 0.1, 0);
  // Grille: chromen lijst met horizontale spijlen
  const gy = g + 0.1 + bh / 2 + (noseY - lampR * 2 - 0.1 - (g + 0.1 + bh / 2)) / 2 + 0.03, gw = W * 0.38, gh = Math.max(0.1, Math.min(0.2, noseY - g - 0.35));
  add(rbox(0.03, gh, gw, 0.02), trim, fx + 0.005, gy, 0);
  [-1, 0, 1].forEach((i) => add(rbox(0.03, 0.018, gw - 0.04, 0.008), chrome, fx + 0.02, gy + i * gh * 0.28, 0));
  add(rbox(0.03, 0.12, 0.5, 0.02), plate, X(0) - bs - 0.005, g + 0.3, 0);
  // Deurnaden + chromen handgrepen
  const doorBot = g + 0.2, doorTop = beltY + 0.02;
  const doorEdges = [frontX(winBot) + 0.04, bX];
  if (!prof.panel && rwB[0] < bX - 0.6) doorEdges.push(Math.max(rearX(rearBot), bX - (wsA[0] - bX) - 0.05));
  const seamGeo = new THREE.BoxGeometry(0.014, doorTop - doorBot, 0.006);
  [-1, 1].forEach((sz) => {
    const z = sz * (W / 2 + 0.002);
    doorEdges.forEach((x) => add(seamGeo, seam, x, (doorTop + doorBot) / 2, z));
    [bX - 0.2, doorEdges[2] ? doorEdges[2] - 0.2 : null].filter(Boolean).forEach((x) =>
      add(rbox(0.13, 0.035, 0.03, 0.012), chrome, x, beltY - 0.08, sz * (W / 2 + 0.012)));
  });
  // Ruitenwissers op de voorruit
  const wd = new THREE.Vector3(wsA[0] - wsB[0], wsA[1] - wsB[1], 0).normalize();
  [-1, 1].forEach((sz) => {
    // ligt plat op het glas, dwars over de ruit
    const m = add(new THREE.BoxGeometry(0.022, 0.018, W * 0.3), trim, wsB[0] + wd.x * 0.16 + wd.y * 0.085, wsB[1] + wd.y * 0.16 - wd.x * 0.085, sz * W * 0.17);
    m.rotation.z = Math.atan2(wd.y, wd.x); m.rotation.y = sz * 0.18;
  });
  if (prof.rails) [-1, 1].forEach((sz) => add(rbox(rwB[0] < wsA[0] ? wsA[0] - rwB[0] - 0.2 : 1, 0.05, 0.05, 0.02), trim, (rwB[0] + wsA[0]) / 2, H + 0.04, sz * (W / 2 - 0.2)));
  if (prof.bed) add(rbox(X(prof.bed) - X(0) - 0.2, 0.03, W - 0.3, 0.01), trim, (X(0) + X(prof.bed)) / 2, beltY + 0.012, 0);

  // Zachte schaduw
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.3, W * 1.9), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.005; sh.material.opacity = 0.7;
  car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  car.add(sh);
  car.userData.size = { L, W, g: 0, h1: H, h2: 0 };
  return car;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
}

export function mountCar(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9c7d8', 1.7));
  // Zon van linksvoor-boven: harde, zachtgerande slagschaduw naar achteren zoals een miniatuurfoto
  const key = new THREE.DirectionalLight('#fffaf0', 2.6); key.position.set(-2.5, 7, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  key.shadow.radius = 5; key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.8); fill.position.set(4, 3, -3); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.3 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);

  let car = buildCar(opts);
  scene.add(car);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let angle = -0.75, vel = 0, dragging = false, lastX = 0, raf = 0, last = 0, visible = true, onScreen = true;

  function frame() {
    const b = car.userData.size;
    const radius = Math.hypot(b.L, b.W) / 2 + 0.25;
    const aspect = camera.aspect;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, aspect * 0.9) * 0.72;
    const target = new THREE.Vector3(0, (b.g + b.h1 + b.h2) * 0.42, 0);
    camera.position.set(0, target.y + dist * 0.62, dist * 0.92); // hoger standpunt, speelgoed-diorama
    camera.lookAt(target);
  }
  function resize() {
    const w = container.clientWidth || 300, h = container.clientHeight || 180;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    frame();
    renderer.render(scene, camera);
  }
  function tick(t) {
    raf = 0;
    if (!visible || !onScreen) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (!dragging) {
      vel *= 0.94;
      angle += vel + (reduce ? 0 : 0.32 * dt);
    }
    car.rotation.y = angle;
    car.position.y = reduce ? 0 : Math.sin(t / 420) * 0.018;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  const start = () => { if (!raf && visible && onScreen) { last = 0; raf = requestAnimationFrame(tick); } };

  const down = (e) => { dragging = true; lastX = e.clientX; vel = 0; };
  const move = (e) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; angle += dx * 0.012; vel = dx * 0.004; start(); };
  const up = () => { dragging = false; };
  container.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  const ro = new ResizeObserver(resize); ro.observe(container);
  const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; start(); }); io.observe(container);
  const vis = () => { visible = !document.hidden; start(); };
  document.addEventListener('visibilitychange', vis);
  resize(); start();

  return {
    update(next) {
      scene.remove(car); disposeTree(car);
      car = buildCar(next); car.rotation.y = angle; scene.add(car);
      frame(); renderer.render(scene, camera); start();
    },
    destroy() {
      cancelAnimationFrame(raf); raf = 0;
      ground.geometry.dispose(); ground.material.dispose();
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      container.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      disposeTree(car); renderer.dispose(); renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
}

// Klein zijaanzicht (SVG-pad) per vorm, voor de keuzechips; viewBox 0 0 48 22
export function silhouette(body) {
  const P = PROFILES[body] ? body : 'hatch';
  const prof = PROFILES[P], D = DEFAULT_DIMS[P];
  const sx = 46 / D.L, base = 18, g = (CLEARANCE[P] ?? 0.14), r = (WHEEL[P] ?? 0.32) * 1.08;
  const hpx = (D.H - g) * sx, gy = base - g * sx;
  const pts = prof.top(prof.belt).map(([f, h]) => [1 + f * 46, gy - h * hpx]);
  const wb = Math.min(D.wb, D.L * 0.72), fa = D.L / 2 - (D.L - wb) * 0.54;
  const wheels = [fa - wb, fa].map((a) => 1 + (a + D.L / 2) * sx);
  const f = (n) => n.toFixed(1);
  const d = `M${f(1)} ${f(gy)} ` + pts.map(([x, y]) => `L${f(x)} ${f(y)}`).join(' ') + ` L47 ${f(gy)} Z`;
  return { d, wheels: wheels.map(f), cy: f(base - r * sx), r: f(r * sx * 0.95) };
}
