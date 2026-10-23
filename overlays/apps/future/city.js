// 時光之城 — a procedural future Taipei that evolves with the year. Every change is driven by a milestone in data/world.json:
// the AI team's median year is where the change is half-way, and the 80% range sets how gradual it is.
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/jsm/controls/OrbitControls.js';
import { EffectComposer } from './vendor/three/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/jsm/postprocessing/OutputPass.js';

export async function initCity(root) {
const $ = s => root.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return localStorage.getItem('fc:' + k); } catch { return null; } }, set(k, v) { try { localStorage.setItem('fc:' + k, v); } catch { } } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const SKIP = new Set(['geo-tw-blockade']);   // sensitive conflict forecasts are not dramatized in the city — see the data page
const DCOL = { ai: '#3987e5', energy: '#d95926', geo: '#199e70', bio: '#c98500', space: '#d55181', tw: '#1faa3a' };

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20261019);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- data ----------
let W, M = {}, YEAR = 2026, Y0 = 2026, Y1 = 2060;
const prog = (id, y = YEAR) => {   // 0..1 how far the milestone has "happened" in the city at year y
  const m = M[id]; if (!m) return 0;
  const s = Math.max(0.6, (Math.min(m.hi, Y1 + 1) - m.lo) / 5);
  return 1 / (1 + Math.exp(-(y - m.median) / s));
};

// ---------- renderer ----------
const canvas = $('#scene');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance', preserveDrawingBuffer: /[?&]test=1/.test(location.search) }); }
catch { $('#loading').hidden = true; $('#nogl').hidden = false; root.dataset.ready = 'fallback'; return; }
const PR = Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.75);
renderer.setPixelRatio(PR);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
camera.position.set(-175, 175, 215);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 12, 0); controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.minDistance = 40; controls.maxDistance = 900; controls.maxPolarAngle = Math.PI * 0.47;
controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.35;

const U = {   // shared uniforms
  uTime: { value: 0 }, uYear: { value: 2026 }, uNight: { value: 1 }, uSolar: { value: 0 }, uDim: { value: 0 },
  uEV: { value: 0.2 }, uRobo: { value: 0 }, uAGI: { value: 0 }, uPR: { value: PR }, uWarm: { value: 0 },
};

