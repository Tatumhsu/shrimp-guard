// cruise-scene.mjs — 海面／郵輪示意場景（Three.js）
// 日夜：依所選海域經緯度與時刻計算太陽、月亮實際位置與月相（sky-astro.mjs），決定天空、光線、星空、航行燈。
// 動態：浪向、週期、浪高、風速、風向、雲量、降水、能見度全部來自預報列（main.mjs 餵入），
//       波長與波速依深水波色散關係、白浪依風速經驗式、船隻搖晃依浪向相對船首角與遭遇週期（sea-physics.mjs）。
// 尺度：1 單位 = 10 m；浪高垂直放大 4 倍，船隻搖晃為「示意（已放大）」，不是船體運動預測。
// WebGL 不可用時回報 mode:'static'，由 UI 顯示 SVG fallback（其日夜色也由 skyPalette 決定）。
import * as THREE from 'three';
import { sunPosition, moonPosition, twilightStage, relativeAzimuth, siderealDeg } from './sky-astro.mjs';
import { deepWater, encounter, apparentWind, whitecapFraction, initialBearing } from './sea-physics.mjs';

const MAX_DPR = 1.5;
export const SCALE_M_PER_UNIT = 10;
export const WAVE_EXAGGERATION = 4;
export const CAMERA_HEADING_DEG = 180;          // 鏡頭朝南看海；東在左、西在右
export const SHIP_SPEED_MS = 9.3;               // 約 18 節（示意用固定值）
const BEARING_OUT = initialBearing(25.15, 121.75, 26.2, 127.68);   // 基隆→那霸 ≈ 78°
const BEARING_BACK = (BEARING_OUT + 180) % 360;

