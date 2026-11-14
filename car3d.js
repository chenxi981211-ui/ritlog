/* Ritlog — schattige 3D-auto, opgebouwd uit afgeronde blokken (three.js).
   mountCar(container, { color, body }) → { update(opts), destroy() }
   Draait alleen als hij in beeld is; sleep horizontaal om hem te draaien. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

// Maten per carrosserievorm (meters-achtig, bewust wat gedrongen voor een speelgoedlook)
// L lengte, W breedte, g bodemvrijheid, h1 onderkant, r wielstraal, wb wielbasis,
// cl/h2/cx cabine-lengte/-hoogte/-positie (cx < 0 = naar achteren)
const BODIES = {
  hatch: { L: 3.0, W: 1.7, g: 0.32, h1: 0.62, r: 0.37, wb: 1.95, cl: 1.85, h2: 0.64, cx: -0.28 },
  sedan: { L: 3.6, W: 1.7, g: 0.3, h1: 0.56, r: 0.35, wb: 2.3, cl: 1.7, h2: 0.56, cx: -0.12 },
  wagon: { L: 3.6, W: 1.7, g: 0.32, h1: 0.6, r: 0.36, wb: 2.3, cl: 2.4, h2: 0.58, cx: -0.48 },
  suv: { L: 3.4, W: 1.86, g: 0.46, h1: 0.72, r: 0.45, wb: 2.15, cl: 2.05, h2: 0.66, cx: -0.3 },
  van: { L: 3.6, W: 1.8, g: 0.38, h1: 0.8, r: 0.39, wb: 2.4, cl: 2.85, h2: 0.86, cx: -0.36 },
  sport: { L: 3.4, W: 1.8, g: 0.24, h1: 0.48, r: 0.37, wb: 2.2, cl: 1.4, h2: 0.44, cx: -0.42 },
};

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

function buildCar({ color = '#3b7ddd', body = 'hatch' }) {
  const b = BODIES[body] || BODIES.hatch;
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.28 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#3a4f66', roughness: 0.08, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#242427', roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: '#3b3c40', roughness: 0.6 });
  const hub = new THREE.MeshStandardMaterial({ color: '#dcdde0', roughness: 0.35, metalness: 0.35 });
  const head = new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: '#ffe9a8', emissiveIntensity: 0.55, roughness: 0.2 });
  const tail = new THREE.MeshStandardMaterial({ color: '#e0403a', emissive: '#c42d27', emissiveIntensity: 0.35, roughness: 0.3 });
  const plate = new THREE.MeshStandardMaterial({ color: '#f7c600', roughness: 0.5 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); car.add(m); return m; };
  const rbox = (w, h, d, rad) => new RoundedBoxGeometry(w, h, d, 4, Math.min(rad, w / 2, h / 2, d / 2) * 0.999);

  const top = b.g + b.h1;
  // Onderkant en een bolle cabine in de lakkleur, met losse ruiten erop (speelgoedlook)
  add(rbox(b.L, b.h1, b.W, 0.24), paint, 0, b.g + b.h1 / 2, 0);
  const wc = b.W * 0.82, cy = top + b.h2 / 2 - 0.06;
  add(rbox(b.cl, b.h2, wc, 0.26), paint, b.cx, cy, 0);
  const winH = b.h2 * 0.56, winY = cy + b.h2 * 0.08;
  const pillar = body === 'van' ? 0.3 : 0.04; // plek van de B-stijl
  const frontLen = b.cl / 2 - 0.16 - pillar, rearLen = b.cl / 2 - 0.16 + pillar;
  [-1, 1].forEach((sz) => {
    const z = sz * (wc / 2 + 0.004);
    add(rbox(frontLen - 0.06, winH, 0.03, 0.06), glass, b.cx + pillar + frontLen / 2 + 0.03, winY, z);
    add(rbox(rearLen - 0.06, winH, 0.03, 0.06), glass, b.cx + pillar - rearLen / 2 - 0.03, winY, z);
  });
  add(rbox(0.03, winH, wc * 0.8, 0.06), glass, b.cx + b.cl / 2 + 0.004, winY, 0); // voorruit
  add(rbox(0.03, winH * 0.9, wc * 0.76, 0.06), glass, b.cx - b.cl / 2 - 0.004, winY, 0); // achterruit
  // Wielen
  const tireGeo = new THREE.CylinderGeometry(b.r, b.r, 0.34, 32);
  const hubGeo = new THREE.CylinderGeometry(b.r * 0.52, b.r * 0.52, 0.36, 24);
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
    const x = (sx * b.wb) / 2, z = sz * (b.W / 2 - 0.1);
    add(tireGeo, rubber, x, b.r, z).rotation.x = Math.PI / 2;
    add(hubGeo, hub, x, b.r, z).rotation.x = Math.PI / 2;
  }));
  // Voor en achter
  const front = b.L / 2, lightY = b.g + b.h1 * 0.64;
  [-1, 1].forEach((sz) => {
    add(rbox(0.1, 0.15, 0.3, 0.06), head, front - 0.02, lightY, sz * b.W * 0.31);
    add(rbox(0.1, 0.13, 0.26, 0.05), tail, -front + 0.02, lightY, sz * b.W * 0.33);
    add(rbox(0.22, 0.12, 0.1, 0.04), paint, b.cx + b.cl / 2 - 0.15, top + 0.1, sz * (b.W / 2 + 0.05)); // spiegels
  });
  add(rbox(0.16, 0.17, b.W * 1.01, 0.08), trim, front - 0.04, b.g + 0.1, 0); // bumpers
  add(rbox(0.16, 0.17, b.W * 1.01, 0.08), trim, -front + 0.04, b.g + 0.1, 0);
  add(rbox(0.06, 0.12, b.W * 0.38, 0.03), trim, front + 0.01, b.g + b.h1 * 0.36, 0); // grille
  add(rbox(0.04, 0.13, 0.46, 0.02), plate, -front - 0.03, b.g + b.h1 * 0.4, 0); // geel NL-kenteken
  // Zachte schaduw
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(b.L * 1.45, b.W * 2), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.005;
  car.add(sh);
  car.userData.size = b;
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
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#cfc8bd', 1.9));
  const key = new THREE.DirectionalLight('#ffffff', 2.3); key.position.set(3, 6, 4); scene.add(key);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.7); fill.position.set(-4, 2.5, -3); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);

  let car = buildCar(opts);
  scene.add(car);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let angle = -0.6, vel = 0, dragging = false, lastX = 0, raf = 0, last = 0, visible = true, onScreen = true;

  function frame() {
    const b = car.userData.size;
    const radius = Math.hypot(b.L, b.W) / 2 + 0.25;
    const aspect = camera.aspect;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, aspect * 0.9) * 0.7;
    const target = new THREE.Vector3(0, (b.g + b.h1 + b.h2) * 0.45, 0);
    camera.position.set(0, target.y + dist * 0.42, dist);
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