// ---------- sky ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() } },
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uTop,uHor,uGlow; varying vec3 vP;
    void main(){ float h = clamp(vP.y,0.,1.); vec3 c = mix(uHor, uTop, pow(h,.45)); c += uGlow*exp(-h*9.)*.9; gl_FragColor = vec4(c,1.); }`,
}));
scene.add(sky);

const starGeo = new THREE.BufferGeometry(); { const p = []; for (let i = 0; i < 1600; i++) { const u = R() * 2 - 1, th = R() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y); p.push(Math.cos(th) * r * 1800, y * 1800, Math.sin(th) * r * 1800); } starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe2ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false }));
scene.add(stars);

// moon with procedural craters; base lights appear on it
function moonTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#d9d6cc'; g.fillRect(0, 0, 256, 256);
  const r = rng(7); for (let i = 0; i < 90; i++) { const x = r() * 256, y = r() * 256, s = 4 + r() ** 3 * 40; g.fillStyle = `rgba(110,105,96,${0.12 + r() * 0.25})`; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill(); }
  return new THREE.CanvasTexture(c);
}
const moonDir = new THREE.Vector3(0.22, 0.13, -0.97).normalize();
const moon = new THREE.Mesh(new THREE.SphereGeometry(46, 32, 16), new THREE.MeshBasicMaterial({ map: moonTex(), color: 0xffffff, fog: false }));
moon.position.copy(moonDir).multiplyScalar(1500); scene.add(moon);
const moonLights = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xfff2c0, size: 3.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
{ const p = [], r = rng(3); for (let i = 0; i < 26; i++) { const a = -0.5 + r() * 0.5, b = -0.3 + r() * 0.4; const v = new THREE.Vector3(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)).multiplyScalar(46.5); p.push(v.x, v.y, v.z); } moonLights.geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); }
moon.add(moonLights); moonLights.lookAt(new THREE.Vector3(0, 0, 0)); moonLights.rotation.y += Math.PI;   // face the city
const mars = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('#ff6a3d'), transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
mars.position.set(-1100, 700, -1100); scene.add(mars);
const station = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('#ffffff'), transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
station.scale.setScalar(26); scene.add(station);

function glowTex(col) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.18, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}

// ---------- terrain, sea, river ----------
const CITY_R = 165;
function noise2(x, z) { return Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2.1) * Math.cos(z * 0.017 + Math.cos(x * 0.011) * 1.7) + 0.5 * Math.sin(x * 0.051 + z * 0.043) + 0.25 * Math.cos(x * 0.11 - z * 0.093); }
const SEA_X = -255;
const riverCurve = new THREE.CatmullRomCurve3([[-330, 0, 40], [-200, 0, 20], [-120, 0, -30], [-40, 0, -70], [40, 0, -60], [110, 0, -10], [190, 0, 60]].map(a => new THREE.Vector3(...a)));
const riverPts = riverCurve.getSpacedPoints(160);
const riverDist = (x, z) => { let m = 1e9; for (const p of riverPts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < m) m = d; } return Math.sqrt(m); };
const nearRiver = (x, z, pad) => riverPts.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < pad * pad);
function height(x, z) {
  const d = Math.hypot(x, z * 1.1);
  const ridge = smooth(CITY_R, CITY_R + 110, d) * (38 + 34 * noise2(x, z)) * smooth(SEA_X + 40, SEA_X + 150, x);
  const coast = x < SEA_X + 30 ? -6 * smooth(SEA_X + 30, SEA_X - 30, x) : 0;
  const rd = riverDist(x, z), valley = smooth(7, 40, rd);
  return Math.max(-8, (ridge + coast + (d < CITY_R ? 0 : 0.6 * noise2(x * 3, z * 3))) * valley - (1 - smooth(5, 9, rd)) * 0.8);
}
const terrGeo = new THREE.PlaneGeometry(1800, 1800, 220, 220); terrGeo.rotateX(-Math.PI / 2);
{ const p = terrGeo.attributes.position, col = []; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), h = height(x, z); p.setY(i, h); const t = Math.min(1, Math.max(0, h / 70)); col.push(0.10 + t * 0.06, 0.16 + t * 0.10, 0.14 + t * 0.05); } terrGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); terrGeo.computeVertexNormals(); }
const terrain = new THREE.Mesh(terrGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
scene.add(terrain);
const waterMat = new THREE.MeshStandardMaterial({ color: 0x16324d, roughness: 0.22, metalness: 0.7, emissive: 0x0a1e33 });
const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), waterMat); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.6; scene.add(sea);
{
  const pos = [], idx = [];
  riverPts.forEach((p, i) => { const t = riverCurve.getTangentAt(i / 160), n = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(6.5); pos.push(p.x + n.x, 0.12, p.z + n.z, p.x - n.x, 0.12, p.z - n.z); if (i) { const a = i * 2; idx.push(a - 2, a - 1, a, a - 1, a + 1, a); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, waterMat));
}

// ---------- special sites ----------
const FUSION = new THREE.Vector3(118, 0, 78), FAB = new THREE.Vector3(-30, 0, 128), TOWER = new THREE.Vector3(18, 0, 14);
const reserved = (x, z) => Math.hypot(x - FUSION.x, z - FUSION.z) < 30 || Math.hypot(x - FAB.x, z - FAB.z) < 34 || Math.hypot(x - TOWER.x, z - TOWER.z) < 12;

// ---------- buildings (one instanced mesh, windows + solar roofs + growth in the shader) ----------
const B = [];
const STEP = 13;
for (let gx = -CITY_R; gx <= CITY_R; gx += STEP) for (let gz = -CITY_R; gz <= CITY_R; gz += STEP) {
  const sub = R() < 0.55 ? 2 : 1, cell = (STEP - 3.5) / sub;
  for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) {
    const x = gx - (STEP - 3.5) / 2 + cell * (a + 0.5), z = gz - (STEP - 3.5) / 2 + cell * (b + 0.5);
    const d = Math.hypot(x, z * 1.1);
    if (d > CITY_R - 4 || nearRiver(x, z, 12) || reserved(x, z) || R() < 0.06) continue;
    const core = Math.exp(-((x - 10) ** 2 + (z - 5) ** 2) / (2 * 62 ** 2));
    let h = 2.5 + R() * 6 + core * (R() ** 1.6) * 34;
    let born = 2000;                                   // exists today
    if (core > 0.25 && R() < 0.22) { h += 12 + R() * 22; born = 2027 + Math.floor(R() ** 0.8 * 30); }   // new towers rise over the decades
    const w = cell * (0.62 + R() * 0.3), dd = cell * (0.62 + R() * 0.3);
    B.push({ x, z, w, d: dd, h, born, seed: R(), solar: R(), dim: R() });
  }
}
const bGeo = new THREE.BoxGeometry(1, 1, 1); bGeo.translate(0, 0.5, 0);
const bMat = new THREE.MeshStandardMaterial({ color: 0x8792a2, roughness: 0.78, metalness: 0.15 });
bMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aBorn; attribute float aSeed; attribute float aSolar; attribute float aDim;
      uniform float uYear; varying vec3 vWP; varying vec3 vON; varying float vSeed; varying float vSolar; varying float vDim; varying float vH;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float grow = clamp((uYear - aBorn) / 1.4, 0., 1.); grow = grow*grow*(3.-2.*grow); transformed.y *= max(grow, 0.0001);`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wp4 = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4; vH = instanceMatrix[1][1];
      #endif
      vWP = (modelMatrix * wp4).xyz; vON = normal; vSeed = aSeed; vSolar = aSolar; vDim = aDim;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uNight; uniform float uSolar; uniform float uDim; uniform float uTime; uniform float uAGI;
      varying vec3 vWP; varying vec3 vON; varying float vSeed; varying float vSolar; varying float vDim; varying float vH;
      float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (abs(vON.y) < 0.5) {
        float u = abs(vON.x) > 0.5 ? vWP.z : vWP.x;
        vec2 cell = vec2(u * 0.95, vWP.y * 1.05);
        vec2 f = fract(cell), id = floor(cell);
        float win = step(.18,f.x)*step(f.x,.82)*step(.22,f.y)*step(f.y,.78);
        float r = hsh(id + vSeed * 91.7);
        float ratio = (0.12 + 0.30 * hsh(vec2(vSeed, 3.))) * step(.12, hsh(vec2(vSeed, 9.))) * (vDim < uDim ? 0.12 : 1.0);
        float lit = step(r, ratio);
        vec3 wc = mix(vec3(1.0,.74,.42), vec3(.62,.82,1.0), step(.62, hsh(id + 7.3)));
        float aa = clamp(max(fwidth(cell.x), fwidth(cell.y)) * 1.6 - .35, 0., 1.);
        float e = mix(win * lit, ratio * .36, aa);
        totalEmissiveRadiance += wc * e * 1.5 * uNight;
        float shop = step(vWP.y, .9) * step(.1, vWP.y);
        totalEmissiveRadiance += vec3(1.,.8,.55) * shop * .5 * uNight * (vDim < uDim ? .2 : 1.);
        diffuseColor.rgb *= mix(1., .45, win) * mix(1., .55, uNight);
      } else if (vON.y > 0.5) {
        if (vSolar < uSolar) {
          vec2 g = fract(vWP.xz * 1.6);
          float line = step(.9, g.x) + step(.9, g.y);
          diffuseColor.rgb = mix(vec3(.05,.12,.28), vec3(.5,.6,.7), clamp(line,0.,1.));
          totalEmissiveRadiance += vec3(.05,.22,.55) * .45 * uNight * (1. - clamp(line,0.,1.));
        }
        float crown = step(30., vH) * uAGI;
        totalEmissiveRadiance += vec3(.55,.35,1.) * crown * (.6 + .4 * sin(uTime * 2. + vSeed * 30.)) * uNight;
      }`);
};
const bMesh = new THREE.InstancedMesh(bGeo, bMat, B.length);
{
  const m = new THREE.Matrix4(), born = [], seed = [], solar = [], dim = [];
  B.forEach((b, i) => { m.makeScale(b.w, b.h, b.d); m.setPosition(b.x, 0, b.z); bMesh.setMatrixAt(i, m); born.push(b.born); seed.push(b.seed); solar.push(b.solar); dim.push(b.dim); });
  bGeo.setAttribute('aBorn', new THREE.InstancedBufferAttribute(new Float32Array(born), 1));
  bGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
  bGeo.setAttribute('aSolar', new THREE.InstancedBufferAttribute(new Float32Array(solar), 1));
  bGeo.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(dim), 1));
}
bMesh.frustumCulled = false; scene.add(bMesh);

// landmark tower (101-like): stacked flaring segments with an era-coloured light
const towerMat = new THREE.MeshStandardMaterial({ color: 0x5f8f86, roughness: 0.35, metalness: 0.6, emissive: 0xffc46b, emissiveIntensity: 0.6 });
const tower = new THREE.Group(); tower.position.copy(TOWER);
{
  const base = new THREE.Mesh(new THREE.BoxGeometry(9, 14, 9), towerMat); base.position.y = 7; tower.add(base);
  for (let i = 0; i < 8; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 3.6, 4.6, 4, 1), towerMat); s.rotation.y = Math.PI / 4; s.position.y = 16.3 + i * 4.6; tower.add(s); }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 4, 4), towerMat); top.rotation.y = Math.PI / 4; top.position.y = 55; tower.add(top);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.45, 9, 6), towerMat); spire.position.y = 61.5; tower.add(spire);
}
scene.add(tower);

// ---------- streets: glowing grid + traffic ----------
const roads = [];
for (let g = -CITY_R + STEP / 2; g < CITY_R; g += STEP) {
  const span = Math.sqrt(Math.max(0, CITY_R ** 2 - g ** 2)) - 4;
  if (span > 20) { roads.push([new THREE.Vector3(-span, 0.25, g), new THREE.Vector3(span, 0.25, g)]); roads.push([new THREE.Vector3(g, 0.25, -span / 1.1), new THREE.Vector3(g, 0.25, span / 1.1)]); }
}
{
  const p = []; roads.forEach(([a, b]) => p.push(a.x, a.y, a.z, b.x, b.y, b.z));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9a6a30, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })));
}
function flowPoints(perRoad, opts) {
  const st = [], dir = [], len = [], spd = [], off = [], kind = [], pos = [];
  roads.forEach(([a, b]) => {
    const L = a.distanceTo(b), dv = b.clone().sub(a).normalize(), side = new THREE.Vector3(-dv.z, 0, dv.x);
    const n = Math.round(perRoad * L / 200);
    for (let i = 0; i < n; i++) {
      const back = R() < 0.5, s = (back ? b : a).clone().add(side.clone().multiplyScalar(back ? -0.8 : 0.8));
      const d = back ? dv.clone().negate() : dv;
      st.push(s.x, s.y + 0.3, s.z); dir.push(d.x, 0, d.z); len.push(L); spd.push(opts.speed * (0.6 + R() * 0.8)); off.push(R() * L); kind.push(R()); pos.push(0, 0, 0);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aStart', new THREE.Float32BufferAttribute(st, 3)); g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1)); g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(spd, 1));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 1)); g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uEV, uRobo, uAGI, uPR, uNight; attribute vec3 aStart, aDir; attribute float aLen, aSpeed, aOff, aKind; varying vec3 vC; varying float vA;
      void main(){
        float t = mod(aOff + uTime * aSpeed, aLen);
        vec3 p = aStart + aDir * t;
        ${opts.agi ? `vC = vec3(.62,.42,1.); vA = uAGI * (.5 + .5 * sin(uTime * 3. + aKind * 40.));` :
        `vC = aKind < uRobo * .35 ? vec3(.25,1.,.95) : (aKind < uEV ? vec3(.8,.9,1.) : vec3(1.,.62,.28)); vA = .55 + .45 * uNight;`}
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = ${opts.size.toFixed(1)} * uPR * 260. / -mv.z;
      }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d) * vA; gl_FragColor = vec4(vC * a * 2.6, a); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; return pts;
}
const traffic = flowPoints(mobile ? 26 : 40, { speed: 9, size: 3.6 }); scene.add(traffic);
const pulses = flowPoints(5, { speed: 60, size: 4.2, agi: true }); scene.add(pulses);

// aviation lights on tall roofs
{
  const p = [], ph = []; B.filter(b => b.h > 26).forEach(b => { p.push(b.x, b.h + 0.6, b.z); ph.push(b.born, b.seed); });
  p.push(TOWER.x, 66.5, TOWER.z); ph.push(2000, 0.3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 2));
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uYear, uPR; attribute vec2 aPh; varying float vA; void main(){ vA = step(aPh.x + 1.2, uYear) * step(.5, fract(uTime * .5 + aPh.y)); vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = 3.2 * uPR * 260. / -mv.z; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(1.,.15,.1) * smoothstep(.5,0.,d) * vA * 2., 1.); }`,
  })));
}