// ---------- 天空色盤：依太陽折射後高度角插值（RGB） ----------
const PALETTE = [ // [elev, zenith, horizon, sunColor, sunIntensity, ambient]
  [20, 0x2f74c9, 0xb8d5ea, 0xfff4df, 2.6, 0.95],
  [8, 0x3a7ec6, 0xe6c79c, 0xffe0b0, 2.2, 0.85],
  [2, 0x2f5f9e, 0xf5a56a, 0xffb570, 1.5, 0.6],
  [-1, 0x25457c, 0xf07a4e, 0xff8a4a, 0.7, 0.42],
  [-5, 0x172a55, 0xb45a6c, 0xd0607a, 0.15, 0.25],
  [-9, 0x0d1a3a, 0x4a3a6c, 0x000000, 0, 0.14],
  [-14, 0x070f26, 0x1a2342, 0x000000, 0, 0.1],
  [-20, 0x04081a, 0x0b1226, 0x000000, 0, 0.08],
];
const _c = new THREE.Color(), _d = new THREE.Color();
function lerpHex(a, b, t) { return _c.setHex(a).lerp(_d.setHex(b), t).getHex(); }
export function skyPalette(elevDeg) {
  const e = Math.max(PALETTE[PALETTE.length - 1][0], Math.min(PALETTE[0][0], elevDeg));
  for (let i = 0; i < PALETTE.length - 1; i++) {
    const a = PALETTE[i], b = PALETTE[i + 1];
    if (e <= a[0] && e >= b[0]) {
      const t = (a[0] - e) / (a[0] - b[0]);
      return { zenith: lerpHex(a[1], b[1], t), horizon: lerpHex(a[2], b[2], t), sun: lerpHex(a[3], b[3], t), sunIntensity: a[4] + (b[4] - a[4]) * t, ambient: a[5] + (b[5] - a[5]) * t };
    }
  }
  const p = PALETTE[0]; return { zenith: p[1], horizon: p[2], sun: p[3], sunIntensity: p[4], ambient: p[5] };
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// 方位角（自北）→ 世界座標方向；鏡頭朝 CAMERA_HEADING_DEG，前方 = −z，右 = +x
function dirFromAzEl(azDeg, elDeg) {
  const rel = relativeAzimuth(azDeg, CAMERA_HEADING_DEG) * Math.PI / 180, el = elDeg * Math.PI / 180;
  return new THREE.Vector3(Math.sin(rel) * Math.cos(el), Math.sin(el), -Math.cos(rel) * Math.cos(el));
}
const headingToRotY = (hDeg) => Math.PI / 2 - relativeAzimuth(hDeg, CAMERA_HEADING_DEG) * Math.PI / 180;

// ---------- 海面 shader：3 組 Gerstner 波 + 風紋 ----------
const SEA_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec4 uWaveA; uniform vec4 uWaveB; uniform vec4 uWaveC; // dir.x, dir.z, k (2π/L), amp
  uniform vec3 uSpeed;   // 各波相速（單位/秒）
  uniform float uSteep;
  varying vec3 vPos; varying float vCrest; varying vec2 vUv;
  vec3 gerstner(vec4 w, float c, vec3 p, inout float crest) {
    vec2 d = normalize(w.xy); float k = w.z; float a = w.w;
    float f = k * (dot(d, p.xz) - c * uTime);
    float s = sin(f), co = cos(f);
    float q = uSteep / max(k * a * 3.0, 1.0);
    crest += co * 0.5 + 0.5;
    return vec3(d.x * q * a * co, a * s, d.y * q * a * co);
  }
  void main() {
    vec3 p = position; float crest = 0.0;
    vec3 off = gerstner(uWaveA, uSpeed.x, p, crest) + gerstner(uWaveB, uSpeed.y, p, crest) + gerstner(uWaveC, uSpeed.z, p, crest);
    p += off;
    vPos = p; vCrest = crest / 3.0; vUv = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const SEA_FRAG = /* glsl */ `
  uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uHorizon; uniform vec3 uZenith;
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI;
  uniform vec3 uMoonDir; uniform float uMoonI;
  uniform vec3 uCam; uniform float uFoam; uniform float uFog; uniform float uTime; uniform vec2 uWind; uniform float uRipple;
  varying vec3 vPos; varying float vCrest; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    // 風紋：小尺度法線擾動，順風向移動
    vec2 rp = vUv * 6.0 + uWind * uTime * 0.6;
    float r1 = noise(rp) - 0.5, r2 = noise(rp * 2.3 + 7.0) - 0.5;
    n = normalize(n + vec3(r1, 0.0, r2) * uRipple);
    vec3 v = normalize(uCam - vPos);
    float ndv = max(dot(n, v), 0.0);
    float fres = pow(1.0 - ndv, 4.0);
    // 天空反射：依法線反射方向的高度混合地平／天頂色
    vec3 refl = reflect(-v, n);
    vec3 sky = mix(uHorizon, uZenith, clamp(refl.y * 1.6, 0.0, 1.0));
    float depthMix = clamp(vCrest, 0.0, 1.0);
    vec3 water = mix(uDeep, uShallow, depthMix) * (0.3 + 0.9 * clamp(uSunI / 2.2 + uMoonI, 0.08, 1.0));
    vec3 col = mix(water, sky, 0.18 + fres * 0.72);
    // 太陽／月亮高光與閃光帶
    vec3 hv = normalize(uSunDir + v);
    float spec = pow(max(dot(n, hv), 0.0), 120.0);
    float glitter = pow(max(dot(n, hv), 0.0), 600.0) * 2.0;
    col += (spec + glitter) * uSunColor * uSunI * step(0.0, uSunDir.y);
    vec3 mh = normalize(uMoonDir + v);
    float mspec = pow(max(dot(n, mh), 0.0), 160.0) + pow(max(dot(n, mh), 0.0), 700.0) * 1.5;
    col += mspec * vec3(0.75, 0.82, 1.0) * uMoonI * step(0.0, uMoonDir.y);
    // 白浪：波峰 + 風速覆蓋率（Monahan）；夜間跟著亮度變暗
    float fn = noise(vUv * 1.7 + uWind * uTime * 0.15);
    float foam = smoothstep(0.86 - uFoam * 2.5, 1.0, vCrest * 0.75 + fn * 0.35) * clamp(uFoam * 10.0 + 0.15, 0.0, 1.0);
    float bright = clamp(uSunI * 0.4 + uMoonI * 0.6 + 0.12, 0.12, 1.0);
    col = mix(col, vec3(0.9, 0.95, 0.97) * bright, foam * 0.85);
    // 霧／能見度
    float dist = length(vPos.xz - uCam.xz);
    float fog = 1.0 - exp(-dist * uFog);
    col = mix(col, uHorizon, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;
const SKY_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI; uniform float uHaze;
  varying vec3 vDir;
  void main(){
    float y = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(y, 0.55));
    float sd = max(dot(normalize(vDir), uSunDir), 0.0);
    float glow = pow(sd, 10.0) * 0.55 + pow(sd, 60.0) * 0.6;          // 太陽周圍暈光
    float disc = smoothstep(0.9993, 0.9997, sd);                       // 太陽盤（約 1°）
    float nearHorizon = 1.0 - smoothstep(0.0, 0.25, y);
    col += (glow * (0.5 + nearHorizon) + disc * 3.0) * uSunColor * clamp(uSunI, 0.0, 1.0) * step(-0.02, uSunDir.y);
    col = mix(col, uHorizon, uHaze * (1.0 - y) * 0.6);                 // 雲量／霧讓天空灰白
    gl_FragColor = vec4(col, 1.0);
  }
`;

function webglAvailable() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

// ---------- 貼圖：雲（FBM）、月相、光暈 ----------
function fbmTexture(size, seed) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.3) * 43758.5453; return s - Math.floor(s); };
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (rnd(xi, yi) * (1 - u) + rnd(xi + 1, yi) * u) * (1 - v) + (rnd(xi, yi + 1) * (1 - u) + rnd(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 0, f = 4 / size, amp = 0.5; for (let o = 0; o < 5; o++) { a += noise(x * f, y * f) * amp; f *= 2; amp *= 0.5; }
    const v = Math.max(0, Math.min(1, (a - 0.42) * 2.4));
    const edge = Math.min(1, Math.min(x, y, size - 1 - x, size - 1 - y) / (size * 0.18));
    const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(v * edge * 255);
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glowTexture(size, inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); gr.addColorStop(0, inner); gr.addColorStop(0.35, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size); return new THREE.CanvasTexture(c);
}
function moonTexture(size) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.draw = (illumination, waxing) => {
    g.clearRect(0, 0, size, size); const r = size * 0.42, cx = size / 2, cy = size / 2;
    g.fillStyle = '#f6f3ea'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(190,186,176,.35)'; for (const [mx, my, mr] of [[-0.3, -0.25, 0.22], [0.15, 0.1, 0.3], [-0.1, 0.45, 0.14]]) { g.beginPath(); g.arc(cx + mx * r, cy + my * r, mr * r, 0, Math.PI * 2); g.fill(); }
    // 明暗界線：以半徑 r 的圓與半寬 r·|cos| 的橢圓組合畫出暗面（北半球視角：盈月亮右側）
    const k = Math.cos(illumination * Math.PI); // 1 = 全暗（朔）… -1 = 全亮（望）
    g.fillStyle = 'rgba(8,10,20,.96)'; g.beginPath();
    const litRight = waxing;
    g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, litRight);           // 暗的那一側半圓
    g.ellipse(cx, cy, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) !== litRight);
    g.closePath(); g.fill();
    tex.needsUpdate = true;
  };
  return tex;
}

