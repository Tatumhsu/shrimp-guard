// 今晚星空 — rendering + UI. Calculations live in astro.js.
import { makeAstro, dir8, hm, D2R, R2D } from './astro.js';
import * as S from './vendor/satellite/entry.js';

const A = window.Astronomy, X = makeAstro(A, S);
const $ = s => document.querySelector(s);
const store = { get(k, d) { try { const v = localStorage.getItem('sky.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sky.' + k, JSON.stringify(v)); } catch {} } };

const PLACES = [
  ['臺北', 25.033, 121.565, 10], ['臺中', 24.148, 120.674, 80], ['臺南', 22.999, 120.227, 10], ['高雄', 22.627, 120.301, 10],
  ['花蓮', 23.977, 121.604, 20], ['臺東', 22.756, 121.144, 10], ['合歡山暗空公園', 24.137, 121.282, 3150], ['墾丁', 21.947, 120.790, 20],
  ['澎湖', 23.566, 119.578, 10], ['金門', 24.437, 118.318, 10],
].map(([name, lat, lon, h]) => ({ name, lat, lon, h }));
const SYMBOL = { Quadrant: ['東方青龍', '角亢氐房心尾箕'], N: ['北方玄武', '斗牛女虛危室壁'], W: ['西方白虎', '奎婁胃昴畢觜參'], S: ['南方朱雀', '井鬼柳星張翼軫'] };
const quadrantOf = m => Object.values(SYMBOL).find(([, s]) => s.includes(m))?.[0];
const FAMOUS = { 天狼: '天狼星', 織女: '織女星', 牛郎: '牛郎星（河鼓二）', 大角: '大角星', 心宿二: '心宿二（大火）', 北落師門: '北落師門', 老人: '南極老人星' };
const starName = n => FAMOUS[n] || n;
const PLANET_COLOR = { Mercury: '#c9b9a6', Venus: '#fff4d2', Mars: '#ff8a5c', Jupiter: '#f3d9a8', Saturn: '#e8cf8a', Uranus: '#a8e3ea', Neptune: '#7da2ff' };
const SATS = [['ISS (ZARYA)', '國際太空站'], ['CSS (TIANHE)', '天宮太空站']];

const ui = {
  place: store.get('place', PLACES[0]), view: store.get('view', 'dome'), lines: store.get('lines', 'cn'), red: store.get('red', false),
  t: new Date(), live: true, offset: 0, base: new Date(),
  look: { az: 180, alt: 35, fov: 80 }, cam: null, aiming: false, sel: null, pass: null, playing: false,
};
let sky = null, sats = [], passList = [], tonight = null, planets = [], moon = null, nightKey = '';

// ---------- data
async function loadSky() { const r = await fetch('data/sky.json'); sky = await r.json(); }
async function loadTLE() {
  const cached = store.get('tle', null);
  let rows = cached && Date.now() - cached.at < 12 * 3600e3 ? cached.rows : null;
  if (!rows) {
    try {
      const r = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json');
      if (!r.ok) throw new Error(r.status);
      const all = await r.json();
      rows = SATS.map(([k]) => all.find(x => x.OBJECT_NAME === k)).filter(Boolean);
      store.set('tle', { at: Date.now(), rows });
    } catch { rows = cached?.rows || null; $('#tlenote').textContent = rows ? '軌道資料暫時更新不了，用上次存的。' : '讀不到軌道資料（CelesTrak），稍後再試。'; }
  }
  sats = (rows || []).map(row => ({ name: SATS.find(([k]) => k === row.OBJECT_NAME)[1], rec: S.json2satrec(row), epoch: row.EPOCH }));
  if (sats.length) $('#tlenote').textContent = `軌道資料 ${sats[0].epoch.slice(5, 10).replace('-', '/')} 更新（CelesTrak）。過境時間誤差約 1 分鐘。`;
}

// ---------- tonight's facts (recomputed when the night or the place changes)
function computeNight(force) {
  const n = X.night(ui.t, ui.place), key = ui.place.name + (n.sunset ? n.sunset.toISOString().slice(0, 13) : '');
  if (!force && key === nightKey) return;
  nightKey = key; tonight = n;
  planets = X.planetsTonight(ui.t, ui.place, sky.mansions, n);
  renderPanels();
}
function computePasses() {
  passList = [];
  for (const s of sats) for (const p of X.passes(s.rec, new Date(), 168, ui.place)) passList.push({ ...p, sat: s.name });
  passList.sort((a, b) => a.start.t - b.start.t);
  renderPasses(); renderHighlight();
}