// ---------- wind turbines (offshore farm + ridges) ----------
const TURB = [];
for (let i = 0; i < 9; i++) for (let j = 0; j < 7; j++) TURB.push({ x: SEA_X - 70 - i * 26 + (j % 2) * 13, y: -0.6, z: -150 + j * 48 + R() * 6, rank: R(), sea: true });
for (let i = 0; i < 40 && TURB.length < 110; i++) { const a = R() * Math.PI * 2, d = CITY_R + 70 + R() * 40, x = Math.cos(a) * d, z = Math.sin(a) * d / 1.1; if (x < SEA_X + 60) continue; TURB.push({ x, y: height(x, z) - 0.5, z, rank: R(), sea: false }); }
const tGeoT = new THREE.CylinderGeometry(0.35, 0.6, 18, 6); tGeoT.translate(0, 9, 0);
const bladeGeo = new THREE.BufferGeometry(); {
  const parts = []; for (let k = 0; k < 3; k++) { const b = new THREE.BoxGeometry(0.5, 9, 0.12); b.translate(0, 4.6, 0); b.rotateZ(k * Math.PI * 2 / 3); parts.push(b); }
  const pos = [], idx = []; let o = 0; parts.forEach(g => { const p = g.attributes.position.array; pos.push(...p); g.index.array.forEach(i => idx.push(i + o)); o += g.attributes.position.count; });
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bladeGeo.setIndex(idx); bladeGeo.computeVertexNormals();
}
const tMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.5, emissive: 0x223344, emissiveIntensity: 0.4 });
const towers = new THREE.InstancedMesh(tGeoT, tMat, TURB.length), rotors = new THREE.InstancedMesh(bladeGeo, tMat, TURB.length);
towers.frustumCulled = rotors.frustumCulled = false; scene.add(towers, rotors);
const turbLights = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(TURB.flatMap(t => [t.x, t.y + 18.6, t.z]), 3)),
  new THREE.PointsMaterial({ color: 0xff3020, size: 3, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(turbLights);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
function placeTurbines(share, t) {
  let lit = [];
  TURB.forEach((tb, i) => {
    const on = tb.rank < share; const s = on ? 1 : 0.0001;
    tmpS.set(s, s, s); tmpP.set(tb.x, tb.y, tb.z); tmpQ.identity(); tmpM.compose(tmpP, tmpQ, tmpS); towers.setMatrixAt(i, tmpM);
    tmpE.set(0, Math.atan2(-tb.x, -tb.z) * 0 + 1.1, t * 1.4 + i); tmpQ.setFromEuler(tmpE); tmpP.set(tb.x, tb.y + 18, tb.z); tmpM.compose(tmpP, tmpQ, tmpS); rotors.setMatrixAt(i, tmpM);
    if (on) lit.push(i);
  });
  towers.instanceMatrix.needsUpdate = rotors.instanceMatrix.needsUpdate = true;
  turbLights.material.opacity = Math.sin(t * 2.2) > 0.2 ? 1 : 0.05;
  turbLights.geometry.setDrawRange(0, lit.length);
  turbLights.visible = share > 0.02;
  return lit.length;
}
// hide unbuilt turbines' lights: sort by rank so the draw range = built ones
TURB.sort((a, b) => a.rank - b.rank);
turbLights.geometry.setAttribute('position', new THREE.Float32BufferAttribute(TURB.flatMap(t => [t.x, t.y + 18.6, t.z]), 3));

// ---------- fusion plant ----------
const fusion = new THREE.Group(); fusion.position.copy(FUSION);
const hall = new THREE.Mesh(new THREE.CylinderGeometry(15, 16, 8, 32), new THREE.MeshStandardMaterial({ color: 0x9aa6b5, roughness: 0.5, metalness: 0.4 })); hall.position.y = 3.5; fusion.add(hall);
const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x7be8ff, emissiveIntensity: 0 });
const ring = new THREE.Mesh(new THREE.TorusGeometry(12, 2, 16, 64), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 8.5; fusion.add(ring);
const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('#9ff3ff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); core.position.y = 9; core.scale.setScalar(0.01); fusion.add(core);
scene.add(fusion);
const powerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(FUSION.clone().setY(9), new THREE.Vector3(70, 45, 50), TOWER.clone().setY(40)).getPoints(40)),
  new THREE.LineBasicMaterial({ color: 0x7be8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(powerLine);

// ---------- science park (fabs) ----------
const fab = new THREE.Group(); fab.position.copy(FAB);
const fabMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.45, emissive: 0x3cf0c0, emissiveIntensity: 0.05 });
for (let i = 0; i < 6; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(14, 5 + (i % 3), 7), fabMat); f.position.set(-16 + (i % 3) * 16, 2.5, -8 + Math.floor(i / 3) * 14); fab.add(f); }
scene.add(fab);