// ---------- 船 ----------
function buildShip() {
  const ship = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f7f9, roughness: 0.55, metalness: 0.05 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x163a5c, roughness: 0.25, metalness: 0.3, emissive: 0xffc46a, emissiveIntensity: 0 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x0b2a4a, roughness: 0.6 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe88a3a, roughness: 0.6 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x3fc9d0, roughness: 0.3, emissive: 0x3fc9d0, emissiveIntensity: 0 });
  const L = 10, W = 2.5;
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, -W / 2); shape.lineTo(L / 2 - 2.8, -W / 2); shape.quadraticCurveTo(L / 2 - 0.5, -W * 0.32, L / 2, 0);
  shape.quadraticCurveTo(L / 2 - 0.5, W * 0.32, L / 2 - 2.8, W / 2); shape.lineTo(-L / 2, W / 2); shape.quadraticCurveTo(-L / 2 - 0.55, 0, -L / 2, -W / 2);
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.15, bevelEnabled: false }), white); hull.geometry.rotateX(-Math.PI / 2); hull.position.y = 0.05; ship.add(hull);
  const band = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: false }), navy); band.geometry.rotateX(-Math.PI / 2); band.scale.set(1.012, 1, 1.03); band.position.y = -0.2; ship.add(band);
  const hullGlass = new THREE.Mesh(new THREE.BoxGeometry(L - 2.6, 0.16, W + 0.02), glass); hullGlass.position.set(-0.9, 0.75, 0); ship.add(hullGlass);
  const decks = [{ len: 7.4, wid: 2.2, h: 0.62, x: -0.8 }, { len: 6.2, wid: 2.0, h: 0.58, x: -1.0 }, { len: 4.6, wid: 1.7, h: 0.52, x: -1.3 }];
  let y = 1.2;
  for (const d of decks) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(d.len, d.h, d.wid), white); deck.position.set(d.x, y + d.h / 2, 0); ship.add(deck);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(d.len - 0.5, d.h * 0.42, d.wid + 0.03), glass); strip.position.set(d.x, y + d.h / 2, 0); ship.add(strip);
    y += d.h;
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.75), white); bridge.position.set(1.4, y + 0.22, 0); ship.add(bridge);
  const bridgeGlass = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.2, 1.78), glass); bridgeGlass.position.set(1.42, y + 0.25, 0); ship.add(bridgeGlass);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.9, 20), white); funnel.position.set(-2.4, y + 0.45, 0); ship.add(funnel);
  const funnelTop = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 20), navy); funnelTop.position.set(-2.4, y + 0.92, 0); ship.add(funnelTop);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 8), white); mast.position.set(0.6, y + 0.9, 0); ship.add(mast);
  const radar = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), white); radar.position.set(-0.6, y + 0.35, 0); ship.add(radar);
  const pool = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.6), teal); pool.position.set(-3.3, 1.24, 0); ship.add(pool);
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) { const boat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.16), orange); boat.position.set(-3.4 + i * 0.95, 1.25, side * 1.2); ship.add(boat); }
  // 航行燈（COLREGs 配置）：桅頂白燈、船尾白燈、右舷綠、左舷紅；船首 +x、右舷 +z
  const glow = glowTexture(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  const lamp = (color, x, yy, z, size) => { const m = new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); const s = new THREE.Sprite(m); s.position.set(x, yy, z); s.scale.setScalar(size); ship.add(s); return m; };
  const navLights = [lamp(0xffffff, 0.6, y + 1.5, 0, 0.5), lamp(0xffffff, -4.9, 1.3, 0, 0.4), lamp(0x33ff55, 1.2, 1.3, 1.1, 0.45), lamp(0xff3333, 1.2, 1.3, -1.1, 0.45)];
  return { ship, glass, teal, navLights, funnelTop: new THREE.Vector3(-2.4, y + 1.0, 0) };
}

