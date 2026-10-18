// 鐵道出走沙盤 — low-poly 3D valley (Three.js). Original procedural art; no external models.
// The layout is a stylised map of the 平溪線 (not to scale). Train/visitor positions during the
// preview are estimates derived from timetable minutes, never live GPS.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const TRACK_PTS = [ // x east, z south (scene units). Station codes mark the real stops.
  { x: -56, z: -22 }, { x: -48, z: -14, code: '7360' }, { x: -40, z: -8 }, { x: -34, z: -2, code: '7350' },
  { x: -29, z: 6 }, { x: -22, z: 12 }, { x: -14, z: 15 }, { x: -4, z: 14, code: '7332' }, { x: 6, z: 12 },
  { x: 16, z: 9 }, { x: 26, z: 6, code: '7335' }, { x: 34, z: 3.5 }, { x: 42, z: 2, code: '7336' }, { x: 48, z: 1 },
];
const RIVER_PTS = [[-60, -14], [-50, -8], [-42, 0], [-36, 5], [-30, 12], [-22, 17], [-12, 20], [-2, 19], [8, 17], [18, 14], [28, 11], [38, 8], [50, 6]];

const C = {
  grass: new THREE.Color('#79b56a'), grass2: new THREE.Color('#5f9a53'), rock: new THREE.Color('#8e8a7a'), snow: new THREE.Color('#c9c3b2'),
  water: '#5aa7c4', ballast: '#8c8477', rail: '#4a4a4a', platform: '#bdb6a6', wall: '#f1e6c6', roof: '#8a4b3b', wood: '#a0683f',
  train: '#f3e6c8', stripe: '#e8742c', glass: '#2d3e50', dark: '#3a3a3a', tree1: '#2f7a4a', tree2: '#3f9a5a', tree3: '#2a6a5a',
  lantern: '#ff8c3a', visitor: '#e8742c', waterfall: '#cfe9f5', cat: '#444', mine: '#5c5248', food: '#d9a441', street: '#c97a3a',
};

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }

export function createScene(canvas, { stations, pois, onStationTap, onFrame }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const isMobile = matchMedia('(pointer:coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color('#cfe3ec'), 120, 260);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 18; controls.maxDistance = 170;
  controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.3; controls.enablePan = true; controls.screenSpacePanning = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.zoomSpeed = 0.8; controls.rotateSpeed = 0.7;

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight('#dff1ff', '#6a7a55', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.position.set(-40, 70, 30); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 60, bottom: -60, near: 10, far: 220 }); sun.shadow.bias = -0.0008;
  scene.add(sun);

  // ---------- track curve ----------
  const curve = new THREE.CatmullRomCurve3(TRACK_PTS.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal', 0.5);
  const SAMPLES = 600; const samples = curve.getSpacedPoints(SAMPLES);
  const stationU = {}; const stationPos = {};
  for (const p of TRACK_PTS) if (p.code) {
    let best = 0, bd = 1e9; samples.forEach((s, i) => { const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2; if (d < bd) { bd = d; best = i; } });
    stationU[p.code] = best / SAMPLES; stationPos[p.code] = samples[best].clone();
  }
  const distToTrack = (x, z) => { let bd = 1e9; for (let i = 0; i < samples.length; i += 3) { const s = samples[i]; const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) bd = d; } return Math.sqrt(bd); };
  const riverCurve = new THREE.CatmullRomCurve3(RIVER_PTS.map(([x, z]) => new THREE.Vector3(x, -0.35, z)), false, 'centripetal');
  const riverS = riverCurve.getSpacedPoints(300);
  const distToRiver = (x, z) => { let bd = 1e9; for (let i = 0; i < riverS.length; i += 2) { const s = riverS[i]; const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) bd = d; } return Math.sqrt(bd); };

  // ---------- terrain ----------
  const W = 190, H = 130, SX = 76, SZ = 52;
  const geo = new THREE.PlaneGeometry(W, H, SX, SZ); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; const colors = [];
  const heightAt = (x, z) => {
    const hills = 4.5 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.11) + 2.6 * Math.sin(x * 0.19 + z * 0.13) + 1.6 * Math.cos(x * 0.31 - z * 0.27) + 6;
    const valley = smoothstep(6, 34, distToTrack(x, z)) * smoothstep(3.5, 16, distToRiver(x, z));
    return Math.max(-0.2, hills * valley) + hash(x, z) * 0.25;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i); const y = heightAt(x, z); pos.setY(i, y);
    const c = new THREE.Color();
    if (y < 1.2) c.copy(C.grass).lerp(C.grass2, hash(x + 1, z) * 0.6);
    else if (y < 7) c.copy(C.grass2).lerp(C.rock, smoothstep(4, 8.5, y));
    else c.copy(C.rock).lerp(C.snow, smoothstep(8, 12, y));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true; scene.add(terrain);

  // ---------- river ----------
  const river = new THREE.Mesh(new THREE.TubeGeometry(riverCurve, 160, 2.2, 6, false), new THREE.MeshLambertMaterial({ color: C.water, transparent: true, opacity: 0.9 }));
  river.scale.y = 0.12; river.position.y = 0.08; scene.add(river);

  // ---------- track (ballast + rails + sleepers) ----------
  const ballast = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 1.3, 5, false), new THREE.MeshLambertMaterial({ color: C.ballast, flatShading: true }));
  ballast.scale.y = 0.18; ballast.position.y = 0.05; ballast.receiveShadow = true; scene.add(ballast);
  const railMat = new THREE.MeshLambertMaterial({ color: C.rail });
  for (const side of [-0.45, 0.45]) {
    const pts = []; for (let i = 0; i <= SAMPLES; i++) { const u = i / SAMPLES; const p = curve.getPointAt(u); const t = curve.getTangentAt(u); const n = new THREE.Vector3(-t.z, 0, t.x).normalize(); pts.push(p.clone().addScaledVector(n, side).setY(0.33)); }
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 500, 0.09, 4, false), railMat));
  }
  const sleeper = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.1, 1.4), new THREE.MeshLambertMaterial({ color: C.wood }), 260);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), fw = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < 260; i++) { const u = i / 260; const p = curve.getPointAt(u); const t = curve.getTangentAt(u); q.setFromUnitVectors(fw, new THREE.Vector3(t.x, 0, t.z).normalize()); m.compose(p.clone().setY(0.26), q, new THREE.Vector3(1, 1, 1)); sleeper.setMatrixAt(i, m); }
    sleeper.instanceMatrix.needsUpdate = true; scene.add(sleeper); }

  // ---------- trees ----------
  const TREES = 420;
  const tree = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.6, 5), new THREE.MeshLambertMaterial({ flatShading: true }), TREES);
  tree.castShadow = true; tree.receiveShadow = true;
  { const m = new THREE.Matrix4(); const col = new THREE.Color(); let n = 0, tries = 0;
    while (n < TREES && tries < 6000) {
      tries++; const x = (hash(tries, 7) - 0.5) * W * 0.95, z = (hash(3, tries) - 0.5) * H * 0.95;
      if (distToTrack(x, z) < 4.2 || distToRiver(x, z) < 3.2) continue;
      const y = heightAt(x, z); if (y > 8.5) continue;
      if (Object.values(stationPos).some(s => Math.hypot(s.x - x, s.z - z) < 7)) continue;
      const s = 0.8 + hash(x, z) * 0.9; m.makeScale(s, s * (0.9 + hash(z, x) * 0.6), s); m.setPosition(x, y + 1.1 * s, z);
      tree.setMatrixAt(n, m); col.set([C.tree1, C.tree2, C.tree3][Math.floor(hash(x * 3, z * 5) * 3)]); tree.setColorAt(n, col); n++;
    }
    tree.count = n; tree.instanceMatrix.needsUpdate = true; tree.instanceColor.needsUpdate = true; scene.add(tree); }

  // ---------- stations ----------
  const stationGroup = new THREE.Group(); scene.add(stationGroup);
  const stationMeshes = [];
  const sMap = Object.fromEntries(stations.map(s => [s.code, s]));
  for (const code of Object.keys(stationPos)) {
    const p = stationPos[code]; const u = stationU[code]; const t = curve.getTangentAt(u); const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const g = new THREE.Group(); g.position.copy(p); g.lookAt(p.clone().add(t)); g.userData.code = code;
    const platform = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 7), new THREE.MeshLambertMaterial({ color: C.platform })); platform.position.set(-2.2, 0.25, 0); platform.receiveShadow = true; g.add(platform);
    const house = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 3.2), new THREE.MeshLambertMaterial({ color: code === '7336' ? C.wood : C.wall })); house.position.set(-3.6, 1.35, 0); house.castShadow = true; g.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.3, 4), new THREE.MeshLambertMaterial({ color: C.roof, flatShading: true })); roof.position.set(-3.6, 2.85, 0); roof.rotation.y = Math.PI / 4; roof.scale.z = 1.3; roof.castShadow = true; g.add(roof);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 5), new THREE.MeshLambertMaterial({ color: C.roof })); canopy.position.set(-1.9, 2.2, 0); g.add(canopy);
    for (const z of [-2, 2]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 5), new THREE.MeshLambertMaterial({ color: C.dark })); post.position.set(-1.4, 1.35, z); g.add(post); }
    // tap target (invisible, generous)
    const hit = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 9), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(-2.5, 2.5, 0); hit.userData.code = code; g.add(hit); stationMeshes.push(hit);
    stationGroup.add(g);
    g.userData.normal = n;
  }

  // ---------- POI markers ----------
  const poiPos = {}; const poiMeshes = {};
  const poiGroup = new THREE.Group(); scene.add(poiGroup);
  for (const poi of pois) {
    const st = sMap[poi.station]; const sp = stationPos[poi.station]; if (!st || !sp) continue;
    const dLng = (poi.lng - st.lng) * Math.cos(st.lat * Math.PI / 180), dLat = poi.lat - st.lat;
    const len = Math.hypot(dLng, dLat) || 1; const dist = 3.2 + Math.min(poi.walk_m || 100, 1600) / 130;
    const x = sp.x + (dLng / len) * dist, z = sp.z - (dLat / len) * dist; const y = Math.max(heightAt(x, z), 0) + 0.2;
    const g = new THREE.Group(); g.position.set(x, y, z);
    const colorMap = { lantern: C.lantern, waterfall: C.waterfall, cat: C.cat, mine: C.mine, food: C.food, street: C.street };
    const col = colorMap[poi.icon] || C.street;
    let shape;
    if (poi.icon === 'waterfall') { shape = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.5), new THREE.MeshLambertMaterial({ color: col, emissive: '#5aa7c4', emissiveIntensity: 0.25 })); shape.position.y = 1.2; }
    else if (poi.icon === 'lantern') { shape = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, flatShading: true })); shape.position.y = 1.6; shape.scale.y = 1.4; }
    else if (poi.icon === 'mine') { shape = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 1.2), new THREE.MeshLambertMaterial({ color: col, flatShading: true })); shape.position.y = 0.8; }
    else if (poi.icon === 'cat') { shape = new THREE.Mesh(new THREE.SphereGeometry(0.75, 6, 5), new THREE.MeshLambertMaterial({ color: col, flatShading: true })); shape.position.y = 0.75; const ear = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), shape.material); ear.position.set(0.35, 1.35, 0); g.add(ear); const ear2 = ear.clone(); ear2.position.x = -0.35; g.add(ear2); }
    else if (poi.icon === 'food') { shape = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.0, 7), new THREE.MeshLambertMaterial({ color: col, flatShading: true })); shape.position.y = 0.5; }
    else { shape = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), new THREE.MeshLambertMaterial({ color: col, flatShading: true })); shape.position.y = 0.6; const r = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.8, 4), new THREE.MeshLambertMaterial({ color: C.roof, flatShading: true })); r.position.y = 1.6; r.rotation.y = Math.PI / 4; g.add(r); }
    shape.castShadow = true; g.add(shape);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.8, 24), new THREE.MeshBasicMaterial({ color: '#2f8f5b', transparent: true, opacity: 0.0, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    g.userData = { id: poi.id, ring, labelY: 2.6 };
    poiGroup.add(g); poiPos[poi.id] = g.position.clone(); poiMeshes[poi.id] = g;
  }

  // ---------- train ----------
  const train = new THREE.Group(); scene.add(train);
  const cars = [];
  const makeCar = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.15, 1.35), new THREE.MeshLambertMaterial({ color: C.train })); body.position.y = 0.95; body.castShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 1.2), new THREE.MeshLambertMaterial({ color: '#d9ccab' })); roof.position.y = 1.62; g.add(roof);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.62, 0.22, 1.37), new THREE.MeshLambertMaterial({ color: C.stripe })); stripe.position.y = 0.78; g.add(stripe);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.38, 1.38), new THREE.MeshLambertMaterial({ color: C.glass })); win.position.y = 1.2; g.add(win);
    const under = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.3, 1.0), new THREE.MeshLambertMaterial({ color: C.dark })); under.position.y = 0.42; g.add(under);
    for (const x of [-1.1, 1.1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 1.2), new THREE.MeshLambertMaterial({ color: '#222' })); w.position.set(x, 0.3, 0); g.add(w); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: '#fff6c8' })); lamp.position.set(1.82, 1.0, 0); g.add(lamp);
    return g;
  };
  for (let i = 0; i < 2; i++) { const c = makeCar(); train.add(c); cars.push(c); }
  const CAR_GAP = 3.9 / curve.getLength();
  function placeTrain(u, dirSign = 1) {
    cars.forEach((c, i) => {
      const uu = Math.min(1, Math.max(0, u - dirSign * i * CAR_GAP));
      const p = curve.getPointAt(uu); const t = curve.getTangentAt(uu);
      c.position.set(p.x, 0.3, p.z); c.lookAt(p.x + t.x * dirSign, 0.3, p.z + t.z * dirSign); c.rotateY(-Math.PI / 2);
    });
  }
  placeTrain(stationU['7360'], 1);

  // ---------- visitor marker ----------
  const visitor = new THREE.Group(); visitor.visible = false; scene.add(visitor);
  { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.0, 7), new THREE.MeshLambertMaterial({ color: C.visitor })); b.position.y = 0.5; b.castShadow = true; visitor.add(b);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.32, 7, 6), new THREE.MeshLambertMaterial({ color: '#f6d9b8' })); h.position.y = 1.25; visitor.add(h);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 20), new THREE.MeshBasicMaterial({ color: C.visitor, transparent: true, opacity: 0.6, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; visitor.add(ring); }

  // ---------- sky lanterns ----------
  const LANT = 14;
  const lanterns = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshLambertMaterial({ color: C.lantern, emissive: C.lantern, emissiveIntensity: 0.8, flatShading: true }), LANT);
  const lantData = []; const lanternBase = [stationPos['7332'], stationPos['7335']];
  for (let i = 0; i < LANT; i++) { const b = lanternBase[i % 2]; lantData.push({ x: b.x + (hash(i, 9) - 0.5) * 10, z: b.z + (hash(2, i) - 0.5) * 8, y: hash(i, i) * 30, v: 1.2 + hash(i, 4) * 1.4, w: hash(5, i) * 6.28 }); }
  scene.add(lanterns);

  // ---------- route highlight (planned legs) ----------
  const routeMat = new THREE.MeshBasicMaterial({ color: '#2f8f5b', transparent: true, opacity: 0.75 });
  let routeMesh = null;
  function setRoute(codes) {
    if (routeMesh) { scene.remove(routeMesh); routeMesh.geometry.dispose(); routeMesh = null; }
    if (!codes || codes.length < 2) return;
    const us = codes.map(c => stationU[c]).filter(u => u != null); const lo = Math.min(...us), hi = Math.max(...us);
    const pts = []; const n = 120; for (let i = 0; i <= n; i++) pts.push(curve.getPointAt(lo + (hi - lo) * i / n).clone().setY(0.55));
    routeMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.35, 5, false), routeMat); scene.add(routeMesh);
  }

  // ---------- camera fit ----------
  const center = new THREE.Vector3(-4, 0, -1);
  function fitCamera() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight; const aspect = w / h;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    const portrait = aspect < 1;
    if (portrait) { controls.target.set(-10, 0, 3); camera.position.set(-92, 112, -14); }
    else { const panel = w >= 900 ? 20 : 0; controls.target.set(center.x + panel, 0, center.z + 8); camera.position.set(center.x + panel + 2, 72, center.z + 98); }
    controls.update();
  }
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize(); fitCamera();

  // ---------- selection / tap ----------
  let selected = null; const selRing = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.2, 32), new THREE.MeshBasicMaterial({ color: '#e8742c', transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.6; selRing.visible = false; scene.add(selRing);
  function setSelected(code) { selected = code; if (code && stationPos[code]) { selRing.visible = true; selRing.position.set(stationPos[code].x, 0.6, stationPos[code].z); } else selRing.visible = false; }
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { passive: true });
  canvas.addEventListener('pointerup', e => {
    if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; const dt = performance.now() - down.t; down = null;
    if (Math.hypot(dx, dy) > 8 || dt > 600) return;
    const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera); const hits = ray.intersectObjects(stationMeshes, false);
    if (hits.length) onStationTap && onStationTap(hits[0].object.userData.code);
  }, { passive: true });

  // ---------- camera focus tween ----------
  let focusTarget = null;
  // shift > 0 moves the orbit target toward the camera (XZ) so the station sits in the upper part of the screen
  // when a bottom sheet covers the lower half (portrait phones).
  function focusStation(code, shift = 0) {
    if (!stationPos[code]) return;
    const p = stationPos[code].clone();
    if (shift) { const d = new THREE.Vector3(camera.position.x - p.x, 0, camera.position.z - p.z); if (d.lengthSq() > 1e-6) p.addScaledVector(d.normalize(), shift); }
    focusTarget = p;
  }
  controls.addEventListener('start', () => { focusTarget = null; follow = false; });

  // ---------- preview ----------
  let timeline = null, follow = false, planStations = null;
  function setPlan(result) {
    planStations = result && result.segments ? [result.input.origin, ...result.segments.filter(s => s.kind === 'train').map(s => s.to)] : null;
    setRoute(planStations);
    for (const id in poiMeshes) { const inPlan = !!(result && result.segments && result.segments.some(s => s.kind === 'visit' && s.poi === id)); poiMeshes[id].userData.ring.material.opacity = inPlan ? 0.8 : 0; }
  }
  function startPreview(result) {
    timeline = { segs: result.segments, origin: result.input.origin, t0: result.summary.departAt, t1: result.summary.returnAt != null ? result.summary.returnAt : (result.segments.length ? result.segments[result.segments.length - 1].end || result.segments[result.segments.length - 1].arr : result.summary.departAt) };
    follow = true; visitor.visible = true; setTime(timeline.t0);
  }
  function stopPreview() { timeline = null; follow = false; visitor.visible = false; placeTrain(stationU['7360'], 1); }
  let hudState = { text: '', riding: false };
  function setTime(min) {
    if (!timeline) return hudState;
    const { segs, origin } = timeline; let cur = segs.find(s => (s.start ?? s.dep) <= min && min < (s.end ?? s.arr)) || null;
    let station = origin, trainU = stationU[origin], trainDir = 1, vPos = stationPos[origin].clone(), text = '';
    // determine where the visitor & train are: walk through segments up to `min`
    let lastStation = origin, lastPoi = null;
    for (const s of segs) {
      const st = s.start ?? s.dep, en = s.end ?? s.arr;
      if (en <= min) { if (s.kind === 'train') { lastStation = s.to; trainU = stationU[s.to]; trainDir = stationU[s.to] >= stationU[s.from] ? 1 : -1; lastPoi = null; } if (s.kind === 'visit') lastPoi = s.poi; if (s.kind === 'walk') lastPoi = poiPos[idForName(s.to)] ? idForName(s.to) : null; continue; }
      if (st <= min && min < en) {
        const k = (min - st) / Math.max(1, en - st);
        if (s.kind === 'train') { const a = stationU[s.from], b = stationU[s.to]; trainU = a + (b - a) * k; trainDir = b >= a ? 1 : -1; const p = curve.getPointAt(trainU); vPos.set(p.x, 0.9, p.z); text = `搭乘 ${s.type} ${s.train} 次 ${s.fromName} → ${s.toName}（${fmt(s.dep)} 發 · ${fmt(s.arr)} 到）`; hudState = { text, riding: true }; placeTrain(trainU, trainDir); visitor.position.copy(vPos); visitor.visible = false; return finish(vPos); }
        if (s.kind === 'walk') { const from = poiPos[idForName(s.from)] || stationPos[lastStation]; const to = poiPos[idForName(s.to)] || stationPos[lastStation]; vPos.copy(from).lerp(to, k); text = `步行 ${s.from} → ${s.to}（約 ${s.minutes} 分，估算）`; }
        else if (s.kind === 'visit') { vPos.copy(poiPos[s.poi] || stationPos[lastStation]); text = `停留 ${s.name}（${fmt(s.start)}–${fmt(s.end)}）${s.problem ? ' ⚠ ' + s.problem : ''}`; }
        else if (s.kind === 'wait') { vPos.copy(stationPos[s.station]); text = `${sMap[s.station].name} 候車 ${s.minutes} 分`; }
        break;
      }
    }
    if (!cur) { if (min >= timeline.t1) { vPos.copy(stationPos[lastStation]); text = `已回到 ${sMap[lastStation].name}`; } else { vPos.copy(lastPoi && poiPos[lastPoi] ? poiPos[lastPoi] : stationPos[lastStation]); text = `在 ${sMap[lastStation].name}`; } }
    placeTrain(trainU, trainDir); visitor.visible = true; visitor.position.set(vPos.x, Math.max(vPos.y, heightAt(vPos.x, vPos.z) + 0.2), vPos.z);
    hudState = { text, riding: false }; return finish(vPos);
  }
  const nameIndex = {}; for (const p of pois) nameIndex[p.name] = p.id;
  function idForName(n) { return nameIndex[n] || null; }
  function finish(p) { if (follow) focusTarget = new THREE.Vector3(p.x, 0, p.z); return hudState; }
  function fmt(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

  // ---------- loop ----------
  const tmp = new THREE.Vector3(); const m4 = new THREE.Matrix4(); let last = performance.now(); let running = true;
  function project(v) { tmp.copy(v).project(camera); return { x: (tmp.x + 1) / 2 * canvas.clientWidth, y: (1 - tmp.y) / 2 * canvas.clientHeight, visible: tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2 }; }
  function frame(now) {
    if (!running) return; requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (let i = 0; i < LANT; i++) { const d = lantData[i]; d.y += d.v * dt; if (d.y > 34) d.y = 0; const sway = Math.sin(now / 900 + d.w) * 0.8; m4.makeTranslation(d.x + sway, 2 + d.y, d.z); lanterns.setMatrixAt(i, m4); }
    lanterns.instanceMatrix.needsUpdate = true;
    if (focusTarget) { controls.target.lerp(focusTarget, 0.08); if (controls.target.distanceTo(focusTarget) < 0.05) focusTarget = null; }
    controls.update();
    renderer.render(scene, camera);
    if (onFrame) {
      const out = { stations: {}, pois: {} };
      for (const c in stationPos) out.stations[c] = project(stationPos[c].clone().setY(4.2));
      for (const id in poiPos) out.pois[id] = project(poiPos[id].clone().setY(poiPos[id].y + 2.8));
      out.cameraDist = camera.position.distanceTo(controls.target);
      onFrame(out);
    }
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) last = performance.now(); });
  window.addEventListener('resize', resize);

  return { setPlan, setSelected, focusStation, startPreview, stopPreview, setTime, resize, fitCamera, stationPos, dispose() { running = false; renderer.dispose(); } };
}