// ---------- rockets ----------
const rockets = Array.from({ length: 3 }, () => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(60 * 3), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  line.frustumCulled = false; scene.add(line); return { line, t: -1, x: 0, z: 0, drift: 0 };
});
let nextLaunch = 4;
function updateRockets(dt, rate) {
  nextLaunch -= dt * rate;
  if (rate > 0 && nextLaunch < 0) { const r = rockets.find(k => k.t < 0); if (r) { r.t = 0; r.x = 260 + R() * 120; r.z = -260 + R() * 160; r.drift = -0.3 - R() * 0.5; } nextLaunch = 6 + R() * 6; }
  rockets.forEach(r => {
    if (r.t < 0) { r.line.material.opacity = 0; return; }
    r.t += dt; const p = r.line.geometry.attributes.position.array;
    for (let i = 0; i < 60; i++) { const tt = Math.max(0, r.t - i * 0.05), y = 10 + 6 * tt * tt * 3; p[i * 3] = r.x + r.drift * y * 0.5; p[i * 3 + 1] = y; p[i * 3 + 2] = r.z; }
    r.line.geometry.attributes.position.needsUpdate = true;
    r.line.material.opacity = Math.max(0, 1 - r.t / 9); if (r.t > 9) r.t = -1;
  });
}

// ---------- light ----------
const hemi = new THREE.HemisphereLight(0x9fb8ff, 0x1a1410, 0.4); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(-300, 400, 200); scene.add(sun);
scene.fog = new THREE.FogExp2(0x0a1020, 0.0016);

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), mobile ? 0.7 : 0.8, 0.5, 0.72);
composer.addPass(bloom); composer.addPass(new OutputPass());