const EMPTY = { mode: 'static', setConditions() {}, setDirection() {}, setPaused() {}, isAnimating: () => false, snapshot: () => null, destroy() {} };

/** 由條件算出畫面要用的所有參數（純計算，方便測試） */
export function deriveVisual(c) {
  const lat = c.lat ?? 25.5, lon = c.lon ?? 124, t = c.epochSec ?? Math.floor(Date.now() / 1000);
  const sun = sunPosition(t, lat, lon), moon = moonPosition(t, lat, lon);
  const pal = skyPalette(sun.elevationDeg);
  const stage = twilightStage(sun.elevationDeg);
  const heading = c.direction === 'back' ? BEARING_BACK : BEARING_OUT;
  const H = Number.isFinite(c.waveHeight) ? c.waveHeight : null, T = Number.isFinite(c.wavePeriod) ? c.wavePeriod : null;
  const wf = Number.isFinite(c.waveFrom) ? c.waveFrom : null;
  const wind = Number.isFinite(c.windMs) ? c.windMs : null, windFrom = Number.isFinite(c.windFrom) ? c.windFrom : null;
  const cloud = Number.isFinite(c.cloud) ? c.cloud / 100 : 0.2, precip = Number.isFinite(c.precip) ? c.precip : 0;
  const vis = Number.isFinite(c.visibility) ? c.visibility : 24000;
  const Hs = H ?? 0.8, Ts = T ?? 6, wfs = wf ?? 60, ws = wind ?? 4, wfr = windFrom ?? 60;
  const swell = deepWater(Ts);
  const enc = encounter(Ts, wfs, heading, SHIP_SPEED_MS);
  const aw = apparentWind(ws, wfr, heading, SHIP_SPEED_MS);
  // 風浪（短週期）：週期隨風速成長的粗略關係；高度 ∝ 風速²（示意，非 fetch 限制模型）
  const Tw = Math.max(1.8, Math.min(6.5, 1.3 + ws * 0.32)), windSea = deepWater(Tw), Hw = Math.min(1.2, 0.0085 * ws * ws);
  const amp = (h) => (h / 2) / SCALE_M_PER_UNIT * WAVE_EXAGGERATION;
  const waves = [
    { fromDeg: wfs, wavelengthU: swell.wavelengthM / SCALE_M_PER_UNIT, ampU: Math.min(1.2, amp(Hs)), speedU: swell.phaseSpeedMs / SCALE_M_PER_UNIT, periodS: Ts },
    { fromDeg: (wfs + 23) % 360, wavelengthU: swell.wavelengthM * 0.62 / SCALE_M_PER_UNIT, ampU: Math.min(0.6, amp(Hs) * 0.35), speedU: deepWater(Ts * 0.79).phaseSpeedMs / SCALE_M_PER_UNIT, periodS: Ts * 0.79 },
    { fromDeg: wfr, wavelengthU: windSea.wavelengthM / SCALE_M_PER_UNIT, ampU: Math.min(0.35, amp(Hw)), speedU: windSea.phaseSpeedMs / SCALE_M_PER_UNIT, periodS: Tw },
  ];
  const relRad = enc.relAngleDeg * Math.PI / 180;
  // 船隻搖晃（示意，已放大）：幅度隨浪高線性放大，再依浪向相對船首角分配到橫搖／縱搖；
  // 頂浪或順浪時仍保留基本橫搖（實船不會完全不搖）。另疊加風浪的短週期晃動與側風傾側。
  const windRel = ((wfr - heading + 540) % 360) - 180;
  const encW = encounter(Tw, wfr, heading, SHIP_SPEED_MS);
  const motion = {
    rollDeg: Math.min(12, Hs * 3.6 * (0.3 + 0.7 * Math.abs(Math.sin(relRad)))),
    pitchDeg: Math.min(5, Hs * 1.7 * (0.3 + 0.7 * Math.abs(Math.cos(relRad)))),
    heaveU: Math.min(0.7, amp(Hs) * 0.9), periodS: Math.max(3, Math.min(30, enc.encounterPeriodSec)),
    windRollDeg: Math.min(3, Hw * 2.5 * (0.3 + 0.7 * Math.abs(Math.sin(windRel * Math.PI / 180)))), windPitchDeg: Math.min(1.5, Hw * 1.2),
    windPeriodS: Math.max(1.5, Math.min(8, encW.encounterPeriodSec)),
    heelDeg: Math.min(2.5, aw.speedMs * aw.speedMs * 0.012 * Math.sin(((aw.fromDeg - heading + 540) % 360 - 180) * Math.PI / 180)),
  };
  const moonUp = moon.elevationDeg > -1, darkness = Math.max(0, Math.min(1, (-sun.elevationDeg - 3) / 9));
  return {
    sun, moon, stage, palette: pal, heading, waves, motion, cloud, precip, visibilityM: vis,
    fogU: Math.max(0.004, Math.min(0.25, 1 / Math.max(1, vis / SCALE_M_PER_UNIT) * 2.2)),
    whitecap: whitecapFraction(ws), apparentWind: aw, windMs: ws, windFrom: wfr, encounter: enc,
    moonLight: moonUp ? moon.illumination * darkness * (1 - cloud * 0.85) : 0,
    starAlpha: darkness * (1 - cloud) * (1 - Math.min(1, moon.illumination * (moonUp ? 0.5 : 0))),
    shipLights: Math.max(0, Math.min(1, (-sun.elevationDeg + 1) / 4)),
    known: { wave: H !== null && T !== null && wf !== null, wind: wind !== null && windFrom !== null, sky: Number.isFinite(c.cloud) },
  };
}