// ---------- projection
const cv = $('#sky'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1); const r = cv.getBoundingClientRect();
  W = r.width; H = r.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); draw();
}
const enu = (alt, az) => { const ca = Math.cos(alt * D2R); return [ca * Math.sin(az * D2R), ca * Math.cos(az * D2R), Math.sin(alt * D2R)]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function camFromLook({ az, alt }) {
  const f = enu(alt, az), r = [Math.cos(az * D2R), -Math.sin(az * D2R), 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, u, r };
}
let P;  // (alt, az) → [x, y] | null
function setupProjection() {
  if (ui.view === 'dome') {
    const R = Math.min(W, H) / 2 - 22, cx = W / 2, cy = H / 2;
    P = (alt, az) => { if (alt < -30) return null; const r = R * Math.tan((90 - alt) * D2R / 2); return [cx - r * Math.sin(az * D2R), cy - r * Math.cos(az * D2R)]; };
    P.R = R; P.cx = cx; P.cy = cy;
  } else {
    const c = ui.aiming && ui.cam ? ui.cam : camFromLook(ui.look), k = (W / 2) / Math.tan(ui.look.fov * D2R / 2);
    P = (alt, az) => { const v = enu(alt, az), z = dot(v, c.f); if (z < 0.05) return null; return [W / 2 + k * dot(v, c.r) / z, H / 2 - k * dot(v, c.u) / z]; };
    P.k = k;
  }
}

// ---------- drawing
const bvColor = bv => bv < 0 ? '#b5c9ff' : bv < 0.3 ? '#dfe7ff' : bv < 0.6 ? '#fff8ec' : bv < 1.0 ? '#ffe2b0' : bv < 1.4 ? '#ffc58a' : '#ffaa76';
let hits = [];
function draw() {
  if (!sky || !W) return;
  setupProjection(); hits = [];
  const f = X.frame(ui.t, ui.place), sun = X.bodyHor('Sun', ui.t, ui.place);
  const dark = sun.alt < -18 ? 1 : sun.alt > -4 ? 0 : (-4 - sun.alt) / 14;
  const lim = sun.alt > -3 ? 0.5 : sun.alt > -8 ? 2.2 : sun.alt > -13 ? 3.8 : sun.alt > -18 ? 5 : 6.2;
  const skyTop = mix([28, 74, 140], [6, 10, 22], dark), skyLow = mix([120, 160, 205], [14, 22, 44], dark);
  ctx.clearRect(0, 0, W, H);
  // sky background
  if (ui.view === 'dome') {
    ctx.fillStyle = '#060a14'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(P.cx, P.cy, 0, P.cx, P.cy, P.R);
    g.addColorStop(0, rgb(skyTop)); g.addColorStop(1, rgb(skyLow));
    ctx.save(); ctx.beginPath(); ctx.arc(P.cx, P.cy, P.R, 0, 7); ctx.fillStyle = g; ctx.fill(); ctx.clip();
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgb(skyTop)); g.addColorStop(1, rgb(skyLow));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.save();
  }
  // Milky Way
  if (dark > 0.3) {
    ctx.fillStyle = `rgba(190,205,255,${0.035 * dark})`;
    for (const level of sky.mw) for (const ring of level) {
      let ok = true; const pts = ring.map(([ra, de]) => { const [al, az] = f(ra, de); const p = P(al, az); if (!p) ok = false; return p; });
      if (!ok) continue; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.fill();
    }
  }
  // constellation lines
  const cons = ui.lines === 'cn' ? sky.cn : ui.lines === 'we' ? sky.we : [];
  const zoom = ui.view === 'look' ? ui.look.fov : 140;
  for (const c of cons) {
    const mansion = ui.lines === 'cn' && c.rank === 1;
    ctx.strokeStyle = mansion ? 'rgba(226,182,92,.55)' : ui.lines === 'cn' ? 'rgba(124,198,232,.28)' : 'rgba(124,198,232,.4)';
    ctx.lineWidth = mansion ? 1.3 : 1;
    for (const seg of c.lines) {
      ctx.beginPath(); let prev = null;
      for (const [ra, de] of seg) { const [al, az] = f(ra, de); const p = al > -5 ? P(al, az) : null; if (p && prev) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; }
      ctx.stroke();
    }
  }
  // stars
  const sizeK = ui.view === 'look' ? Math.max(1, 70 / ui.look.fov) : 1;
  for (const [id, ra, de, mag, bv] of sky.stars) {
    if (mag > lim) continue;
    const [al, az] = f(ra, de); if (al < -1) continue;
    const p = P(al, az); if (!p) continue;
    const r = Math.max(0.55, (6.4 - mag) * 0.5) * sizeK, fade = Math.min(1, (lim - mag) / 1.2 + 0.25);
    ctx.globalAlpha = fade; ctx.fillStyle = bvColor(bv);
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
    if (mag < 1.2) { ctx.globalAlpha = fade * 0.18; ctx.beginPath(); ctx.arc(p[0], p[1], r * 2.6, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    const nm = sky.names[id];
    if (nm) hits.push({ x: p[0], y: p[1], r: Math.max(8, r + 5), kind: 'star', name: starName(nm), mag, bv, alt: al, az, pri: 3 - mag });
  }
  // labels: constellations then bright stars
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const c of cons) {
    const show = ui.lines === 'cn' ? (c.rank === 1 || (c.rank === 2 && zoom < 95) || zoom < 55) : (c.rank <= 2 || zoom < 70);
    if (!show) continue;
    const [al, az] = f(c.at[0], c.at[1]); if (al < 2) continue; const p = P(al, az); if (!p) continue;
    const mansion = ui.lines === 'cn' && c.rank === 1;
    ctx.font = `${mansion ? 700 : 400} ${mansion ? 15 : 12}px "LXGW WenKai TC", serif`;
    ctx.fillStyle = mansion ? 'rgba(226,182,92,.95)' : 'rgba(167,177,199,.8)';
    ctx.fillText(c.name, p[0], p[1]);
    hits.push({ x: p[0], y: p[1], r: 16, kind: 'con', con: c, culture: ui.lines, alt: al, az, pri: 1 });
  }
  ctx.font = '12px "Noto Sans TC", sans-serif'; ctx.fillStyle = 'rgba(231,235,244,.75)'; ctx.textAlign = 'left';
  for (const h of hits) if (h.kind === 'star' && h.mag < (ui.view === 'look' && ui.look.fov < 60 ? 2.6 : 1.3) && h.mag <= lim) ctx.fillText(h.name, h.x + 6, h.y - 7);
  // sun, moon, planets
  if (sun.alt > -1) { const p = P(sun.alt, sun.az); if (p) { ctx.fillStyle = '#ffd86b'; ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, 7); ctx.fill(); hits.push({ x: p[0], y: p[1], r: 14, kind: 'sun', alt: sun.alt, az: sun.az, pri: 9 }); } }
  for (const [body] of [['Mercury'], ['Venus'], ['Mars'], ['Jupiter'], ['Saturn'], ['Uranus'], ['Neptune']]) {
    const h = X.bodyHor(body, ui.t, ui.place); if (h.alt < -1) continue; const p = P(h.alt, h.az); if (!p) continue;
    const pl = planets.find(x => x.body === body), mag = A.Illumination(body, ui.t).mag;
    if (mag > lim + 2) continue;  // Uranus/Neptune only under a dark sky
    const r = Math.max(2.2, (3 - mag) * 1.1) * Math.min(sizeK, 2);
    ctx.fillStyle = PLANET_COLOR[body]; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0], p[1], r + 3, 0, 7); ctx.stroke();
    ctx.font = '700 13px "Noto Sans TC", sans-serif'; ctx.fillStyle = PLANET_COLOR[body]; ctx.fillText(pl?.zh || body, p[0] + r + 5, p[1] + 1);
    hits.push({ x: p[0], y: p[1], r: r + 10, kind: 'planet', body, alt: h.alt, az: h.az, pri: 8 });
  }
  const mh = X.bodyHor('Moon', ui.t, ui.place);
  if (mh.alt > -1) { const p = P(mh.alt, mh.az); if (p) { drawMoon(p, sun, ui.view === 'look' ? Math.max(9, P.k * 0.0045) : 11); hits.push({ x: p[0], y: p[1], r: 18, kind: 'moon', alt: mh.alt, az: mh.az, pri: 9 }); } }
  // satellites now + selected pass path
  for (const s of sats) {
    const n = X.satNow(s.rec, ui.t, ui.place); if (!n || n.alt < 0) continue; const p = P(n.alt, n.az); if (!p) continue;
    ctx.fillStyle = n.lit && sun.alt < -6 ? '#ffffff' : 'rgba(167,177,199,.6)';
    ctx.beginPath(); ctx.rect(p[0] - 3, p[1] - 3, 6, 6); ctx.fill();
    ctx.font = '700 12px "Noto Sans TC", sans-serif'; ctx.fillText(s.name + (n.lit ? '' : '（在地球影子裡）'), p[0] + 7, p[1]);
    hits.push({ x: p[0], y: p[1], r: 14, kind: 'sat', sat: s, now: n, pri: 10 });
  }
  if (ui.pass) drawPass(ui.pass);
  // horizon, ground, cardinal points
  ctx.restore();
  if (ui.view === 'dome') {
    ctx.strokeStyle = 'rgba(167,177,199,.35)'; ctx.lineWidth = 1;
    for (const a of [30, 60]) { const r = P.R * Math.tan((90 - a) * D2R / 2); ctx.beginPath(); ctx.arc(P.cx, P.cy, r, 0, 7); ctx.setLineDash([2, 5]); ctx.stroke(); }
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(P.cx, P.cy, P.R, 0, 7); ctx.strokeStyle = 'rgba(167,177,199,.6)'; ctx.stroke();
    ctx.font = '700 15px "LXGW WenKai TC", serif'; ctx.fillStyle = '#e7ebf4'; ctx.textAlign = 'center';
    for (const [t, az] of [['北', 0], ['東', 90], ['南', 180], ['西', 270]]) { const x = P.cx - (P.R + 12) * Math.sin(az * D2R), y = P.cy - (P.R + 12) * Math.cos(az * D2R); ctx.fillText(t, x, y); }
  } else {
    ctx.fillStyle = 'rgba(16,22,18,.94)';
    for (let az = 0; az < 360; az += 6) for (const [a0, a1] of [[0, -8], [-8, -25], [-25, -55], [-55, -89]]) {
      const q = [P(a0, az), P(a0, az + 6.5), P(a1, az + 6.5), P(a1, az)]; if (q.some(x => !x)) continue;
      ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(167,177,199,.5)'; ctx.beginPath(); let prev = null;
    for (let az = 0; az <= 360; az += 2) { const p = P(0, az); if (p && prev) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; }
    ctx.stroke();
    ctx.font = '700 15px "LXGW WenKai TC", serif'; ctx.fillStyle = '#e7ebf4'; ctx.textAlign = 'center';
    ['北', '東北', '東', '東南', '南', '西南', '西', '西北'].forEach((t, i) => { const p = P(1.5, i * 45); if (p) ctx.fillText(t, p[0], p[1] - 8); });
  }
  if (ui.sel) { const h = ui.sel; ctx.strokeStyle = '#e2b65c'; ctx.lineWidth = 1.5; const p = h.alt != null ? P(h.alt, h.az) : null; if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 14, 0, 7); ctx.stroke(); } }
  $('#hint').textContent = sun.alt > -6 ? (sun.alt > 0 ? '白天：星星被陽光蓋住了，拖動下面的時間看今晚。' : '天還沒全黑，只看得到最亮的星。') : ui.view === 'dome' ? '整片天空，正中央是頭頂，邊緣是地平線。點星星看說明。' : '拖曳轉方向，滾輪或兩指縮放。';
}
function drawMoon(p, sun, r) {
  const ill = A.Illumination('Moon', ui.t), k = ill.phase_fraction;
  const sp = P(sun.alt, sun.az), ang = sp ? Math.atan2(sp[1] - p[1], sp[0] - p[0]) : (ui.view === 'dome' ? Math.atan2(-Math.cos(sun.az * D2R), -Math.sin(sun.az * D2R)) : 0);
  ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang);
  ctx.fillStyle = '#2b3146'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#f4f1e6'; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); // lit half faces the sun (+x)
  const e = r * Math.abs(1 - 2 * k);
  ctx.ellipse(0, 0, e, r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5); ctx.fill();
  ctx.restore();
  ctx.font = '700 13px "Noto Sans TC", sans-serif'; ctx.fillStyle = '#f4f1e6'; ctx.textAlign = 'left'; ctx.fillText('月亮', p[0] + r + 5, p[1] + 1);
}
function drawPass(pass) {
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); let prev = null;
  for (const pt of pass.path) { const p = P(pt.alt, pt.az); if (p && prev) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '12px "JetBrains Mono", monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  for (const [pt, lab] of [[pass.start, '起 '], [pass.max, '最高 '], [pass.end, '終 ']]) { const p = P(pt.alt, pt.az); if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fill(); ctx.fillText(lab + hm(new Date(pt.t)), p[0] + 6, p[1] + 12); } }
}
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