// ---------- time of day ----------
const MODES = {
  night: { night: 1, top: '#020611', hor: '#0c1a33', glow: '#1a2c55', hemi: 0.35, sun: 0.18, sunCol: '#9db4ff', fog: '#0b1426', fogD: 0.0017, exp: 1.0, stars: 0.85, bloom: 1 },
  dusk: { night: 0.75, top: '#1b2350', hor: '#d97a52', glow: '#ff9a5a', hemi: 0.55, sun: 0.8, sunCol: '#ffb27a', fog: '#6b4a5a', fogD: 0.0014, exp: 1.0, stars: 0.25, bloom: 0.8 },
  day: { night: 0.04, top: '#2f6fd0', hor: '#a9cdf0', glow: '#ffffff', hemi: 1.0, sun: 2.4, sunCol: '#fff4e0', fog: '#a9c6e6', fogD: 0.0007, exp: 0.95, stars: 0, bloom: 0.25 },
};
let mode = store.get('mode') || 'night';
const cA = new THREE.Color(), cB = new THREE.Color();
function applyMode() {
  const m = MODES[mode];
  const warm = U.uWarm.value;   // later years: warmer, hazier horizon (1.5 °C milestone)
  sky.material.uniforms.uTop.value.set(m.top);
  sky.material.uniforms.uHor.value.set(m.hor).lerp(cA.set('#c2703a'), warm * (mode === 'day' ? 0.22 : 0.16));
  sky.material.uniforms.uGlow.value.set(m.glow);
  scene.fog.color.set(m.fog).lerp(cB.set('#a0603a'), warm * 0.07); scene.fog.density = m.fogD * (1 + warm * 0.25);
  hemi.intensity = m.hemi; sun.intensity = m.sun; sun.color.set(m.sunCol);
  U.uNight.value = m.night; stars.material.opacity = m.stars; bloom.strength = (mobile ? 0.7 : 0.8) * m.bloom;
  renderer.toneMappingExposure = m.exp;
  root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}

