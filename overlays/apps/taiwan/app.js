// 台灣此刻 — one page for everything over Taiwan. 地圖 tab layers: wind/temp/rain/PM2.5 forecast field, Himawari cloud loop,
// earthquakes, scenic-spot sky forecasts, 海況 (waves / sea temperature) and beach scores. The other tabs host the stand-alone tools (星空, 天象曆, 立體光影, 聲音) in embed mode.
import { GRID, gridPoints, toUV, fromUV, sample, beaufort, dirName, summarize, speedColor, tempColor, pmBand } from './lib/field.js';
import { LAYERS as CLOUD, tileUrl, candidateTimes, probeUrl } from './lib/frames.js';
import { SPOTS, MODES, dest, at, glowScore, starScore, seaScore } from './lib/model.js';
import { BEACHES, BEACH_MODE, sampleSea, waveColor, sstColor, WAVE_STOPS, SST_STOPS, bestHour } from './lib/sea.js';

const A = window.Astronomy, $ = s => document.querySelector(s);
const store = { get(k, d) { try { const v = localStorage.getItem('twnow.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('twnow.' + k, JSON.stringify(v)); } catch {} } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FMT = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const MDHM = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const HM = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
const MD = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
const hourTPE = () => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ui = {
  bg: store.get('bg', 'wind'), wind: store.get('wind', true), cloud: store.get('cloud', 'off'), quake: store.get('quake', true),
  spot: store.get('spot', 'off'), spotDay: 0, hour: 0, playing: false, tab: 'map',
};

// ================= tabs (one page; other tools load lazily in embed mode)
const FRAMES = { sky: '../sky/', almanac: '../almanac/', relief: '../relief/', sound: '../sound/' };
function setTab(t) {
  if (t !== 'map' && !FRAMES[t]) t = 'map';
  ui.tab = t;
  document.querySelectorAll('[data-tab]').forEach(a => a.setAttribute('aria-selected', String(a.dataset.tab === t)));
  $('#tab-map').hidden = t !== 'map'; $('#tab-frame').hidden = t === 'map';
  for (const f of document.querySelectorAll('#frames iframe')) f.hidden = f.dataset.tab !== t;
  if (t !== 'map' && !document.querySelector(`#frames iframe[data-tab="${t}"]`)) {
    const f = document.createElement('iframe'); f.dataset.tab = t; f.title = document.querySelector(`[data-tab="${t}"]`).textContent;
    f.src = FRAMES[t] + '?embed=1'; f.allow = 'autoplay; accelerometer; gyroscope; magnetometer; geolocation; fullscreen'; $('#frames').append(f);
  }
  if (t === 'map') setTimeout(() => { map.invalidateSize(); rebuild(); }, 0);
}
addEventListener('hashchange', () => setTab(location.hash.slice(1) || 'map'));

// ================= map
const map = L.map('map', { zoomControl: true, minZoom: 5, maxZoom: 10, maxBounds: [[15, 112], [32, 130]] }).fitBounds([[21.8, 119.2], [25.5, 122.2]]);
map.attributionControl.setPrefix('');
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles © Esri' }).addTo(map);
map.createPane('clouds').style.zIndex = 300;
const wpane = map.createPane('wind'); wpane.style.zIndex = 450; wpane.style.pointerEvents = 'none';
const lpane = map.createPane('labels'); lpane.style.zIndex = 460; lpane.style.pointerEvents = 'none';
map.createPane('marks').style.zIndex = 620;
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'labels' }).addTo(map);

// ================= forecast field (wind / temp / rain / PM2.5)
const POINTS = gridPoints(), CACHE = `grid${GRID.rows}x${GRID.cols}@${GRID.step}`;
let frames = [], times = [], aqOK = false, seaOK = null;   // seaOK null = still loading
const MARINE = 'https://marine-api.open-meteo.com/v1/marine', MVARS = 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,sea_surface_temperature';
async function loadField() {
  let raw = store.get(CACHE, null);
  if (!raw || Date.now() - raw.at > 45 * 60000) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${POINTS.map(p => p[0]).join(',')}&longitude=${POINTS.map(p => p[1]).join(',')}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation&wind_speed_unit=ms&timezone=GMT&forecast_days=3`;
    const r = await fetch(url); if (!r.ok) throw new Error('Open-Meteo ' + r.status);
    const j = await r.json(), arr = Array.isArray(j) ? j : [j], t = arr[0].hourly.time.map(x => Date.parse(x + 'Z'));
    const start = Math.max(0, t.findIndex(x => x > Date.now() - 3600e3)), end = Math.min(t.length, start + 49);
    const pick = k => arr.map(x => x.hourly[k].slice(start, end).map(v => Math.round((v ?? 0) * 10) / 10));
    raw = { at: Date.now(), t: t.slice(start, end), spd: pick('wind_speed_10m'), dir: pick('wind_direction_10m'), gust: pick('wind_gusts_10m'), temp: pick('temperature_2m'), rain: pick('precipitation') };
    store.set(CACHE, raw);
  }
  let aq = store.get(CACHE + 'aq', null);
  if (!aq || Date.now() - aq.at > 90 * 60000) {
    try {
      const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${POINTS.map(p => p[0]).join(',')}&longitude=${POINTS.map(p => p[1]).join(',')}&hourly=pm2_5&timezone=GMT&forecast_days=3`);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(), arr = Array.isArray(j) ? j : [j];
      aq = { at: Date.now(), t: arr[0].hourly.time.map(x => Date.parse(x + 'Z')), pm: arr.map(x => x.hourly.pm2_5.map(v => v == null ? null : Math.round(v))) };
      store.set(CACHE + 'aq', aq);
    } catch { aq = null; }
  }
  aqOK = !!aq; times = raw.t;
  frames = times.map((_, h) => {
    const n = POINTS.length, f = { u: new Float32Array(n), v: new Float32Array(n), t: new Float32Array(n), p: new Float32Array(n), g: new Float32Array(n) };
    for (let k = 0; k < n; k++) { const [u, v] = toUV(raw.spd[k][h], raw.dir[k][h]); f.u[k] = u; f.v[k] = v; f.t[k] = raw.temp[k][h]; f.p[k] = raw.rain[k][h]; f.g[k] = raw.gust[k][h]; }
    const ai = aq ? aq.t.indexOf(times[h]) : -1;
    if (ai >= 0) { f.a = new Float32Array(n); for (let k = 0; k < n; k++) f.a[k] = aq.pm[k][ai] ?? 0; }
    return f;
  });
  ui.hour = Math.max(0, times.findIndex(x => x > Date.now()) - 1); $('#slider').max = String(times.length - 1);
}
// 海況 grid, loaded after the weather so it never delays the first paint; trimmed to the forecast hours before caching
async function loadSea() {
  let sea = store.get(CACHE + 'sea', null);
  if (!sea || Date.now() - sea.at > 90 * 60000 || sea.t[0] > times[0]) {
    // cell_selection=nearest keeps land points null (the default 'sea' would snap them to the nearest water cell)
    const r = await fetch(`${MARINE}?latitude=${POINTS.map(p => p[0]).join(',')}&longitude=${POINTS.map(p => p[1]).join(',')}&hourly=${MVARS}&cell_selection=nearest&timezone=GMT&forecast_days=3`);
    if (!r.ok) throw new Error('marine ' + r.status);
    const j = await r.json(), arr = Array.isArray(j) ? j : [j], t = arr[0].hourly.time.map(x => Date.parse(x + 'Z'));
    const start = Math.max(0, t.indexOf(times[0])), q = (k, d) => arr.map(x => x.hourly[k].slice(start, start + 49).map(v => v == null ? null : Math.round(v * d) / d));
    sea = { at: Date.now(), t: t.slice(start, start + 49), wh: q('wave_height', 100), wd: q('wave_direction', 1), wp: q('wave_period', 10), sh: q('swell_wave_height', 100), sp: q('swell_wave_period', 10), sst: q('sea_surface_temperature', 10) };
    store.set(CACHE + 'sea', sea);
  }
  frames.forEach((f, h) => {
    const si = sea.t.indexOf(times[h]); if (si < 0) return;
    for (const key of ['wh', 'wd', 'wp', 'sh', 'sp', 'sst']) { f[key] = new Float32Array(POINTS.length); for (let k = 0; k < POINTS.length; k++) f[key][k] = sea[key][k][si] ?? NaN; }
  });
  seaOK = true;
}
const bg = document.createElement('canvas'), fg = document.createElement('canvas');
for (const c of [bg, fg]) { c.className = 'overlay'; wpane.appendChild(c); }
const bctx = bg.getContext('2d'), fctx = fg.getContext('2d');
let W = 0, H = 0, STEP = 3, gw = 0, gh = 0, fu = null, fv = null;
function rebuild() {
  if (ui.tab !== 'map') return;
  const r = map.getContainer().getBoundingClientRect(), DPR = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height;
  for (const c of [bg, fg]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); c.style.width = W + 'px'; c.style.height = H + 'px'; }
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0); fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const tl = map.containerPointToLayerPoint([0, 0]); L.DomUtil.setPosition(bg, tl); L.DomUtil.setPosition(fg, tl);
  bctx.clearRect(0, 0, W, H); fctx.clearRect(0, 0, W, H);
  if (!frames.length) return;
  const f = frames[ui.hour]; gw = Math.ceil(W / STEP) + 1; gh = Math.ceil(H / STEP) + 1;
  fu = new Float32Array(gw * gh); fv = new Float32Array(gw * gh);
  const img = ui.bg !== 'none' ? bctx.createImageData(gw, gh) : null;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const ll = map.containerPointToLatLng([x * STEP, y * STEP]), s = sample(f, ll.lat, ll.lng), k = y * gw + x;
    if (!s) { fu[k] = NaN; continue; }
    fu[k] = s.u; fv[k] = s.v;
    if (!img) continue;
    const sp = Math.hypot(s.u, s.v); let c = [0, 0, 0], a = 0;
    if (ui.bg === 'wind') { c = speedColor(sp); a = Math.min(110, 20 + sp * 8); }
    else if (ui.bg === 'temp') { c = tempColor(s.t); a = 120; }
    else if (ui.bg === 'rain' && s.p >= 0.1) { c = s.p < 1 ? [80, 160, 220] : s.p < 5 ? [60, 110, 230] : s.p < 15 ? [150, 80, 220] : [230, 60, 160]; a = 150; }
    else if (ui.bg === 'aq' && s.a != null) { c = pmBand(s.a).color; a = 135; }
    else if (ui.bg === 'wave' || ui.bg === 'sst') { const m = sampleSea(f, ll.lat, ll.lng), x = m && (ui.bg === 'wave' ? m.wh : m.sst); if (x != null) { c = ui.bg === 'wave' ? waveColor(x) : sstColor(x); a = 140; } }
    img.data.set([c[0], c[1], c[2], a], k * 4);
  }
  if (img) { const off = document.createElement('canvas'); off.width = gw; off.height = gh; off.getContext('2d').putImageData(img, 0, 0); bctx.imageSmoothingEnabled = true; bctx.drawImage(off, 0, 0, gw * STEP, gh * STEP); }
  seed(); if (ui.wind && reduced) drawArrows();
}
const field = (x, y) => {
  const gx = x / STEP, gy = y / STEP, i = Math.floor(gx), j = Math.floor(gy);
  if (!fu || i < 0 || j < 0 || i >= gw - 1 || j >= gh - 1) return null;
  const k = j * gw + i; if (Number.isNaN(fu[k]) || Number.isNaN(fu[k + 1]) || Number.isNaN(fu[k + gw]) || Number.isNaN(fu[k + gw + 1])) return null;
  const fx = gx - i, fy = gy - j, bl = a => a[k] * (1 - fx) * (1 - fy) + a[k + 1] * fx * (1 - fy) + a[k + gw] * (1 - fx) * fy + a[k + gw + 1] * fx * fy;
  return [bl(fu), bl(fv)];
};
let parts = [];
function seed() { parts = Array.from({ length: Math.min(4000, Math.round(W * H / 280)) }, () => spawn({})); }
function spawn(p) { for (let n = 0; n < 20; n++) { p.x = Math.random() * W; p.y = Math.random() * H; if (field(p.x, p.y)) break; } p.age = Math.floor(Math.random() * 90); return p; }
let lastT = 0;
function tick(ts) {
  requestAnimationFrame(tick);
  if (!ui.wind || reduced || ui.tab !== 'map' || ts - lastT < 30 || !fu) return; lastT = ts;
  fctx.globalCompositeOperation = 'destination-in'; fctx.fillStyle = 'rgba(0,0,0,0.93)'; fctx.fillRect(0, 0, W, H);
  fctx.globalCompositeOperation = 'source-over'; fctx.lineWidth = 1.2;
  const paths = Array.from({ length: 8 }, () => new Path2D());
  for (const p of parts) {
    const v = field(p.x, p.y); if (!v || p.age > 100) { spawn(p); p.age = 0; continue; }
    const nx = p.x + v[0] * 0.42, ny = p.y - v[1] * 0.42, b = Math.min(7, Math.floor(Math.hypot(v[0], v[1]) / 2.5));
    paths[b].moveTo(p.x, p.y); paths[b].lineTo(nx, ny); p.x = nx; p.y = ny; p.age++;
  }
  paths.forEach((path, b) => { const c = speedColor(b * 2.5 + 1.25); fctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.9)`; fctx.stroke(path); });
}
requestAnimationFrame(tick);
function drawArrows() {
  fctx.clearRect(0, 0, W, H); fctx.lineWidth = 1.4;
  for (let y = 18; y < H; y += 34) for (let x = 18; x < W; x += 34) {
    const v = field(x, y); if (!v) continue; const s = Math.hypot(v[0], v[1]); if (s < 0.3) continue;
    const Lh = Math.min(16, 5 + s * 1.2), ux = v[0] / s, uy = -v[1] / s, c = speedColor(s); fctx.strokeStyle = `rgb(${c})`; fctx.beginPath();
    const x2 = x + ux * Lh, y2 = y + uy * Lh; fctx.moveTo(x - ux * Lh / 2, y - uy * Lh / 2); fctx.lineTo(x2, y2); fctx.lineTo(x2 - ux * 5 - uy * 3.5, y2 - uy * 5 + ux * 3.5); fctx.moveTo(x2, y2); fctx.lineTo(x2 - ux * 5 + uy * 3.5, y2 - uy * 5 - ux * 3.5); fctx.stroke();
  }
}
map.on('movestart zoomstart', () => { bg.style.opacity = fg.style.opacity = '0'; });
map.on('moveend zoomend', () => { rebuild(); bg.style.opacity = fg.style.opacity = '1'; });
addEventListener('resize', () => { map.invalidateSize(); rebuild(); });

const CITIES = [['臺北', 25.03, 121.56], ['基隆', 25.13, 121.74], ['新竹', 24.80, 120.97], ['苗栗', 24.56, 120.82], ['臺中', 24.15, 120.67], ['彰化', 24.08, 120.54], ['南投', 23.91, 120.68], ['雲林', 23.71, 120.54],
  ['嘉義', 23.48, 120.45], ['臺南', 23.00, 120.23], ['高雄', 22.63, 120.30], ['屏東', 22.67, 120.49], ['恆春', 22.00, 120.75], ['宜蘭', 24.76, 121.75], ['花蓮', 23.98, 121.60], ['臺東', 22.76, 121.14],
  ['澎湖', 23.57, 119.58], ['蘭嶼', 22.05, 121.55], ['綠島', 22.66, 121.49], ['金門', 24.44, 118.32], ['馬祖', 26.16, 119.95], ['玉山', 23.47, 120.96]];
const DIR8 = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
function placeLabel(lat, lon) {
  let b = null; for (const [n, a, o] of CITIES) { const d = Math.hypot(a - lat, (o - lon) * Math.cos(lat * Math.PI / 180)) * 111; if (!b || d < b.d) b = { n, d, a, o }; }
  if (b.d < 4) return `${b.n}附近`; if (b.d > 350) return null;
  return `${b.n}${DIR8[Math.round(((Math.atan2((lon - b.o) * Math.cos(lat * Math.PI / 180), lat - b.a) * 180 / Math.PI) + 360) % 360 / 45) % 8]}方 ${Math.round(b.d)} 公里`;
}
map.on('click', e => {
  const s = frames.length ? sample(frames[ui.hour], e.latlng.lat, e.latlng.lng) : null;
  if (!s) return;
  const [sp, dir] = fromUV(s.u, s.v), bf = beaufort(sp), m = sampleSea(frames[ui.hour], e.latlng.lat, e.latlng.lng);
  const sea = !m ? '' : [m.wh != null ? `浪高 ${m.wh.toFixed(1)} m${m.wp != null ? `・週期 ${m.wp.toFixed(1)} 秒` : ''}${m.wd != null ? `（浪從${dirName(m.wd).slice(0, -1)}來）` : ''}` : '',
    [m.sh != null ? `湧浪 ${m.sh.toFixed(1)} m${m.sp != null ? `／${m.sp.toFixed(1)} 秒` : ''}` : '', m.sst != null ? `海溫 ${m.sst.toFixed(1)}°C` : ''].filter(Boolean).join('・')].filter(Boolean).join('<br>');
  L.popup().setLatLng(e.latlng).setContent(`<b>${dirName(dir)} ${bf.level} 級</b>（${bf.name}）<br>風速 ${sp.toFixed(1)} m/s・陣風 ${s.g.toFixed(1)} m/s<br>氣溫 ${s.t.toFixed(1)}°C・降雨 ${s.p.toFixed(1)} mm/時${s.a != null ? `<br>PM2.5 ${Math.round(s.a)} µg/m³（${pmBand(s.a).name}）` : ''}${sea ? `<br>${sea}` : ''}<br><span style="color:var(--ink3)">${placeLabel(e.latlng.lat, e.latlng.lng) || ''}・${FMT.format(new Date(times[ui.hour]))}</span>`).openOn(map);
});
function setHour(h) {
  if (!frames.length) return;
  ui.hour = Math.max(0, Math.min(times.length - 1, h)); $('#slider').value = String(ui.hour);
  const isNow = Math.abs(times[ui.hour] - Date.now()) < 3600e3;
  $('#clock').textContent = FMT.format(new Date(times[ui.hour])) + (isNow ? '・現在' : '');
  map.closePopup(); rebuild(); renderSummary();
}
$('#slider').addEventListener('input', e => setHour(+e.target.value));
let playT = null;
$('#play').addEventListener('click', () => {
  ui.playing = !ui.playing; $('#play').setAttribute('aria-pressed', String(ui.playing)); $('#play').textContent = ui.playing ? '❚❚' : '▶';
  clearInterval(playT); if (ui.playing) playT = setInterval(() => setHour(ui.hour + 1 >= times.length ? 0 : ui.hour + 1), 900);
});

// ================= clouds (Himawari via GIBS)
let cloudLayers = [], cloudTimes = [], cloudI = 0, cloudTimer = null, cloudGen = 0;
const probe = (layer, iso) => new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = probeUrl(layer, iso); });
async function buildClouds() {
  const my = ++cloudGen; clearTimeout(cloudTimer); cloudLayers.forEach(l => l.remove()); cloudLayers = []; cloudTimes = []; $('#stamp').hidden = true;
  if (ui.cloud === 'off') return;
  const c = candidateTimes(Date.now(), 3, 20), ok = await Promise.all(c.map(t => probe(ui.cloud, t)));
  if (my !== cloudGen) return;
  cloudTimes = c.filter((_, k) => ok[k]).reverse();
  if (!cloudTimes.length) { $('#stamp').hidden = false; $('#stamp').textContent = '雲圖暫時讀不到'; return; }
  const L0 = CLOUD[ui.cloud];
  cloudLayers = cloudTimes.map(iso => L.tileLayer(tileUrl(ui.cloud, iso), { pane: 'clouds', maxNativeZoom: L0.native, maxZoom: 10, opacity: 0, attribution: 'Himawari-9 / JMA via NASA GIBS' }).addTo(map));
  showCloud(cloudTimes.length - 1);
  if (!reduced) { const step = () => { const n = cloudI + 1 >= cloudTimes.length ? 0 : cloudI + 1; showCloud(n); cloudTimer = setTimeout(step, n === cloudTimes.length - 1 ? 1600 : 450); }; cloudTimer = setTimeout(step, 1600); }
}
function showCloud(i) {
  cloudI = i; cloudLayers.forEach((l, k) => l.setOpacity(k === i ? 0.85 : 0));
  const t = new Date(cloudTimes[i]); $('#stamp').hidden = false; $('#stamp').textContent = `雲圖 ${MDHM.format(t)}・${Math.round((Date.now() - t) / 60000)} 分鐘前`;
}

// ================= earthquakes (USGS, past 30 days, M2.5+)
const qLayer = L.layerGroup().addTo(map); let quakes = [];
async function loadQuakes() {
  try {
    const j = await (await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson')).json();
    quakes = j.features.filter(f => { const [lo, la] = f.geometry.coordinates; return la > 20 && la < 27 && lo > 117.5 && lo < 125; })
      .map(f => ({ id: f.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: f.geometry.coordinates[2], mag: f.properties.mag, t: f.properties.time, place: f.properties.place, url: f.properties.url }))
      .sort((a, b) => b.t - a.t);
  } catch { quakes = null; }
  drawQuakes();
}
const qColor = m => m < 3 ? '#4f9a63' : m < 4 ? '#c99a1c' : m < 5 ? '#e07a22' : m < 6 ? '#d0432b' : '#8e1f4f';
function drawQuakes() {
  qLayer.clearLayers();
  const ol = $('#quakeList');
  if (quakes === null) { ol.innerHTML = '<li class="empty">讀不到地震資料。</li>'; return; }
  if (!quakes.length) { ol.innerHTML = '<li class="empty">過去 30 天台灣附近沒有規模 2.5 以上的地震紀錄。</li>'; return; }
  ol.replaceChildren(...quakes.map(q => {
    const where = placeLabel(q.lat, q.lon) || q.place, ago = Math.round((Date.now() - q.t) / 86400000);
    if (ui.quake) L.circleMarker([q.lat, q.lon], { pane: 'marks', radius: 4 + (q.mag - 2.5) * 3.4, color: qColor(q.mag), weight: 1.5, fillColor: qColor(q.mag), fillOpacity: Date.now() - q.t < 86400e3 ? 0.75 : 0.4 })
      .bindPopup(`<b>規模 ${q.mag.toFixed(1)}</b>　${esc(where)}<br>${MDHM.format(new Date(q.t))}・深 ${Math.round(q.depth)} 公里<br><a href="${q.url}" target="_blank" rel="noopener">USGS 詳細資料 →</a>`).addTo(qLayer);
    const li = document.createElement('li'); li.tabIndex = 0;
    li.innerHTML = `<span class="badge" style="background:${qColor(q.mag)}">${q.mag.toFixed(1)}</span><span>${esc(where)}<br><span class="meta">${MDHM.format(new Date(q.t))}・${ago ? ago + ' 天前' : '今天'}・深 ${Math.round(q.depth)} 公里</span></span>`;
    const go = () => { map.flyTo([q.lat, q.lon], 8, { duration: reduced ? 0 : 0.6 }); };
    li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    return li;
  }));
}

// ================= scenic spots (火燒雲 / 日出 / 觀星 / 雲海)
const sLayer = L.layerGroup().addTo(map); let spotWx = null;
const midnight = n => new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()) + 'T00:00:00+08:00').getTime() + n * 86400000;
function sunEvents(s, day) {
  const o = new A.Observer(s.lat, s.lon, s.alt || 0), t0 = new Date(midnight(day));
  const rise = A.SearchRiseSet('Sun', o, +1, t0, 1)?.date, set = A.SearchRiseSet('Sun', o, -1, t0, 1)?.date;
  const az = d => { const e = A.Equator('Sun', d, o, true, true); return A.Horizon(d, o, e.ra, e.dec, null).azimuth; };
  return { rise, set, riseAz: rise && az(rise), setAz: set && az(set) };
}
async function loadSpots() {
  const c = store.get('spots', null);
  if (c && Date.now() - c.at < 30 * 60000) { spotWx = c.data; return; }
  const geo = SPOTS.map(s => { const e = sunEvents(s, 0); return { setPt: dest(s.lat, s.lon, e.setAz, 150), risePt: dest(s.lat, s.lon, e.riseAz, 150) }; });
  const pts = [...SPOTS.map(s => [s.lat, s.lon]), ...geo.map(g => g.setPt), ...geo.map(g => g.risePt)];
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pts.map(p => p[0]).join(',')}&longitude=${pts.map(p => p[1]).join(',')}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,visibility,precipitation_probability&timezone=GMT&forecast_days=4`);
  if (!r.ok) throw new Error(r.status);
  const j = await r.json(), arr = Array.isArray(j) ? j : [j], n = SPOTS.length;
  const pack = h => ({ t: h.time.map(x => Date.parse(x + 'Z')), cloud: h.cloud_cover, low: h.cloud_cover_low, mid: h.cloud_cover_mid, high: h.cloud_cover_high, hum: h.relative_humidity_2m, vis: h.visibility, rain: h.precipitation_probability });
  spotWx = { here: arr.slice(0, n).map(x => pack(x.hourly)), toSet: arr.slice(n, 2 * n).map(x => pack(x.hourly)), toRise: arr.slice(2 * n).map(x => pack(x.hourly)) };
  store.set('spots', { at: Date.now(), data: spotWx });
}
// beaches: one multi-location marine call on each beach's sea cell (default cell_selection=sea, so always over water)
let beachWx = null, beachErr = false;
async function loadBeaches() {
  const c = store.get('beach', null);
  if (c && Date.now() - c.at < 60 * 60000) { beachWx = c.data; return; }
  const r = await fetch(`${MARINE}?latitude=${BEACHES.map(b => b.sea[0]).join(',')}&longitude=${BEACHES.map(b => b.sea[1]).join(',')}&hourly=${MVARS}&timezone=GMT&forecast_days=3`);
  if (!r.ok) throw new Error(r.status);
  const j = await r.json(), arr = Array.isArray(j) ? j : [j];
  beachWx = { t: arr[0].hourly.time.map(x => Date.parse(x + 'Z')), b: arr.map(x => ({ wh: x.hourly.wave_height, wp: x.hourly.wave_period, sh: x.hourly.swell_wave_height, sp: x.hourly.swell_wave_period, sst: x.hourly.sea_surface_temperature })) };
  store.set('beach', { at: Date.now(), data: beachWx });
}
// daytime hours (08–17 Taipei) of the day; today only the hours still ahead when any are left
function beachHours(b, i, day) {
  const from = midnight(day) + 8 * 3600e3, now = Math.floor(Date.now() / 3600e3) * 3600e3, out = [];
  for (let t = from; t <= from + 9 * 3600e3; t += 3600e3) {
    const k = beachWx.t.indexOf(t); if (k < 0) continue;
    const w = beachWx.b[i], h = times.indexOf(t), s = h >= 0 ? sample(frames[h], b.lat, b.lon) : null, [ws, wd] = s ? fromUV(s.u, s.v) : [null, null];
    out.push({ t, wh: w.wh[k], wp: w.wp[k], sh: w.sh[k], sp: w.sp[k], sst: w.sst[k], wind: ws, windFrom: wd, rain: s ? s.p : 0, face: b.face });
  }
  const ahead = out.filter(x => x.t >= now);
  return day === 0 && ahead.length ? ahead : out;
}
const val = (w, k, t) => at(w[k].map(v => v ?? 0), w.t, t);
function scoreSpots(mode, day) {
  const out = [];
  if (mode === 'beach') {
    if (beachWx) BEACHES.forEach((b, i) => { const best = bestHour(beachHours(b, i, day)); if (best) out.push({ s: b, ...best, t: new Date(best.t) }); });
    return out.sort((a, b) => b.score - a.score);
  }
  SPOTS.forEach((s, i) => {
    if (!s.kinds.split(' ').includes(mode)) return;
    const ev = sunEvents(s, day), here = spotWx.here[i], mountain = (s.alt || 0) >= 1500;
    if (mode === 's' || mode === 'r') {
      const t = mode === 's' ? ev.set : ev.rise, far = mode === 's' ? spotWx.toSet[i] : spotWx.toRise[i];
      const w = { high: val(here, 'high', t), mid: val(here, 'mid', t), lowHere: mountain ? 0 : val(here, 'low', t), lowSun: mountain ? Math.min(val(far, 'low', t), 40) : val(far, 'low', t), rain: val(here, 'rain', t), vis: val(here, 'vis', t) };
      out.push({ s, t, ...glowScore(w) });
    } else if (mode === 'star') {
      const o = new A.Observer(s.lat, s.lon, s.alt || 0), from = new Date(+ev.set + 90 * 60000), to = new Date(+sunEvents(s, day + 1).rise - 90 * 60000), hours = [];
      for (let t = Math.ceil(+from / 3600e3) * 3600e3; t <= +to; t += 3600e3) { const d = new Date(t), eq = A.Equator('Moon', d, o, true, true); hours.push({ t, cloud: val(here, 'cloud', d), mid: val(here, 'mid', d), high: val(here, 'high', d), rain: val(here, 'rain', d), hum: val(here, 'hum', d), moonAlt: A.Horizon(d, o, eq.ra, eq.dec, null).altitude, moonFrac: A.Illumination('Moon', d).phase_fraction }); }
      out.push({ s, t: from, ...starScore(hours, s.bortle, mountain) });
    } else {
      const t = ev.rise; out.push({ s, t, ...seaScore({ low: val(here, 'low', t), mid: val(here, 'mid', t), high: val(here, 'high', t), rain: val(here, 'rain', t), hum: val(here, 'hum', t) }, s.alt || 0) });
    }
  });
  return out.sort((a, b) => b.score - a.score);
}
const SMODES = { ...MODES, beach: BEACH_MODE };
const sColor = (mode, v) => mode === 'beach' ? (v >= 60 ? '#13897a' : v >= 40 ? '#3a9e8c' : v >= 20 ? '#6aa69a' : '#6d665e') : mode === 'star' ? (v >= 65 ? '#5867c4' : v >= 45 ? '#6b78b8' : v >= 25 ? '#8e95b8' : '#6d665e') : mode === 'sea' ? (v >= 65 ? '#4f93ae' : v >= 40 ? '#6fa3b8' : v >= 20 ? '#90b2c0' : '#6d665e') : (v >= 70 ? '#b0204a' : v >= 45 ? '#d24b2a' : v >= 25 ? '#e5823d' : v >= 12 ? '#d9a548' : '#6d665e');
function drawSpots() {
  sLayer.clearLayers();
  const dl = ['今天', '明天', '後天'];
  $('#spotDays').replaceChildren(...dl.map((l, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${l} ${MD.format(new Date(midnight(i)))}`; b.setAttribute('aria-pressed', String(i === ui.spotDay)); b.onclick = () => { ui.spotDay = i; drawSpots(); }; return b; }));
  $('#spotDays').hidden = ui.spot === 'off';
  const ol = $('#spotList'), mode = ui.spot === 'off' ? 's' : ui.spot;
  $('#spotTitle').textContent = `${dl[ui.spotDay]}${SMODES[mode].label}排名`;
  if (mode === 'beach' ? !beachWx : !spotWx) { ol.innerHTML = `<li class="empty">${mode === 'beach' && beachErr ? '海況預報暫時讀不到。' : '讀取景點預報中…'}</li>`; return; }
  const rows = scoreSpots(mode, ui.spotDay);
  if (ui.spot !== 'off') for (const r of rows) {
    L.marker([r.s.lat, r.s.lon], { pane: 'marks', icon: L.divIcon({ className: '', html: `<div class="pin" style="width:28px;height:28px;background:${sColor(mode, r.score)}">${r.score}</div>`, iconSize: [28, 28] }) })
      .bindPopup(`<b>${esc(r.s.name)}</b>　${r.score} 分・${esc(r.level)}<br>${mode === 'beach' ? `最佳 ${HM.format(r.t)}${r.s.note ? `（${esc(r.s.note)}）` : ''}` : mode === 'star' ? (r.best ? `最佳 ${HM.format(new Date(r.best.from))}–${HM.format(new Date(r.best.to))}` : '') : `${mode === 's' ? '日落' : '日出'} ${HM.format(r.t)}`}<br><span style="color:var(--ink3)">${r.why.map(esc).join('；')}</span>`).addTo(sLayer);
  }
  ol.replaceChildren(...rows.slice(0, 10).map(r => {
    const li = document.createElement('li'); li.tabIndex = 0;
    li.innerHTML = `<span class="badge" style="background:${sColor(mode, r.score)}">${r.score}</span><span>${esc(r.s.name)}　<span class="meta">${esc(r.level)}</span><br><span class="meta">${esc(r.why[0])}</span></span>`;
    const go = () => { if (ui.spot === 'off') { ui.spot = mode; store.set('spot', mode); syncButtons(); drawSpots(); } map.flyTo([r.s.lat, r.s.lon], 9, { duration: reduced ? 0 : 0.6 }); };
    li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    return li;
  }));
}

// ================= summary + controls
function renderSummary() {
  const parts = [];
  if (frames.length) { const sm = summarize(frames[ui.hour], POINTS), bf = beaufort(sm.max.speed); parts.push(`${Math.abs(times[ui.hour] - Date.now()) < 3600e3 ? '現在' : FMT.format(new Date(times[ui.hour]))}台灣附近吹${dirName(sm.dir)}，最強在${placeLabel(sm.max.lat, sm.max.lon) || '外海'}約 ${sm.max.speed.toFixed(0)} m/s（${bf.level} 級）。`); }
  if (quakes && quakes.length) { const q = quakes[0]; parts.push(`最近一次地震：${MDHM.format(new Date(q.t))} ${placeLabel(q.lat, q.lon) || q.place} 規模 ${q.mag.toFixed(1)}。`); }
  if (spotWx) { const h = hourTPE(), mode = h < 6 ? 'r' : h < 19 ? 's' : 'star', best = scoreSpots(mode, h < 6 || h < 19 ? 0 : 0)[0]; if (best) parts.push(`${mode === 's' ? '今天傍晚火燒雲' : mode === 'r' ? '今天日出' : '今晚觀星'}最看好：${best.s.name}（${best.score} 分）。`); }
  $('#summary').textContent = parts.join('') || '讀取資料中…';
}
function legend() {
  const out = [];
  if (ui.bg === 'wind' || ui.wind) out.push(`風速 m/s 0<span class="bar" style="background:linear-gradient(90deg,${[0, 5, 10, 15, 22].map(s => `rgb(${speedColor(s)})`).join(',')})"></span>22`);
  if (ui.bg === 'temp') out.push(`氣溫 °C 10<span class="bar" style="background:linear-gradient(90deg,${[10, 20, 28, 34].map(t => `rgb(${tempColor(t)})`).join(',')})"></span>34`);
  if (ui.bg === 'rain') out.push('降雨 <span style="color:#50a0dc">■ &lt;1</span> <span style="color:#3c6ee6">■ 1–5</span> <span style="color:#9650dc">■ 5–15</span> <span style="color:#e63ca0">■ 15+ mm/時</span>');
  if (ui.bg === 'aq') out.push(aqOK ? 'PM2.5 <span style="color:rgb(70,190,110)">■ 良好</span> <span style="color:rgb(235,210,70)">■ 普通</span> <span style="color:rgb(240,140,50)">■ 敏感族群</span> <span style="color:rgb(220,50,50)">■ 不健康</span>' : 'PM2.5 資料暫時讀不到');
  if (ui.bg === 'wave') out.push(seaOK ? `浪高 m 0<span class="bar" style="background:linear-gradient(90deg,${WAVE_STOPS.map(([, c]) => `rgb(${c})`).join(',')})"></span>6　陸地不上色` : seaOK === null ? '讀取海況中…' : '海況資料暫時讀不到');
  if (ui.bg === 'sst') out.push(seaOK ? `海溫 °C 20<span class="bar" style="background:linear-gradient(90deg,${SST_STOPS.map(([, c]) => `rgb(${c})`).join(',')})"></span>31` : seaOK === null ? '讀取海況中…' : '海況資料暫時讀不到');
  if (ui.cloud !== 'off') out.push(CLOUD[ui.cloud].note);
  $('#legend').innerHTML = out.map(x => `<span>${x}</span>`).join('');
}
function syncButtons() {
  document.querySelectorAll('[data-bg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bg === ui.bg)));
  document.querySelectorAll('[data-cloud]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cloud === ui.cloud)));
  document.querySelectorAll('[data-spot]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.spot === ui.spot)));
  $('#lyWind').checked = ui.wind; $('#lyQuake').checked = ui.quake; legend();
}
document.querySelectorAll('[data-bg]').forEach(b => b.addEventListener('click', () => { ui.bg = b.dataset.bg; store.set('bg', ui.bg); syncButtons(); rebuild(); }));
document.querySelectorAll('[data-cloud]').forEach(b => b.addEventListener('click', () => { ui.cloud = b.dataset.cloud; store.set('cloud', ui.cloud);
  if (ui.cloud !== 'off' && ui.bg !== 'none') { ui.bg = 'none'; store.set('bg', 'none'); rebuild(); }  /* clouds read best without a colour wash */ syncButtons(); buildClouds(); }));
document.querySelectorAll('[data-spot]').forEach(b => b.addEventListener('click', () => { ui.spot = b.dataset.spot; store.set('spot', ui.spot); syncButtons(); drawSpots(); }));
$('#lyWind').addEventListener('change', e => { ui.wind = e.target.checked; store.set('wind', ui.wind); fctx.clearRect(0, 0, W, H); if (ui.wind && reduced) drawArrows(); legend(); });
$('#lyQuake').addEventListener('change', e => { ui.quake = e.target.checked; store.set('quake', ui.quake); drawQuakes(); });

// ================= start
syncButtons(); setTab(location.hash.slice(1) || 'map');
loadField().then(() => { setHour(ui.hour); if (ui.spot === 'beach') drawSpots(); loadSea().then(() => { rebuild(); legend(); }).catch(() => { seaOK = false; legend(); }); }).catch(e => { $('#summary').textContent = `天氣預報暫時讀不到（${e.message}）。`; });
loadQuakes().then(renderSummary);
drawSpots(); loadSpots().then(() => { drawSpots(); renderSummary(); }).catch(() => { if (ui.spot !== 'beach') $('#spotList').innerHTML = '<li class="empty">景點預報暫時讀不到。</li>'; });
loadBeaches().then(drawSpots).catch(() => { beachErr = true; drawSpots(); });
buildClouds();
setInterval(() => { if (document.visibilityState === 'visible' && ui.cloud !== 'off') buildClouds(); }, 10 * 60000);
window.__tw = { ui, map, setTab, setHour, get frames() { return frames; }, get quakes() { return quakes; }, get spotWx() { return spotWx; }, get beachWx() { return beachWx; }, get seaOK() { return seaOK; }, scoreSpots };
