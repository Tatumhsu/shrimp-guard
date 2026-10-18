// 此刻台灣的聲音 — live weather → scene → synthesized sound + a matching animated picture.
import { PLACES, ROUND, scene, WMO } from './scene.js';
import { Engine } from './audio.js';

const A = window.Astronomy, $ = s => document.querySelector(s);
const store = { get(k, d) { try { const v = localStorage.getItem('sound.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('sound.' + k, JSON.stringify(v)); } catch {} } };
const ui = { place: PLACES.find(p => p.id === store.get('place', 'taipei')) || PLACES[0], playing: false, round: false };
const DIR8 = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const TPE = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
let engine = null, wx = null, sc = null, quakes = [], bellIdx = 0;

// ---- data
const wxCache = {};
async function weather(p) {
  const c = wxCache[p.id]; if (c && Date.now() - c.at < 15 * 60000) return c.w;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code&wind_speed_unit=ms&timezone=GMT`;
  const r = await fetch(u); if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  const j = (await r.json()).current;
  const w = { temp: j.temperature_2m, hum: j.relative_humidity_2m, rain: Math.max(j.precipitation ?? 0, j.rain ?? 0) * 4, cloud: j.cloud_cover, wind: j.wind_speed_10m, gust: j.wind_gusts_10m, dir: j.wind_direction_10m, code: j.weather_code };
  wxCache[p.id] = { at: Date.now(), w }; return w;   // precipitation is per 15 min → ×4 ≈ mm/h
}
async function loadQuakes() {
  try {
    const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'); const j = await r.json();
    quakes = j.features.filter(f => { const [lo, la] = f.geometry.coordinates; return la > 20.5 && la < 26.8 && lo > 118 && lo < 124.5; })
      .map(f => ({ mag: f.properties.mag, t: f.properties.time, place: f.properties.place })).sort((a, b) => a.t - b.t);
  } catch { quakes = []; }
  $('#quakes').textContent = quakes.length ? `地震鐘：過去 7 天台灣附近 ${quakes.length} 起（最大 M${Math.max(...quakes.map(q => q.mag)).toFixed(1)}），每 25 秒依序敲一次，越大越低沉。` : '地震鐘：過去 7 天台灣附近沒有規模 2.5 以上的地震，鐘聲安靜。';
}
function sunAlt(p, d = new Date()) { const o = new A.Observer(p.lat, p.lon, 0), e = A.Equator('Sun', d, o, true, true); return A.Horizon(d, o, e.ra, e.dec, null).altitude; }

async function refresh() {
  const p = ui.place;
  $('#placeName').textContent = p.name;
  try { wx = await weather(p); } catch (e) { $('#cond').textContent = '讀不到天氣，稍後再試。'; return; }
  const hour = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false }).format(new Date());
  const month = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', month: 'numeric' }).format(new Date());
  const alt = sunAlt(p);
  sc = scene({ ...wx, sunAlt: alt, morning: hour < 12, month }, p);
  $('#cond').textContent = `${Math.round(wx.temp)}°C・${WMO(wx.code)}・${DIR8[Math.round(wx.dir / 45) % 8]}風 ${wx.wind.toFixed(1)} m/s・濕度 ${Math.round(wx.hum)}%`;
  $('#hear').textContent = ui.playing ? `你正在聽：${[...sc.hear, '和弦'].join('、')}` : `按下開始，會聽到：${[...sc.hear, '和弦'].join('、')}`;
  if (engine) engine.set(sc);
  document.querySelectorAll('#places button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === p.id)));
}

// ---- controls
$('#places').append(...PLACES.map(p => { const b = document.createElement('button'); b.type = 'button'; b.dataset.id = p.id; b.textContent = p.name; b.onclick = () => go(p); return b; }));
function go(p) { ui.place = p; store.set('place', p.id); refresh(); }
$('#play').addEventListener('click', async () => {
  if (!engine) {
    engine = new Engine();
    engine.on((kind, d) => events.push({ kind, d, t: performance.now() }));
    document.querySelectorAll('[data-group]').forEach(i => engine.level(i.dataset.group, +i.value));
    if (sc) engine.set(sc);
  }
  ui.playing = !ui.playing;
  if (ui.playing) await engine.resume(); else await engine.suspend();
  $('#play').setAttribute('aria-pressed', String(ui.playing)); $('#play').textContent = ui.playing ? '暫停' : '繼續聆聽';
  refresh();
});
document.querySelectorAll('[data-group]').forEach(i => { const v = store.get('mix.' + i.dataset.group, 1); i.value = v; i.addEventListener('input', () => { store.set('mix.' + i.dataset.group, +i.value); engine?.level(i.dataset.group, +i.value); }); });
let roundT = null;
$('#round').addEventListener('click', () => {
  ui.round = !ui.round; $('#round').setAttribute('aria-pressed', String(ui.round)); clearInterval(roundT);
  if (ui.round) roundT = setInterval(() => { const i = ROUND.indexOf(ui.place.id); go(PLACES.find(p => p.id === ROUND[(i + 1) % ROUND.length])); }, 45000);
});
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5 * 60000);
setInterval(() => {   // earthquake bells
  if (!ui.playing || !quakes.length) return;
  const q = quakes[bellIdx++ % quakes.length]; engine.bell(q.mag); events.push({ kind: 'bell', d: q, t: performance.now() });
  $('#bellNote').textContent = `鐘聲：${TPE.format(new Date(q.t))} 規模 ${q.mag.toFixed(1)}（${q.place}）`;
}, 25000);

// ---- picture
const cv = $('#scene'), cx = cv.getContext('2d'); let W = 0, H = 0;
const events = [], stars = Array.from({ length: 140 }, () => [Math.random(), Math.random() * 0.7, Math.random()]);
const flies = Array.from({ length: 26 }, () => ({ x: Math.random(), y: 0.55 + Math.random() * 0.4, p: Math.random() * 6 }));
const drops = Array.from({ length: 420 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.6 }));
const motes = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), v: 0.3 + Math.random() }));
const flock = [];
function size() { const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', size); size();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000) * (reduced ? 0.25 : 1); last = now;
  const s = sc || { rain: 0, wind: 0.1, sea: 0, insects: 0, birds: 0, night: false, mood: 'clear' }, w = wx || { cloud: 30, dir: 45, wind: 2, temp: 25 };
  const alt = sunAlt(ui.place), dayK = Math.max(0, Math.min(1, (alt + 8) / 16)), grey = Math.min(1, w.cloud / 100) * 0.7 + s.rain * 0.3;
  const top = lerp(lerp([8, 12, 28], [70, 140, 210], dayK), [90, 98, 108].map(x => x * (0.35 + 0.65 * dayK)), grey);
  const low = lerp(lerp([22, 28, 52], [200, 215, 225], dayK), [120, 126, 132].map(x => x * (0.35 + 0.65 * dayK)), grey);
  const warmGlow = alt > -6 && alt < 8 ? 1 - Math.abs(alt - 1) / 7 : 0;
  const g = cx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgb(${top})`); g.addColorStop(0.75, `rgb(${lerp(low, [240, 150, 90], warmGlow * (1 - grey) * 0.7)})`); g.addColorStop(1, `rgb(${low})`);
  cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  // stars
  if (dayK < 0.4 && w.cloud < 75) { cx.fillStyle = '#fff'; for (const [x, y, b] of stars) { cx.globalAlpha = (0.4 - dayK) * 2.2 * (1 - w.cloud / 80) * (0.4 + 0.6 * Math.abs(Math.sin(now / 900 + b * 20))); cx.fillRect(x * W, y * H, 1.5, 1.5); } cx.globalAlpha = 1; }
  // sea / lake
  if (s.sea > 0.03) {
    const base = H * 0.78; for (let k = 0; k < 4; k++) {
      cx.beginPath(); cx.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) cx.lineTo(x, base + k * 16 + Math.sin(x / (90 - k * 10) + now / (1300 - k * 150)) * (4 + s.sea * 14) * (1 - k * 0.15));
      cx.lineTo(W, H); cx.closePath(); cx.fillStyle = `rgba(${lerp([20, 40, 60], [60, 110, 140], dayK)},${0.35 + k * 0.15})`; cx.fill();
    }
  }
  // wind motes / rain
  const wr = (w.dir + 180) * Math.PI / 180, wx_ = Math.sin(wr) * (0.04 + s.wind * 0.6), wy_ = -Math.cos(wr) * (0.04 + s.wind * 0.6) * 0.3;
  if (s.rain > 0.02) {
    const n = Math.floor(drops.length * Math.min(1, s.rain * 1.4)); cx.strokeStyle = `rgba(200,220,235,${0.35 + s.rain * 0.3})`; cx.lineWidth = 1; cx.beginPath();
    for (let i = 0; i < n; i++) { const d = drops[i]; d.y += d.v * dt * 1.6; d.x += wx_ * dt; if (d.y > 1) { d.y = -0.05; d.x = Math.random(); } d.x = (d.x + 1) % 1; cx.moveTo(d.x * W, d.y * H); cx.lineTo(d.x * W - wx_ * 40, d.y * H - 14 - s.rain * 10); }
    cx.stroke();
  } else {
    cx.strokeStyle = 'rgba(255,255,255,.18)'; cx.beginPath();
    for (const m of motes) { m.x = (m.x + wx_ * dt * m.v * 0.8 + 1) % 1; m.y = (m.y + wy_ * dt * m.v + 1) % 1; cx.moveTo(m.x * W, m.y * H); cx.lineTo(m.x * W - wx_ * 60 * m.v, m.y * H - wy_ * 60); }
    cx.stroke();
  }
  // fireflies / insects at night
  if (s.insects > 0.03 || s.frogs > 0.03) for (const f of flies.slice(0, Math.ceil(flies.length * Math.max(s.insects, s.frogs)))) {
    f.p += dt; const a = 0.5 + 0.5 * Math.sin(f.p * 2.2); cx.fillStyle = `rgba(220,255,150,${a * 0.8})`;
    cx.beginPath(); cx.arc((f.x + Math.sin(f.p * 0.4) * 0.02) * W, (f.y + Math.cos(f.p * 0.5) * 0.02) * H, 2, 0, 7); cx.fill();
  }
  // event-driven: birds, bells, thunder
  for (const e of events.splice(0)) {
    if (e.kind === 'bird') flock.push({ x: -0.05, y: 0.15 + Math.random() * 0.35, v: 0.12 + Math.random() * 0.1, t: now });
    if (e.kind === 'bell') ripples.push({ t: now, mag: e.d.mag });
    if (e.kind === 'thunder') flash = 1;
  }
  cx.strokeStyle = 'rgba(30,35,40,.75)'; cx.lineWidth = 1.5;
  for (let i = flock.length - 1; i >= 0; i--) { const b = flock[i]; b.x += b.v * dt; if (b.x > 1.05) { flock.splice(i, 1); continue; } const X = b.x * W, Y = b.y * H, f = Math.sin(now / 90 + i) * 4; cx.beginPath(); cx.moveTo(X - 7, Y - f); cx.lineTo(X, Y); cx.lineTo(X + 7, Y - f); cx.stroke(); }
  for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i], age = (now - r.t) / 1000; if (age > 6) { ripples.splice(i, 1); continue; } for (let k = 0; k < 3; k++) { const rr = (age - k * 0.6) * (60 + r.mag * 25); if (rr <= 0) continue; cx.strokeStyle = `rgba(190,215,255,${Math.max(0, 0.5 - age / 12)})`; cx.beginPath(); cx.ellipse(W / 2, H * 0.62, rr, rr * 0.35, 0, 0, 7); cx.stroke(); } }
  if (flash > 0) { cx.fillStyle = `rgba(255,255,255,${flash * 0.5})`; cx.fillRect(0, 0, W, H); flash -= dt * 2.5; }
}
const ripples = []; let flash = 0;
requestAnimationFrame(frame);

refresh(); loadQuakes();
window.__sound = { ui, get scene() { return sc; }, get engine() { return engine; }, go, get quakes() { return quakes; } };