// ---------- year → city ----------
const stat = {};
function setYear(y, fromUser) {
  const prev = YEAR; YEAR = Math.max(Y0, Math.min(Y1, y)); U.uYear.value = YEAR;
  const ev = Math.max(0.2, prog('energy-ev-half')), renew = Math.max(0.1, 0.5 * prog('energy-renewables-half') + 0.5 * prog('tw-re30'));
  U.uEV.value = ev; U.uRobo.value = prog('ai-robotaxi-tw'); U.uAGI.value = prog('ai-agi');
  U.uSolar.value = renew * 0.85; U.uWarm.value = prog('energy-1p5c');
  U.uDim.value = 0.3 * Math.max(prog('tw-pop20m'), prog('geo-tw-pop20m'));
  stat.turbines = Math.round(TURB.length * renew);
  const fus = prog('energy-fusion-grid'); ringMat.emissiveIntensity = fus * 3.2; core.scale.setScalar(0.01 + fus * 34); powerLine.material.opacity = fus * 0.9;
  const fabLevel = (prog('tw-cpo') + prog('tw-a14') + prog('tw-1nm')) / 3; fabMat.emissiveIntensity = 0.05 + fabLevel * 0.9;
  towerMat.emissive.set('#ffc46b').lerp(cA.set('#8f6bff'), U.uAGI.value); towerMat.emissiveIntensity = 0.5 + 0.5 * U.uAGI.value;
  const base = prog('space-moon-base'), ret = Math.max(prog('space-moon-return'), prog('space-china-moon'));
  moonLights.material.opacity = Math.min(1, base * 1.2 + ret * 0.25); moonLights.geometry.setDrawRange(0, Math.max(ret > 0.5 ? 2 : 0, Math.round(26 * base)));
  const ms = prog('space-mars-crew'); mars.scale.setScalar(40 + ms * 110); mars.material.opacity = 0.55 + ms * 0.45;
  station.visible = prog('space-private-station') > 0.5;
  stat.launch = 0.15 * ret + 0.35 * base + 0.3 * prog('space-asteroid-mining') + 0.2 * ms;
  applyMode(); updateHud(prev, fromUser);
}

// ---------- HUD ----------
const EVENTS = [];
const pct = v => v > 0.95 ? '>95%' : Math.round(v * 100) + '%';
function updateHud(prev, fromUser) {
  $('#year').textContent = YEAR >= Y1 ? `${Y1}` : Math.floor(YEAR);
  $('#slider').value = YEAR;
  $('#stats').innerHTML = [
    ['電動車', pct(U.uEV.value)], ['太陽能屋頂', pct(U.uSolar.value)], ['風機', stat.turbines + ' 座'],
    ['無人車', U.uRobo.value > 0.12 ? Math.round(U.uRobo.value * 35) + '%' : '—'], ['月球基地', prog('space-moon-base') > 0.5 ? '有人駐守' : '—'],
  ].map(([k, v]) => `<span><b>${v}</b>${k}</span>`).join('');
  const crossed = EVENTS.filter(e => e.m.median > Math.min(prev, YEAR) && e.m.median <= Math.max(prev, YEAR));
  if (YEAR > prev) crossed.forEach(e => toast(e.m));
  root.querySelectorAll('.tick').forEach(t => t.classList.toggle('past', +t.dataset.y <= YEAR));
}
let toastN = 0;
function toast(m) {
  const box = $('#toasts'), el = document.createElement('button');
  el.type = 'button'; el.className = 'toast'; el.style.setProperty('--c', DCOL[m.domain]);
  el.innerHTML = `<span class="ty">${m.median}</span><span class="tt">${esc(m.title)}</span><span class="tm">AI 小隊預測・${m.lo}–${m.hi > Y1 ? Y1 + '+' : m.hi}</span>`;
  el.addEventListener('click', () => openCard(m));
  box.prepend(el); while (box.children.length > (mobile ? 2 : 4)) box.lastChild.remove();
  setTimeout(() => el.classList.add('fade'), 7000); setTimeout(() => el.remove(), 8200);
  chime(m.domain); toastN++;
}
function openCard(m) {
  stopJourney();
  const d = W.domains.find(x => x.id === m.domain);
  $('#cardBody').innerHTML = `<span class="ck" style="--c:${DCOL[m.domain]}"><i></i>${esc(d?.name)}</span><h2 id="cardTitle">${esc(m.title)}</h2>
    <div class="cy"><b>${m.median}</b><span>80% 區間 ${m.lo}–${m.hi > Y1 ? Y1 + ' 之後' : m.hi}</span></div>
    <p>${esc(m.desc)}</p><h3>在城市裡</h3><p>${esc(VIS[m.id] || '這件事在城市畫面上沒有直接呈現，會出現在年份提示裡。')}</p>
    <h3>對台灣人的影響</h3><p>${esc(m.impact)}</p><h3>年份怎麼來的</h3><p>${esc(m.basis)}</p>
    <p class="more"><a href="data.html#${encodeURIComponent(m.id)}">看完整依據、來源與每日變化 →</a></p>`;
  $('#card').hidden = false; $('#cardClose').focus();
}
const VIS = {
  'ai-robotaxi-tw': '街上開始出現青綠色的無人計程車車燈，比例逐年增加。', 'ai-agi': '摩天樓頂亮起紫色的光，紫色的資料脈衝在街道間奔流，地標塔轉為紫光。',
  'energy-ev-half': '車流的燈色從燃油車的橘色，漸漸變成電動車的冷白色。', 'energy-renewables-half': '屋頂一片片換成太陽能板，海上與山稜的風機越來越多。',
  'tw-re30': '屋頂一片片換成太陽能板，海上與山稜的風機越來越多。', 'energy-fusion-grid': '東邊的核融合電廠點亮青色光環，能量沿著電纜送進市中心。',
  'energy-1p5c': '天際線的霧氣與夕色逐漸偏暖。', 'tw-cpo': '南邊的科學園區亮起青綠光，每個新製程都更亮一些。', 'tw-a14': '南邊的科學園區亮起青綠光，每個新製程都更亮一些。',
  'tw-1nm': '南邊的科學園區亮起青綠光，每個新製程都更亮一些。', 'tw-pop20m': '人口減少，夜裡亮燈的窗戶變少了。', 'geo-tw-pop20m': '人口減少，夜裡亮燈的窗戶變少了。',
  'space-moon-return': '月球上出現第一個亮點。', 'space-china-moon': '月球上出現第一個亮點。', 'space-moon-base': '月面亮起一整片基地燈光，火箭發射越來越頻繁。',
  'space-private-station': '夜空中有一顆移動的亮點：商業太空站。', 'space-mars-crew': '火星變得更亮、更紅，像在提醒有人在那裡。', 'space-asteroid-mining': '火箭發射更加頻繁。',
};

