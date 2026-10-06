// cruise-scene.mjs — 輕量 Three.js 海面／郵輪／夕陽示意場景
// 只做視覺示意：海面起伏強弱由 UI 以「相對示意等級」餵入，船體搖晃為固定極小幅度，
// 不是任何船體運動或海況的物理模型。WebGL 不可用時回報 mode:'static'，由 UI 顯示 SVG fallback。
import * as THREE from 'three';

const MAX_DPR = 1.5;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const SEA_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vPos;
  varying float vH;
  float w(vec2 p, vec2 d, float k, float s, float t) { return sin(dot(p, d) * k + t * s); }
  void main() {
    vec3 p = position;
    float t = uTime;
    float h = 0.0;
    h += w(p.xz, vec2(1.0, 0.35), 0.55, 0.9, t) * 0.55;
    h += w(p.xz, vec2(-0.5, 1.0), 1.15, 1.35, t) * 0.28;
    h += w(p.xz, vec2(0.8, -0.7), 2.3, 2.0, t) * 0.12;
    h += w(p.xz, vec2(0.2, 1.0), 4.1, 2.8, t) * 0.05;
    p.y += h * uAmp;
    vH = h;
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const SEA_FRAG = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uCam;
  varying vec3 vPos;
  varying float vH;
  void main() {
    vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    vec3 v = normalize(uCam - vPos);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 base = mix(uDeep, uShallow, clamp(vH * 0.5 + 0.5, 0.0, 1.0));
    vec3 hv = normalize(uSunDir + v);
    float spec = pow(max(dot(n, hv), 0.0), 90.0);
    float glitter = pow(max(dot(n, hv), 0.0), 400.0) * 1.6;
    vec3 col = base + fres * vec3(0.30, 0.55, 0.62) * 0.55 + (spec + glitter) * uSunColor;
    float foam = smoothstep(0.78, 1.0, vH) * 0.28;
    col = mix(col, vec3(0.92, 0.97, 0.98), foam);
    float dist = length(vPos.xz - uCam.xz);
    float fog = smoothstep(22.0, 60.0, dist);
    col = mix(col, uHorizon, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function buildShip() {
  const ship = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f7f9, roughness: 0.55, metalness: 0.05 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x163a5c, roughness: 0.25, metalness: 0.3 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x0b2a4a, roughness: 0.6 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe88a3a, roughness: 0.6 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x3fc9d0, roughness: 0.3 });

  const L = 10, W = 2.5;
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, -W / 2);
  shape.lineTo(L / 2 - 2.8, -W / 2);
  shape.quadraticCurveTo(L / 2 - 0.5, -W * 0.32, L / 2, 0);
  shape.quadraticCurveTo(L / 2 - 0.5, W * 0.32, L / 2 - 2.8, W / 2);
  shape.lineTo(-L / 2, W / 2);
  shape.quadraticCurveTo(-L / 2 - 0.55, 0, -L / 2, -W / 2);

  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.15, bevelEnabled: false }), white);
  hull.geometry.rotateX(-Math.PI / 2);
  hull.position.y = 0.05;
  ship.add(hull);

  const band = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: false }), navy);
  band.geometry.rotateX(-Math.PI / 2);
  band.scale.set(1.012, 1, 1.03);
  band.position.y = -0.2;
  ship.add(band);

  // 船身舷窗帶
  const hullGlass = new THREE.Mesh(new THREE.BoxGeometry(L - 2.6, 0.16, W + 0.02), glass);
  hullGlass.position.set(-0.9, 0.75, 0);
  ship.add(hullGlass);

  const decks = [
    { len: 7.4, wid: 2.2, h: 0.62, x: -0.8 },
    { len: 6.2, wid: 2.0, h: 0.58, x: -1.0 },
    { len: 4.6, wid: 1.7, h: 0.52, x: -1.3 },
  ];
  let y = 1.2;
  for (const d of decks) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(d.len, d.h, d.wid), white);
    deck.position.set(d.x, y + d.h / 2, 0);
    ship.add(deck);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(d.len - 0.5, d.h * 0.42, d.wid + 0.03), glass);
    strip.position.set(d.x, y + d.h / 2, 0);
    ship.add(strip);
    y += d.h;
  }
  // 駕駛台（偏向船首）
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.75), white);
  bridge.position.set(1.4, y + 0.22, 0);
  ship.add(bridge);
  const bridgeGlass = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.2, 1.78), glass);
  bridgeGlass.position.set(1.42, y + 0.25, 0);
  ship.add(bridgeGlass);
  // 煙囪與雷達
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.9, 20), white);
  funnel.position.set(-2.4, y + 0.45, 0);
  ship.add(funnel);
  const funnelTop = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 20), navy);
  funnelTop.position.set(-2.4, y + 0.92, 0);
  ship.add(funnelTop);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 8), white);
  mast.position.set(0.6, y + 0.9, 0);
  ship.add(mast);
  const radar = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), white);
  radar.position.set(-0.6, y + 0.35, 0);
  ship.add(radar);
  // 甲板泳池（青色小點）
  const pool = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.6), teal);
  pool.position.set(-3.3, 1.24, 0);
  ship.add(pool);
  // 救生艇
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const boat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.16), orange);
      boat.position.set(-3.4 + i * 0.95, 1.25, side * (1.2));
      ship.add(boat);
    }
  }
  return ship;
}