// ---------- info card
function showInfo(h) {
  ui.sel = h; const box = $('#info'); box.hidden = !h; if (!h) return draw();
  const pos = h.alt != null ? `方位 ${dir8(h.az)}（${Math.round(h.az)}°），高度 ${Math.round(h.alt)}°` : '';
  let html = '';
  if (h.kind === 'star') {
    const color = h.bv < 0 ? '藍白色，表面很熱' : h.bv < 0.6 ? '白色' : h.bv < 1.2 ? '黃到橘色' : '橘紅色，表面較冷';
    html = `<div class="k">恆星</div><h3>${esc(h.name)}</h3><p>星等 ${h.mag.toFixed(1)}（數字越小越亮）・${color}</p><p>${pos}</p>`;
  } else if (h.kind === 'con') {
    const c = h.con;
    if (h.culture === 'cn') {
      const m = c.rank === 1 ? c.name.replace('宿', '') : null;
      html = `<div class="k">中國傳統星官${m ? '・二十八宿' : ''}</div><h3>${esc(c.name)}</h3>` +
        (m ? `<p>二十八宿之一，屬於${quadrantOf(m)}七宿（${esc(Object.values(SYMBOL).find(([q]) => q === quadrantOf(m))[1].split('').join('、'))}）。古人用月亮每晚停在哪一宿來記日子。</p>` : '<p>中國古代把星空分成 283 個星官（這份資料收錄 312 組，含增補星）。</p>') + `<p>${pos}</p>`;
    } else html = `<div class="k">西方星座</div><h3>${esc(c.name)}</h3><p>${esc(c.en)}</p><p>${pos}</p>`;
  } else if (h.kind === 'planet') {
    const p = planets.find(x => x.body === h.body), rs = [X.riseSet(h.body, ui.t, ui.place, +1), X.riseSet(h.body, ui.t, ui.place, -1)];
    const cname = sky.we.find(c => c.id === p.con)?.name || p.con;
    html = `<div class="k">行星</div><h3>${p.zh}</h3><p>星等 ${p.mag.toFixed(1)}${p.mag > 6 ? '，要用望遠鏡' : p.mag > 5 ? '，要在很暗的地方才看得到' : ''}・在${esc(cname)}、${p.mansion}</p>` +
      `<p>今晚：${esc(p.when)}</p><p>${pos}・下次升起 ${hm(rs[0])}、落下 ${hm(rs[1])}</p>`;
  } else if (h.kind === 'moon') {
    const m = X.moonInfo(ui.t, ui.place, sky.mansions);
    html = `<div class="k">月亮</div><h3>${m.name}</h3><p>亮面 ${Math.round(m.frac * 100)}%・月齡 ${m.age?.toFixed(1)} 天・在${m.mansion}（${quadrantOf(m.mansion[0])}）</p>` +
      `<p>${pos}・下次月出 ${hm(X.riseSet('Moon', ui.t, ui.place, +1))}、月落 ${hm(X.riseSet('Moon', ui.t, ui.place, -1))}</p>`;
  } else if (h.kind === 'sun') {
    html = `<div class="k">太陽</div><h3>太陽</h3><p>${pos}</p><p>不要直視太陽。</p>`;
  } else if (h.kind === 'sat') {
    const next = passList.find(p => p.sat === h.sat.name && p.end.t > Date.now());
    html = `<div class="k">太空站</div><h3>${h.sat.name}</h3><p>${pos}・${h.now.lit ? '被太陽照亮' : '在地球影子裡，看不到'}</p>` +
      (next ? `<p>下一次看得到：${dayLabel(new Date(next.start.t))} ${hm(new Date(next.start.t))} 從${dir8(next.start.az)}方出現</p>` : '');
  }
  box.innerHTML = html; draw();
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function dayLabel(d) {
  const f = x => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' }).format(x);
  const today = new Date(), diff = Math.round((new Date(f(d)) - new Date(f(today))) / 86400000);
  return diff === 0 ? '今天' : diff === 1 ? '明天' : diff === 2 ? '後天' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(d);
}

// ---------- panels
const nightLabel = () => { const d = dayLabel(tonight.sunset); return d === '今天' ? '今晚' : d === '明天' ? '明晚' : d + ' 晚上'; };
function renderPanels() {
  $('#tonightTitle').textContent = nightLabel();
  moon = X.moonInfo(ui.t, ui.place, sky.mansions);
  const st = X.solarTerm(ui.t), sh = X.nextShower(ui.t);
  const moonset = X.riseSet('Moon', tonight.sunset, ui.place, -1), moonrise = X.riseSet('Moon', tonight.sunset, ui.place, +1);
  $('#tonight').innerHTML = [
    ['日落', `<span class="num">${hm(tonight.sunset)}</span>，天全黑 <span class="num">${hm(tonight.dark)}</span>`],
    ['天亮', `<span class="num">${hm(tonight.dawn)}</span> 開始泛白，日出 <span class="num">${hm(tonight.sunrise)}</span>`],
    ['月亮', `${moon.name}，亮面 ${Math.round(moon.frac * 100)}%，在${moon.mansion}`],
    ['月出月落', `月出 <span class="num">${hm(moonrise)}</span>・月落 <span class="num">${hm(moonset)}</span>`],
    ['節氣', `${st.now}；下一個${st.next} ${st.nextAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(st.nextAt) : ''}`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#planets').innerHTML = planets.map(p => `<li class="${p.visible && p.naked ? '' : 'off'}"><span class="nm"><i class="dot" style="background:${PLANET_COLOR[p.body]}"></i>${p.zh}</span><span><span>${esc(p.when)}</span><br><span class="sm">星等 ${p.mag.toFixed(1)}${p.mag > 6 ? '・要望遠鏡' : ''}・${esc(sky.we.find(c => c.id === p.con)?.name || p.con)}・${p.mansion}</span></span></li>`).join('');
  const cond = sh.moon > 0.6 ? '月光很亮，只看得到亮流星' : sh.moon > 0.3 ? '有些月光干擾' : '月光不干擾，條件好';
  $('#shower').innerHTML = `<p class="shower"><b>${sh.name}</b><br>極大期 ${new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(sh.peak)}（${sh.days <= 0 ? '就是這幾天' : sh.days + ' 天後'}）・每小時最多約 ${sh.zhr} 顆（理想暗空）<br><span class="sm">${cond}（月亮亮面 ${Math.round(sh.moon * 100)}%）。後半夜、遠離光害效果最好。</span></p>`;
  renderHighlight();
}
function renderPasses() {
  const ol = $('#passes');
  if (!sats.length) { ol.innerHTML = '<li><span></span><span class="sm">沒有軌道資料。</span></li>'; return; }
  const list = passList.filter(p => p.end.t > Date.now()).slice(0, 8);
  if (!list.length) { ol.innerHTML = '<li><span></span><span class="sm">接下來 7 天沒有看得到的過境（太空站要在天黑後、自己還被太陽照到時才看得見）。</span></li>'; return; }
  ol.replaceChildren(...list.map(p => {
    const li = document.createElement('li'); li.className = 'passrow'; li.tabIndex = 0; li.setAttribute('aria-current', String(ui.pass === p));
    const d = new Date(p.start.t), mins = Math.max(1, Math.round((p.end.t - p.start.t) / 60000));
    li.innerHTML = `<span class="nm num">${hm(d)}</span><span><span>${dayLabel(d)}・${p.sat}</span><br><span class="sm">從${dir8(p.start.az)}方出現 → 最高 ${Math.round(p.max.alt)}°（${dir8(p.max.az)}）→ ${dir8(p.end.az)}方消失・約 ${mins} 分鐘</span></span>`;
    const go = () => { ui.pass = p; goTo(new Date(p.max.t)); renderPasses(); };
    li.addEventListener('click', go); li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    return li;
  }));
}
function renderHighlight() {
  if (!tonight || !moon) return;
  const vis = planets.filter(p => p.visible && p.mag < 3 && p.span >= 40).sort((a, b) => b.span - a.span || a.mag - b.mag);
  const parts = [`${nightLabel()} ${hm(tonight.sunset)} 日落，${hm(tonight.dark)} 天全黑。`];
  parts.push(`月亮是${moon.name}（亮面 ${Math.round(moon.frac * 100)}%），停在${moon.mansion}。`);
  if (vis.length) parts.push(`看得到${vis.slice(0, 3).map(p => `${p.zh}（${p.when.replace(/^整晚都看得到$/, '整晚')}）`).join('、')}。`);
  const np = passList.find(p => p.end.t > Date.now());
  if (np) parts.push(`${np.sat}${dayLabel(new Date(np.start.t))} ${hm(new Date(np.start.t))} 從${dir8(np.start.az)}方飛過，最高 ${Math.round(np.max.alt)}°。`);
  const sh = X.nextShower(ui.t); if (sh.days <= 10) parts.push(`${sh.name}${sh.days <= 0 ? '正值極大期' : `再 ${sh.days} 天極大`}。`);
  $('#highlight').textContent = parts.join('');
}

// ---------- time
function fmtClock(d) { return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
function setTime(d, live) {
  ui.t = d; ui.live = live; ui.offset = Math.round((d - ui.base) / 60000);
  $('#slider').value = String(Math.max(-720, Math.min(720, ui.offset)));
  $('#clock').textContent = fmtClock(d) + (live ? '・現在' : '');
  computeNight(); draw(); if (ui.sel) showInfo(refreshSel(ui.sel));
}
function goTo(d) { ui.base = d; setTime(d, false); }
const selKey = h => h.kind + ':' + (h.name || h.body || h.con?.id || h.sat?.name || '');
function refreshSel(h) { return hits.find(x => selKey(x) === selKey(h)) || h; }  // same object at the new time
$('#slider').addEventListener('input', e => { setTime(new Date(+ui.base + +e.target.value * 60000), false); });
$('#now').addEventListener('click', () => { ui.base = new Date(); ui.pass = null; setTime(new Date(), true); renderPasses(); });
let playTimer = null;
$('#play').addEventListener('click', () => {
  ui.playing = !ui.playing; $('#play').setAttribute('aria-pressed', String(ui.playing)); $('#play').textContent = ui.playing ? '❚❚' : '▶';
  clearInterval(playTimer);
  if (ui.playing) playTimer = setInterval(() => { let o = ui.offset + 4; if (o > 720) o = -720; setTime(new Date(+ui.base + o * 60000), false); }, 50);
});
setInterval(() => { if (ui.live && document.visibilityState === 'visible') { ui.base = new Date(); setTime(new Date(), true); } }, 30000);

// ---------- controls
function syncButtons() {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));
  document.querySelectorAll('[data-lines]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lines === ui.lines)));
  $('#red').setAttribute('aria-pressed', String(ui.red)); document.body.classList.toggle('red', ui.red);
  $('#aim').hidden = !(ui.view === 'look' && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches);
  $('#aim').setAttribute('aria-pressed', String(ui.aiming)); $('#aim').textContent = ui.aiming ? '停止對準' : '手機對準天空';
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { ui.view = b.dataset.view; store.set('view', ui.view); if (ui.view === 'dome') stopAim(); syncButtons(); draw(); }));
document.querySelectorAll('[data-lines]').forEach(b => b.addEventListener('click', () => { ui.lines = b.dataset.lines; store.set('lines', ui.lines); syncButtons(); draw(); }));
$('#red').addEventListener('click', () => { ui.red = !ui.red; store.set('red', ui.red); syncButtons(); });
const sel = $('#place');
function fillPlaces() {
  const custom = ui.place.custom ? [ui.place] : [];
  sel.innerHTML = [...custom, ...PLACES].map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
  sel.value = String(custom.length ? 0 : PLACES.findIndex(p => p.name === ui.place.name));
}
sel.addEventListener('change', () => { const list = [...(ui.place.custom ? [ui.place] : []), ...PLACES]; setPlace(list[+sel.value]); });
$('#geo').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  $('#geo').textContent = '定位中…';
  navigator.geolocation.getCurrentPosition(pos => {
    $('#geo').textContent = '用我的位置';
    setPlace({ name: '我的位置', lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3), h: Math.round(pos.coords.altitude || 0), custom: true });
  }, () => { $('#geo').textContent = '定位失敗'; }, { timeout: 10000, maximumAge: 600000 });
});
function setPlace(p) { ui.place = p; store.set('place', p); fillPlaces(); computeNight(true); computePasses(); draw(); }