// ---------- audio (optional) ----------
let AC = null, master = null;
function audioOn() {
  if (AC) { AC.resume(); master.gain.setTargetAtTime(0.5, AC.currentTime, 0.4); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
  master.gain.setTargetAtTime(0.5, AC.currentTime, 1.2);
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(master);
  [110, 164.8, 220.5, 329.6].forEach((f, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (i - 1.5) * 6; g.gain.value = 0.05; o.connect(g); g.connect(lp); o.start();
    const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = 0.05 + i * 0.03; lg.gain.value = 0.03; l.connect(lg); lg.connect(g.gain); l.start(); });
}
function audioOff() { if (AC) master.gain.setTargetAtTime(0, AC.currentTime, 0.3); }
const SCALE = { ai: 659.3, energy: 587.3, geo: 493.9, bio: 784, space: 880, tw: 523.3 };
function chime(dom) {
  if (!AC || master.gain.value < 0.05) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = SCALE[dom] || 660;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.5);
}

// ---------- journey (cinematic) ----------
const path = new THREE.CatmullRomCurve3([[-260, 140, 300], [-120, 60, 170], [20, 34, 110], [120, 46, 10], [150, 60, -150], [10, 70, -230], [-170, 90, -120], [-230, 110, 120], [-60, 170, 300]].map(a => new THREE.Vector3(...a)), true);
let journey = null;
function startJourney() {
  if (YEAR >= Y1 - 0.1) setYear(Y0);
  journey = { t0: performance.now(), y0: YEAR, dur: 64000 * (Y1 - YEAR) / (Y1 - Y0) };
  controls.autoRotate = false; $('#play').setAttribute('aria-pressed', 'true'); $('#play').textContent = '❚❚ 暫停';
  root.classList.add('journey');
}
function stopJourney() {
  if (!journey) return; journey = null; controls.autoRotate = !reduced;
  $('#play').setAttribute('aria-pressed', 'false'); $('#play').textContent = '▶ 時光旅行'; root.classList.remove('journey');
}
const look = new THREE.Vector3();