/**
 * createCruiseScene(container, { reducedMotion, forceFallback })
 * 回傳 { mode, setConditions(cond), setDirection('out'|'back'), setPaused(bool), isAnimating(), snapshot(), destroy() }
 */
export function createCruiseScene(container, { reducedMotion = false, forceFallback = false } = {}) {
  if (forceFallback || !webglAvailable()) return { ...EMPTY };
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); } catch { return { ...EMPTY }; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  camera.position.set(0, 3.6, 16); camera.lookAt(0.2, 1.1, 0);

  // 光源
  const sunLight = new THREE.DirectionalLight(0xffd3a0, 2.4); scene.add(sunLight);
  const moonLight = new THREE.DirectionalLight(0xb8c8ff, 0); scene.add(moonLight);
  const hemi = new THREE.HemisphereLight(0x9fd0ea, 0x0a3550, 0.9); scene.add(hemi);

  // 天空穹頂
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { uZenith: { value: new THREE.Color(0x2f74c9) }, uHorizon: { value: new THREE.Color(0xb8d5ea) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0xfff4df) }, uSunI: { value: 1 }, uHaze: { value: 0.2 } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat); scene.add(sky);

  // 星空：約 900 顆，赤道座標固定，依恆星時與緯度轉成地平座標
  const STAR_N = 900, starRA = new Float32Array(STAR_N), starDec = new Float32Array(STAR_N), starMag = new Float32Array(STAR_N);
  { let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < STAR_N; i++) { starRA[i] = rnd() * 360; starDec[i] = Math.asin(rnd() * 2 - 1) * 180 / Math.PI; starMag[i] = 0.35 + rnd() * rnd() * 0.65; } }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STAR_N * 3), 3));
  const starCol = new Float32Array(STAR_N * 3); for (let i = 0; i < STAR_N; i++) { const w = 0.85 + Math.random() * 0.15; starCol.set([w, w * (0.9 + Math.random() * 0.1), 1], i * 3); }
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat); scene.add(stars);
  function placeStars(epochSec, lat, lon) {
    const lst = siderealDeg(epochSec, lon), pos = starGeo.attributes.position.array, φ = lat * Math.PI / 180;
    for (let i = 0; i < STAR_N; i++) {
      const ha = (lst - starRA[i]) * Math.PI / 180, δ = starDec[i] * Math.PI / 180;
      const sinAlt = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(ha), alt = Math.asin(sinAlt);
      const cosAz = (Math.sin(δ) - Math.sin(φ) * sinAlt) / (Math.cos(φ) * Math.cos(alt)); let az = Math.acos(Math.max(-1, Math.min(1, cosAz))); if (Math.sin(ha) > 0) az = 2 * Math.PI - az;
      const d = dirFromAzEl(az * 180 / Math.PI, alt * 180 / Math.PI).multiplyScalar(280 * starMag[i] + 10);
      pos[i * 3] = d.x; pos[i * 3 + 1] = alt > 0 ? d.y : -999; pos[i * 3 + 2] = d.z;
    }
    starGeo.attributes.position.needsUpdate = true;
  }

  // 月亮（sprite，貼圖依月相重畫）
  const moonTex = moonTexture(128);
  const moonMat = new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, opacity: 0 });
  const moonSprite = new THREE.Sprite(moonMat); moonSprite.scale.setScalar(9); scene.add(moonSprite);
  const moonGlowMat = new THREE.SpriteMaterial({ map: glowTexture(128, 'rgba(200,210,255,.55)', 'rgba(200,210,255,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const moonGlow = new THREE.Sprite(moonGlowMat); moonGlow.scale.setScalar(30); scene.add(moonGlow);

  // 雲：三層噪聲貼圖平面，順風漂移
  const cloudTex = fbmTexture(256, 3);
  const cloudLayers = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), m); mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = i * 1.9; mesh.position.set((i - 1) * 40, 26 + i * 4, -70 - i * 20);
    scene.add(mesh); cloudLayers.push(mesh);
  }

  // 海面
  const seaGeo = new THREE.PlaneGeometry(220, 220, 128, 128); seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, extensions: { derivatives: true },
    uniforms: {
      uTime: { value: 0 }, uWaveA: { value: new THREE.Vector4(1, 0, 1, 0.1) }, uWaveB: { value: new THREE.Vector4(0, 1, 2, 0.05) }, uWaveC: { value: new THREE.Vector4(1, 1, 5, 0.02) },
      uSpeed: { value: new THREE.Vector3(1, 1, 1) }, uSteep: { value: 0.6 },
      uDeep: { value: new THREE.Color(0x06345e) }, uShallow: { value: new THREE.Color(0x1f8fb0) }, uHorizon: { value: new THREE.Color(0x8fbbd3) }, uZenith: { value: new THREE.Color(0x2f74c9) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0xffc48a) }, uSunI: { value: 1 }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonI: { value: 0 },
      uCam: { value: camera.position }, uFoam: { value: 0 }, uFog: { value: 0.01 }, uWind: { value: new THREE.Vector2(1, 0) }, uRipple: { value: 0.1 },
    } });
  const sea = new THREE.Mesh(seaGeo, seaMat); sea.position.set(0, 0, -30); scene.add(sea);

  // 船（外層：航向；內層：搖晃）
  const { ship, glass, teal, navLights, funnelTop } = buildShip();
  ship.scale.setScalar(0.62);
  const motionGroup = new THREE.Group(); motionGroup.add(ship);
  const headingGroup = new THREE.Group(); headingGroup.add(motionGroup); headingGroup.position.y = -0.05; scene.add(headingGroup);
  // 尾流：沿船尾向後的透明白帶（固定船速）
  const wakeTex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
    const img = g.getImageData(0, 0, 256, 64), d = img.data; for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4; const edge = 1 - Math.abs(y - 32) / 32; const n = 0.6 + 0.4 * Math.sin(x * 0.3 + y * 0.9) * Math.sin(x * 0.07); d[i + 3] = Math.round(d[i + 3] * Math.pow(edge, 1.4) * n); } g.putImageData(img, 0, 0); return new THREE.CanvasTexture(c); })();
  const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, opacity: 0.8 });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), wakeMat); wake.rotation.x = -Math.PI / 2; wake.rotation.z = Math.PI; wake.position.set(-7.6, 0.04, 0); headingGroup.add(wake);
  // 煙：少量 sprite 粒子，順視風漂移
  const smokeTex = glowTexture(64, 'rgba(205,205,210,.85)', 'rgba(205,205,210,0)');
  const SMOKE_N = 28, smokes = [];
  for (let i = 0; i < SMOKE_N; i++) { const m = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }); const s = new THREE.Sprite(m); scene.add(s); smokes.push({ s, t: i / SMOKE_N * 6, life: 6 }); }
  // 雨：點粒子
  const RAIN_N = 1500, rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) { rainPos[i * 3] = (Math.random() - 0.5) * 40; rainPos[i * 3 + 1] = Math.random() * 14; rainPos[i * 3 + 2] = -Math.random() * 30 + 10; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0xcfe0ee, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
  const rain = new THREE.Points(rainGeo, rainMat); scene.add(rain);

  // 狀態
  let direction = 'out', paused = false, destroyed = false, raf = 0, last = performance.now(), time = 0;
  let cond = {}, vis = deriveVisual({});
  const target = { amp: [0.1, 0.05, 0.02], foam: 0, fog: 0.01, moonI: 0, starA: 0, lights: 0, cloud: 0.2, rain: 0, ripple: 0.1 };
  const cur = { ...target, amp: [...target.amp] };
  let smokeDir = new THREE.Vector3(0, 0.4, 0), smokeSpeed = 0.5, rainDrift = new THREE.Vector3();

  function applyVisual() {
    vis = deriveVisual({ ...cond, direction });
    const p = vis.palette, s = vis.sun;
    const sunDir = dirFromAzEl(s.azimuthDeg, Math.max(s.elevationDeg, -6)), moonDir = dirFromAzEl(vis.moon.azimuthDeg, vis.moon.elevationDeg);
    const cloudHaze = vis.cloud * 0.8 + Math.max(0, 1 - vis.visibilityM / 15000) * 0.6;
    const zen = new THREE.Color(p.zenith).lerp(new THREE.Color(p.horizon), vis.cloud * 0.55), hor = new THREE.Color(p.horizon).lerp(new THREE.Color(0x9ea7b4), vis.cloud * 0.4 * Math.min(1, p.ambient));
    skyMat.uniforms.uZenith.value.copy(zen); skyMat.uniforms.uHorizon.value.copy(hor); skyMat.uniforms.uSunDir.value.copy(sunDir);
    skyMat.uniforms.uSunColor.value.setHex(p.sun); skyMat.uniforms.uSunI.value = p.sunIntensity * (1 - vis.cloud * 0.7); skyMat.uniforms.uHaze.value = cloudHaze;
    sunLight.position.copy(sunDir).multiplyScalar(60); sunLight.color.setHex(p.sun); sunLight.intensity = p.sunIntensity * (1 - vis.cloud * 0.55);
    moonLight.position.copy(moonDir).multiplyScalar(60); moonLight.intensity = vis.moonLight * 0.45;
    hemi.color.copy(zen); hemi.groundColor.setHex(0x0a3550); hemi.intensity = p.ambient * (0.75 + vis.moonLight * 0.4);
    const su = seaMat.uniforms;
    su.uHorizon.value.copy(hor); su.uZenith.value.copy(zen); su.uSunDir.value.copy(sunDir); su.uSunColor.value.setHex(p.sun); su.uSunI.value = p.sunIntensity * (1 - vis.cloud * 0.6);
    su.uMoonDir.value.copy(moonDir); su.uMoonI.value = vis.moonLight;
    su.uDeep.value.setHex(0x06345e).lerp(new THREE.Color(0x02101f), vis.cloud * 0.5); su.uShallow.value.setHex(0x1f8fb0).lerp(new THREE.Color(0x1d4f66), vis.cloud * 0.6);
    for (let i = 0; i < 3; i++) {
      const w = vis.waves[i], d = dirFromAzEl((w.fromDeg + 180) % 360, 0);
      const u = [su.uWaveA, su.uWaveB, su.uWaveC][i].value; u.x = d.x; u.y = d.z; u.z = 2 * Math.PI / Math.max(0.5, w.wavelengthU);
      su.uSpeed.value.setComponent(i, w.speedU);
    }
    const awd = dirFromAzEl((vis.windFrom + 180) % 360, 0); su.uWind.value.set(awd.x, awd.z);
    target.amp = vis.waves.map((w) => w.ampU); target.foam = vis.whitecap; target.fog = vis.fogU; target.moonI = vis.moonLight; target.starA = vis.starAlpha;
    target.lights = vis.shipLights; target.cloud = vis.cloud; target.rain = Math.min(1, vis.precip / 3); target.ripple = 0.05 + Math.min(0.5, vis.windMs * 0.03);
    moonTex.draw(vis.moon.illumination, vis.moon.waxing);
    moonSprite.position.copy(moonDir).multiplyScalar(240); moonGlow.position.copy(moonSprite.position);
    placeStars(cond.epochSec ?? Math.floor(Date.now() / 1000), cond.lat ?? 25.5, cond.lon ?? 124);
    headingGroup.rotation.y = headingToRotY(vis.heading);
    const apd = dirFromAzEl((vis.apparentWind.fromDeg + 180) % 360, 0); smokeDir.set(apd.x, 0.35, apd.z); smokeSpeed = 0.25 + vis.apparentWind.speedMs * 0.06;
    const rd = dirFromAzEl((vis.windFrom + 180) % 360, 0); rainDrift.set(rd.x * vis.windMs * 0.25, 0, rd.z * vis.windMs * 0.25);
    renderer.setClearColor(hor);
    scene.fog = null;
    if (reducedMotion) { snapToTarget(); renderOnce(); }
  }
  function snapToTarget() { Object.assign(cur, target, { amp: [...target.amp] }); pushUniforms(); }
  function pushUniforms() {
    const su = seaMat.uniforms; su.uWaveA.value.w = cur.amp[0]; su.uWaveB.value.w = cur.amp[1]; su.uWaveC.value.w = cur.amp[2];
    su.uFoam.value = cur.foam; su.uFog.value = cur.fog; su.uMoonI.value = cur.moonI; su.uRipple.value = cur.ripple;
    starMat.opacity = cur.starA; moonMat.opacity = vis.moon.elevationDeg > -1 ? 0.25 + cur.moonI * 0.75 + Math.max(0, 1 - vis.palette.sunIntensity) * 0.3 : 0; moonGlowMat.opacity = cur.moonI * 0.8;
    glass.emissiveIntensity = cur.lights * 0.9; teal.emissiveIntensity = cur.lights * 0.6; for (const m of navLights) m.opacity = cur.lights;
    cloudLayers.forEach((m, i) => { m.material.opacity = Math.max(0, Math.min(0.95, cur.cloud * 1.15 - i * 0.12)); const b = 0.25 + Math.min(1, vis.palette.ambient) * 0.75; m.material.color.setHex(vis.palette.sun === 0 ? 0x9aa3b0 : 0xffffff).multiplyScalar(b).lerp(new THREE.Color(vis.palette.horizon), 0.25); });
    rainMat.opacity = cur.rain * 0.7;
  }
  function resize() { const w = container.clientWidth || 390, h = container.clientHeight || 520; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); if (reducedMotion) renderOnce(); }) : null;
  ro?.observe(container); resize();

  function step(dt, realDt) {
    time += dt;
    seaMat.uniforms.uTime.value = time;
    const k = 1 - Math.exp(-(realDt ?? dt) / 0.7);   // 依真實經過時間平滑，低幀率時不會慢半拍
    for (let i = 0; i < 3; i++) cur.amp[i] += (target.amp[i] - cur.amp[i]) * k;
    for (const key of ['foam', 'fog', 'moonI', 'starA', 'lights', 'cloud', 'rain', 'ripple']) cur[key] += (target[key] - cur[key]) * k;
    pushUniforms();
    // 船隻搖晃：遭遇週期、橫搖／縱搖幅度（示意，已放大）
    const m = vis.motion, ph = (time / m.periodS) * Math.PI * 2, pw = (time / m.windPeriodS) * Math.PI * 2, D = Math.PI / 180;
    motionGroup.rotation.x = (Math.sin(ph) * m.rollDeg + Math.sin(pw + 1.3) * m.windRollDeg + m.heelDeg) * D;
    motionGroup.rotation.z = (Math.sin(ph + 0.7) * m.pitchDeg + Math.sin(pw * 1.1 + 0.4) * m.windPitchDeg) * D;
    motionGroup.position.y = Math.sin(ph + 0.4) * m.heaveU + Math.sin(pw + 0.9) * m.windRollDeg * 0.02 + Math.sin(time * 0.37) * 0.02;
    headingGroup.rotation.y = headingToRotY(vis.heading) + Math.sin(time * 0.11) * 0.005;
    // 雲漂移（真風）
    const wd = seaMat.uniforms.uWind.value, cs = 0.02 + vis.windMs * 0.012;
    cloudLayers.forEach((c, i) => { c.position.x += wd.x * cs * dt * (1 + i * 0.3); c.position.z += wd.y * cs * dt * (1 + i * 0.3); if (c.position.x > 60) c.position.x -= 120; if (c.position.x < -60) c.position.x += 120; if (c.position.z > -20) c.position.z -= 100; if (c.position.z < -140) c.position.z += 100; });
    // 煙
    const fp = funnelTop.clone().applyMatrix4(ship.matrixWorld);
    for (const sm of smokes) {
      sm.t += dt; if (sm.t > sm.life) { sm.t = 0; sm.s.position.copy(fp); }
      const f = sm.t / sm.life; sm.s.position.addScaledVector(smokeDir, smokeSpeed * dt); sm.s.position.y += dt * 0.12;
      sm.s.scale.setScalar(0.2 + f * 1.3); sm.s.material.opacity = (0.22 * (1 - f) * Math.min(1, vis.palette.ambient * 1.1)) * (sm.t < 0.05 ? 0 : 1);
    }
    // 雨
    if (cur.rain > 0.01) { const a = rainGeo.attributes.position.array; for (let i = 0; i < RAIN_N; i++) { a[i * 3 + 1] -= dt * 9; a[i * 3] += rainDrift.x * dt; a[i * 3 + 2] += rainDrift.z * dt; if (a[i * 3 + 1] < 0) { a[i * 3 + 1] = 14; a[i * 3] = (Math.random() - 0.5) * 40; a[i * 3 + 2] = -Math.random() * 30 + 10; } } rainGeo.attributes.position.needsUpdate = true; }
  }
  function renderOnce() { ship.updateMatrixWorld(true); renderer.render(scene, camera); }
  function loop(now) {
    if (destroyed) return; raf = 0; if (paused) return;
    const realDt = Math.min(2, (now - last) / 1000), dt = Math.min(0.05, realDt); last = now;
    step(dt, realDt); renderer.render(scene, camera); raf = requestAnimationFrame(loop);
  }
  function start() { if (destroyed || reducedMotion || paused || raf) return; last = performance.now(); raf = requestAnimationFrame(loop); }
  applyVisual(); snapToTarget();
  if (reducedMotion) renderOnce(); else start();

  return {
    mode: 'webgl',
    setConditions(c) { cond = { ...c }; applyVisual(); },
    setDirection(dir) { direction = dir === 'back' ? 'back' : 'out'; applyVisual(); },
    setPaused(p) { paused = !!p; if (paused && raf) { cancelAnimationFrame(raf); raf = 0; } if (!paused) start(); },
    isAnimating: () => raf !== 0,
    snapshot: () => ({ ...vis, time, cur: { ...cur, amp: [...cur.amp] }, shipRotY: headingGroup.rotation.y, roll: motionGroup.rotation.x, pitch: motionGroup.rotation.z }),
    destroy() { destroyed = true; if (raf) cancelAnimationFrame(raf); ro?.disconnect(); seaGeo.dispose(); seaMat.dispose(); skyMat.dispose(); starGeo.dispose(); rainGeo.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}

/** 給 SVG fallback 用：依太陽高度回傳 CSS 色票 */
export function fallbackColors(epochSec, lat, lon) {
  const s = sunPosition(epochSec, lat, lon), p = skyPalette(s.elevationDeg), m = moonPosition(epochSec, lat, lon);
  return { skyTop: hex(p.zenith), skyBottom: hex(p.horizon), sunVisible: s.elevationDeg > -1, sunX: 0.5 + Math.sin(relativeAzimuth(s.azimuthDeg, CAMERA_HEADING_DEG) * Math.PI / 180) * 0.45, sunY: Math.max(0.05, 0.6 - s.elevationDeg / 90 * 0.9),
    moonVisible: m.elevationDeg > 0 && s.elevationDeg < -3, moonIllumination: m.illumination, stage: twilightStage(s.elevationDeg), dark: Math.max(0, Math.min(1, (-s.elevationDeg - 3) / 9)) };
}