// pointer: tap to inspect; in 抬頭看, drag to turn and pinch/wheel to zoom
const ptrs = new Map(); let dragStart = null, pinch0 = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); dragStart = { x: e.clientX, y: e.clientY, az: ui.look.az, alt: ui.look.alt, moved: false }; if (ptrs.size === 2) pinch0 = { d: dist2(), fov: ui.look.fov }; });
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ui.view !== 'look' || ui.aiming) return;
  if (ptrs.size === 2 && pinch0) { ui.look.fov = clamp(pinch0.fov * pinch0.d / dist2(), 20, 120); dragStart.moved = true; return draw(); }
  const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y; if (Math.hypot(dx, dy) > 4) dragStart.moved = true;
  const k = ui.look.fov / W; ui.look.az = (dragStart.az - dx * k + 360) % 360; ui.look.alt = clamp(dragStart.alt + dy * k, -10, 90); draw();
});
cv.addEventListener('pointerup', e => {
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null;
  if (dragStart && !dragStart.moved) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const cand = hits.filter(h => Math.hypot(h.x - x, h.y - y) <= h.r).sort((a, b) => b.pri - a.pri || Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    showInfo(cand[0] || null);
  }
  dragStart = null;
});
cv.addEventListener('wheel', e => { if (ui.view !== 'look') return; e.preventDefault(); ui.look.fov = clamp(ui.look.fov * (1 + e.deltaY * 0.001), 20, 120); draw(); }, { passive: false });
const dist2 = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// device orientation → camera (back camera looks along the device's -z axis)
let raf = 0;
function onOrient(e) {
  let a = e.alpha; if (e.webkitCompassHeading != null) a = 360 - e.webkitCompassHeading; if (a == null || e.beta == null) return;
  const [cA, sA, cB, sB, cG, sG] = [a, a, e.beta, e.beta, e.gamma, e.gamma].map((v, i) => (i % 2 ? Math.sin : Math.cos)(v * D2R));
  const r = [cA * cG - sA * sB * sG, cG * sA + cA * sB * sG, -cB * sG], u = [-cB * sA, cA * cB, sB], f = [-(cA * sG + cG * sA * sB), -(sA * sG - cA * cG * sB), -cB * cG];
  const sm = (p, q) => p ? p.map((v, i) => v * 0.7 + q[i] * 0.3) : q;
  ui.cam = { f: unit(sm(ui.cam?.f, f)), u: unit(sm(ui.cam?.u, u)), r: unit(sm(ui.cam?.r, r)) };
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
}
const unit = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
async function startAim() {
  try { if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch { return; }
  ui.aiming = true; ui.look.fov = 70;
  window.addEventListener('ontouchstart' in window && 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onOrient);
  syncButtons();
}
function stopAim() { ui.aiming = false; ui.cam = null; window.removeEventListener('deviceorientationabsolute', onOrient); window.removeEventListener('deviceorientation', onOrient); syncButtons(); }
$('#aim').addEventListener('click', () => ui.aiming ? (stopAim(), draw()) : startAim());

// ---------- start
(async () => {
  syncButtons(); fillPlaces();
  await loadSky();
  // daytime visit: preview tonight instead of an empty blue sky
  const now = new Date(), sunNow = X.bodyHor('Sun', now, ui.place).alt;
  ui.base = now;
  const asked = Date.parse(new URLSearchParams(location.search).get('t') || '');   // ?t=ISO from 台灣天象曆
  if (!Number.isNaN(asked)) goTo(new Date(asked));
  else if (sunNow > -6) { const n = X.night(now, ui.place), show = new Date(+(n.dark && n.dark > now ? n.dark : now) + 30 * 60000); goTo(show); }
  else setTime(now, true);
  addEventListener('resize', resize); resize();
  computeNight(true);
  await loadTLE(); computePasses(); draw();
})();
window.__sky = { ui, X, get passList() { return passList; }, get hits() { return hits; }, setTime, showInfo };