// ---------- labels ----------
const LABELS = [
  { el: null, text: '地標塔', p: TOWER.clone().setY(70), show: () => true },
  { el: null, text: '核融合電廠', p: FUSION.clone().setY(20), show: () => prog('energy-fusion-grid') > 0.3 },
  { el: null, text: '科學園區', p: FAB.clone().setY(14), show: () => true },
  { el: null, text: '離岸風場', p: new THREE.Vector3(SEA_X - 170, 26, -10), show: () => stat.turbines > 8 },
];
LABELS.forEach(l => { l.el = document.createElement('span'); l.el.className = 'label'; l.el.textContent = l.text; $('#labels').appendChild(l.el); });
const v3 = new THREE.Vector3();
function placeLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  LABELS.forEach(l => { v3.copy(l.p).project(camera); const vis = l.show() && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
    l.el.style.opacity = vis ? 1 : 0; if (vis) l.el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px,${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%,-100%)`; });
}

// ---------- loop ----------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h; camera.fov = w < h ? 62 : 50; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
new ResizeObserver(() => {
  root.style.setProperty('--city-hud-height', `${$('.hud-bottom').offsetHeight}px`);
}).observe($('.hud-bottom'));
let active = !root.hidden && !document.hidden, animation = null;
const clock = new THREE.Clock(); let frames = 0, slowT = 0, lowQ = false;
function frame() {
  animation = null;
  if (!active) return;
  const dt = Math.min(0.05, clock.getDelta()); U.uTime.value += dt;
  if (journey) {
    const k = Math.min(1, (performance.now() - journey.t0) / journey.dur);
    setYear(journey.y0 + (Y1 - journey.y0) * k);
    const u = ((performance.now() - journey.t0) / 64000) % 1;
    camera.position.copy(path.getPointAt(u)); look.lerp(new THREE.Vector3(Math.sin(u * 6.28) * 30, 14, Math.cos(u * 6.28) * 20), 0.05); camera.lookAt(look); controls.target.copy(look);
    if (k >= 1) stopJourney();
  } else controls.update();
  placeTurbines(stat.turbines / TURB.length, U.uTime.value);
  updateRockets(dt, stat.launch || 0);
  const a = U.uTime.value * 0.02; station.position.set(Math.cos(a) * 1300, 600 + Math.sin(a * 2) * 120, Math.sin(a) * 1300);
  placeLabels();
  (lowQ ? renderer.render(scene, camera) : composer.render());
  frames++; slowT += dt;
  if (slowT > 4) { if (frames / slowT < 24 && !lowQ) { lowQ = true; renderer.setPixelRatio(1); resize(); } frames = 0; slowT = 0; }   // auto quality
  window.__fc = { year: YEAR, frames: (window.__fc?.frames || 0) + 1, toasts: toastN, lowQ };
  animation = requestAnimationFrame(frame);
}

// ---------- boot ----------
async function boot() {
  try { W = await (await fetch('data/world.json', { cache: 'no-cache' })).json(); }
  catch { $('#loading').textContent = '資料讀取失敗，請重新整理。'; return; }
  [Y0, Y1] = W.span; W.milestones.forEach(m => M[m.id] = m);
  W.milestones.filter(m => !SKIP.has(m.id) && m.status !== 'happened').sort((a, b) => a.median - b.median).forEach(m => EVENTS.push({ m }));
  const sl = $('#slider'); sl.min = Y0; sl.max = Y1; sl.step = 0.05;
  $('#ticks').innerHTML = EVENTS.filter(e => e.m.median <= Y1).map(e => `<span class="tick" aria-hidden="true" data-y="${e.m.median}" data-id="${esc(e.m.id)}" style="left:${(e.m.median - Y0) / (Y1 - Y0) * 100}%;--c:${DCOL[e.m.domain]}" aria-label="${e.m.median} ${esc(e.m.title)}" title="${e.m.median} ${esc(e.m.title)}"></span>`).join('');
  const select = $('#milestone');
  select.innerHTML = '<option value="">探索城市里程碑…</option>' + EVENTS.map(e => `<option value="${esc(e.m.id)}">${e.m.median}・${esc(e.m.title)}</option>`).join('');
  select.addEventListener('change', () => {
    if (select.value) { stopJourney(); setYear(M[select.value].median); openCard(M[select.value]); select.value = ''; }
  });
  sl.addEventListener('input', () => { stopJourney(); setYear(+sl.value, true); });
  $('#play').addEventListener('click', () => journey ? stopJourney() : startJourney());
  root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; store.set('mode', mode); applyMode(); }));
  $('#sound').addEventListener('click', () => { const on = $('#sound').getAttribute('aria-pressed') !== 'true'; $('#sound').setAttribute('aria-pressed', String(on)); $('#sound').textContent = on ? '🔊' : '🔈'; on ? audioOn() : audioOff(); });
  $('#cardClose').addEventListener('click', () => $('#card').hidden = true);
  $('#card').addEventListener('click', e => { if (e.target.id === 'card') $('#card').hidden = true; });
  addEventListener('keydown', e => { if (!active) return; if (e.key === 'Escape') $('#card').hidden = true; if (e.key === ' ' && e.target === document.body) { e.preventDefault(); journey ? stopJourney() : startJourney(); } });
  canvas.addEventListener('pointerdown', () => { if (journey) stopJourney(); });
  $('#skip').addEventListener('click', () => $('#info').hidden = !$('#info').hidden);
  resize(); setYear(Y0); applyMode();
  $('#loading').remove(); root.dataset.ready = '1';
  if (active) animation = requestAnimationFrame(frame);
  const want = new URLSearchParams(location.search).get('year'); if (want) setYear(+want);
}
await boot();
return { setActive(value) {
  active = value;
  if (!active) {
    stopJourney(); audioOff(); AC?.suspend();
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    $('#card').hidden = true;
    $('#info').hidden = true;
  } else {
    resize(); clock.getDelta();
    if (animation === null && root.dataset.ready === '1') animation = requestAnimationFrame(frame);
    if ($('#sound').getAttribute('aria-pressed') === 'true') audioOn();
  }
} };
}