/**
 * createCruiseScene(container, { reducedMotion, forceFallback })
 * 回傳 { mode:'webgl'|'static', setSeaLevel(level 0..1), setDirection('out'|'back'), setPaused(bool), isAnimating(), destroy() }
 */
export function createCruiseScene(container, { reducedMotion = false, forceFallback = false } = {}) {
  if (forceFallback || !webglAvailable()) {
    return {
      mode: 'static',
      setSeaLevel() {},
      setDirection() {},
      setPaused() {},
      isAnimating: () => false,
      destroy() {},
    };
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return { mode: 'static', setSeaLevel() {}, setDirection() {}, setPaused() {}, isAnimating: () => false, destroy() {} };
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // 鏡頭拉遠、視線略抬高：整艘船完整落在畫面中段偏下，左右各留約 40% 留白，
  // 地平線約在 hero 上方 30%，讓標題／日期位於深色天空區。船本身另縮 0.62 倍。
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(0, 3.6, 16);
  camera.lookAt(0.2, 1.1, 0);

  const sunDir = new THREE.Vector3(6, 3.2, -9).normalize();
  const sun = new THREE.DirectionalLight(0xffd3a0, 2.4);
  sun.position.copy(sunDir).multiplyScalar(20);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xcfe6ff, 1.1);
  fill.position.set(-5, 6, 10);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x9fd0ea, 0x0a3550, 0.9));

  const seaGeo = new THREE.PlaneGeometry(150, 150, 110, 110);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 0.25 },
      uDeep: { value: new THREE.Color(0x06345e) },
      uShallow: { value: new THREE.Color(0x1f8fb0) },
      uHorizon: { value: new THREE.Color(0x8fbbd3) },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color(0xffc48a) },
      uCam: { value: camera.position },
    },
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.set(0, 0, -20);
  scene.add(sea);

  const ship = buildShip();
  ship.scale.setScalar(0.62);
  ship.position.y = -0.05;
  scene.add(ship);

  let direction = 'out';
  let targetAmp = 0.25;
  let paused = false;
  let destroyed = false;
  let raf = 0;
  let last = performance.now();
  let time = 0;

  function applyDirection() {
    ship.rotation.y = direction === 'out' ? -0.55 : Math.PI + 0.55;
  }
  applyDirection();

  function resize() {
    const w = container.clientWidth || 390;
    const h = container.clientHeight || 520;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); if (reducedMotion) renderOnce(); }) : null;
  ro?.observe(container);
  resize();

  function step(dt) {
    time += dt;
    seaMat.uniforms.uTime.value = time;
    seaMat.uniforms.uAmp.value += (targetAmp - seaMat.uniforms.uAmp.value) * Math.min(1, dt * 2);
    // 船體固定微幅起伏：純視覺，不隨海況資料放大
    ship.position.y = -0.05 + Math.sin(time * 0.8) * 0.035;
    ship.rotation.z = Math.sin(time * 0.6) * 0.01;
    ship.rotation.x = Math.sin(time * 0.45 + 1) * 0.006;
  }
  function renderOnce() {
    seaMat.uniforms.uAmp.value = targetAmp;
    renderer.render(scene, camera);
  }
  function loop(now) {
    if (destroyed) return;
    raf = 0;
    if (paused) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (destroyed || reducedMotion || paused || raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  if (reducedMotion) renderOnce(); else start();

  return {
    mode: 'webgl',
    setSeaLevel(level) {
      const l = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0.3;
      targetAmp = 0.08 + l * 0.6;
      if (reducedMotion) renderOnce();
    },
    setDirection(dir) {
      direction = dir === 'back' ? 'back' : 'out';
      applyDirection();
      if (reducedMotion) renderOnce();
    },
    setPaused(p) {
      paused = !!p;
      if (paused && raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!paused) start();
    },
    isAnimating: () => raf !== 0,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      seaGeo.dispose(); seaMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
