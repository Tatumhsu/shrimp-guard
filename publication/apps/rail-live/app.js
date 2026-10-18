// 台鐵即時列車 — positions every TRA train from the published daily timetable (no live delay data).
const TYPES = [['自強', '#ff6b4a'], ['莒光', '#c79bff'], ['區間快', '#ffd34d'], ['區間車', '#5ea8ff'], ['其他', '#b5bec7']];
const COLOR = Object.fromEntries(TYPES);
['復興', '普快'].forEach(t => { COLOR[t] = COLOR['其他']; });
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hhmm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.floor(m) % 60)}`;
const typeKey = t => (COLOR[t] && TYPES.some(([k]) => k === t)) ? t : '其他';

const S = {
  stations: [], paths: {}, meta: null, days: {}, // date → {trains}
  date: null, live: true, speed: 60, minute: 0, // service-day minute (float)
  hidden: new Set(), sel: null, selStation: null, running: [], lastFrame: 0,
};

// --- time ---------------------------------------------------------------
function taipeiNow() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return { date: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`, minute: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000 };
}
function shiftDate(date, days) {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6)) + days * 864e5);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
const fmtDate = d => `${+d.slice(4, 6)}/${+d.slice(6)}（${'日一二三四五六'[new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6))).getUTCDay()]}）`;

// --- data ---------------------------------------------------------------
async function getJSON(p) { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }
async function loadDay(date) {
  if (S.days[date] !== undefined) return S.days[date];
  if (!S.meta.dates.includes(date)) return (S.days[date] = null);
  S.days[date] = getJSON(`data/tt/${date}.json`).then(d => (S.days[date] = d)).catch(() => (S.days[date] = null));
  return S.days[date];
}
const cum = {};
function pathOf(a, b) {
  const k = a + '-' + b;
  if (!cum[k]) {
    const pts = S.paths[k] || [[S.stations[a][2], S.stations[a][3]], [S.stations[b][2], S.stations[b][3]]];
    const c = [0];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      const kx = Math.cos(y1 * Math.PI / 180) * 111320;
      c.push(c[i - 1] + Math.hypot((x2 - x1) * kx, (y2 - y1) * 110540));
    }
    cum[k] = { pts, c, len: c[c.length - 1] };
  }
  return cum[k];
}
function along(a, b, f) {
  const p = pathOf(a, b), d = f * p.len;
  let i = 1;
  while (i < p.c.length - 1 && p.c[i] < d) i++;
  const seg = p.c[i] - p.c[i - 1] || 1, g = (d - p.c[i - 1]) / seg;
  const [x1, y1] = p.pts[i - 1], [x2, y2] = p.pts[i];
  return [x1 + (x2 - x1) * g, y1 + (y2 - y1) * g, Math.atan2(x2 - x1, y2 - y1) * 180 / Math.PI];
}
const ease = f => f < .5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);

// Where is train `t` at service minute m? null if not running.
function locate(t, m) {
  const st = t[5];
  if (m < st[0][2] || m > st[st.length - 1][1]) return null;
  let lo = 0, hi = st.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid][1] <= m) lo = mid; else hi = mid - 1; }
  const s = st[lo];
  if (m <= s[2] || lo === st.length - 1) return { lon: S.stations[s[0]][2], lat: S.stations[s[0]][3], at: lo, dwell: true, bearing: 0 };
  const n = st[lo + 1];
  const f = (m - s[2]) / Math.max(0.1, n[1] - s[2]);
  const [lon, lat, bearing] = along(s[0], n[0], ease(Math.min(1, Math.max(0, f))));
  return { lon, lat, at: lo, dwell: false, bearing };
}

// Trains running at the current moment: today's at m, plus yesterday's past-midnight runs at m+1440.
function runningNow() {
  const out = [];
  const today = S.days[S.date], yday = S.days[shiftDate(S.date, -1)];
  for (const [day, m] of [[today, S.minute], [yday, S.minute + 1440]]) {
    if (!day || day.then) continue;
    for (const t of day.trains) {
      const p = locate(t, m);
      if (p) out.push({ t, p, m });
    }
  }
  return out;
}

// --- map ----------------------------------------------------------------
const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/dark', center: [120.95, 23.75], zoom: window.innerWidth < 640 ? 6.4 : 7.2,
  minZoom: 5.5, maxZoom: 16, attributionControl: { compact: true }, localIdeographFontFamily: '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

const fc = features => ({ type: 'FeatureCollection', features });
function addLayers() {
  map.addSource('lines', { type: 'geojson', data: S.lines });
  map.addLayer({ id: 'lines', type: 'line', source: 'lines', paint: { 'line-color': '#46677c', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2.5] } });
  map.addSource('route', { type: 'geojson', data: fc([]) });
  map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6], 'line-opacity': .55 } });
  map.addSource('stations', { type: 'geojson', data: fc(S.stations.map((s, i) => ({ type: 'Feature', id: i, properties: { i, name: s[1] }, geometry: { type: 'Point', coordinates: [s[2], s[3]] } }))) });
  map.addLayer({ id: 'stations', type: 'circle', source: 'stations', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.6, 12, 5], 'circle-color': '#0b1117', 'circle-stroke-color': '#8aa4b6', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, .6, 12, 1.5] } });
  map.addLayer({ id: 'station-labels', type: 'symbol', source: 'stations', minzoom: 9.2, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#c9d6e0', 'text-halo-color': '#0b1117', 'text-halo-width': 1.4 } });
  map.addSource('trains', { type: 'geojson', data: fc([]) });
  map.addLayer({ id: 'train-glow', type: 'circle', source: 'trains', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 12, 14], 'circle-color': ['get', 'c'], 'circle-opacity': .18, 'circle-blur': .6 } });
  map.addLayer({ id: 'trains', type: 'circle', source: 'trains', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.6, 12, 6.5], 'circle-color': ['get', 'c'], 'circle-stroke-color': ['case', ['get', 'sel'], '#ffffff', '#0b1117'], 'circle-stroke-width': ['case', ['get', 'sel'], 2.5, .8] } });
  map.addLayer({ id: 'train-labels', type: 'symbol', source: 'trains', minzoom: 10.5, layout: { 'text-field': ['get', 'no'], 'text-size': 11, 'text-offset': [0, -1.3], 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': false }, paint: { 'text-color': ['get', 'c'], 'text-halo-color': '#0b1117', 'text-halo-width': 1.4 } });

  const hit = layer => e => { const f = e.features && e.features[0]; if (!f) return; layer === 'trains' ? selectTrain(f.properties.key) : selectStation(f.properties.i); };
  map.on('click', 'trains', hit('trains'));
  map.on('click', 'stations', e => { if (!map.queryRenderedFeatures(e.point, { layers: ['trains'] }).length) hit('stations')(e); });
  for (const l of ['trains', 'stations']) {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  }
}

// --- render loop ----------------------------------------------------------
const keyOf = (t, m) => `${t[0]}@${m >= 1440 && S.minute < 1440 ? 'y' : 'd'}`;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = ts - (S.lastTs || ts); S.lastTs = ts;
  if (S.live) {
    const n = taipeiNow();
    if (n.date !== S.date && S.meta.dates.includes(n.date)) { setDate(n.date); }
    S.minute = n.minute;
  } else if (S.speed) {
    S.minute += dt / 60000 * S.speed;
    if (S.minute > 1560) S.minute = 240;
  }
  const interval = S.live ? 500 : 80;
  if (ts - S.lastFrame < interval) return;
  S.lastFrame = ts;
  draw();
  if (window.Terrain3D) Terrain3D.tick(shownDate());
}
// the moment on screen (S.minute may run past 1440 into the next morning)
const shownDate = () => new Date(Date.parse(`${S.date.slice(0, 4)}-${S.date.slice(4, 6)}-${S.date.slice(6)}T00:00:00+08:00`) + S.minute * 60000);
function set3D(on) {
  try { localStorage.setItem('rail.3d', on ? '1' : '0'); } catch {}
  $('#d3').setAttribute('aria-pressed', String(on)); $('#d3').classList.toggle('on', on);
  on ? Terrain3D.enable(map, shownDate()) : Terrain3D.disable(map);
}
function draw() {
  S.running = runningNow();
  const feats = [];
  const counts = {};
  for (const r of S.running) {
    const k = typeKey(r.t[1]);
    counts[k] = (counts[k] || 0) + 1;
    if (S.hidden.has(k)) continue;
    const key = keyOf(r.t, r.m);
    feats.push({ type: 'Feature', properties: { key, no: r.t[0], c: COLOR[r.t[1]] || COLOR['其他'], sel: S.sel && S.sel.key === key }, geometry: { type: 'Point', coordinates: [r.p.lon, r.p.lat] } });
  }
  const src = map.getSource && map.getSource('trains');
  if (src) src.setData(fc(feats));
  $('#clock').textContent = `${hhmm(S.minute)}:${pad(Math.floor((S.minute * 60) % 60))}`;
  $('#running').textContent = S.running.length;
  for (const b of document.querySelectorAll('#types button')) b.querySelector('small').textContent = counts[b.dataset.t] || 0;
  if (!S.live) $('#slider').value = Math.round(S.minute);
  if (S.sel) renderTrain(false);
  else if (S.selStation != null && Math.floor(S.minute) !== S.boardMinute) renderStation();
}

// --- selection panels -------------------------------------------------------
function findTrain(key) {
  const [no, which] = key.split('@');
  const day = S.days[which === 'y' ? shiftDate(S.date, -1) : S.date];
  if (!day || day.then) return null;
  const t = day.trains.find(x => x[0] === no);
  return t ? { t, off: which === 'y' ? 1440 : 0 } : null;
}
function selectTrain(key, fly) {
  const f = findTrain(key);
  if (!f) return;
  S.sel = { key, ...f }; S.selStation = null;
  const c = COLOR[f.t[1]] || COLOR['其他'];
  const coords = [];
  f.t[5].forEach((s, i, a) => { if (i) { const p = pathOf(a[i - 1][0], s[0]).pts; coords.push(...(coords.length ? p.slice(1) : p)); } });
  map.getSource('route').setData(fc([{ type: 'Feature', properties: { c }, geometry: { type: 'LineString', coordinates: coords } }]));
  history.replaceState(null, '', '#t=' + f.t[0]);
  renderTrain(true);
  if (fly) { const p = locate(f.t, S.minute + f.off); const s = S.stations[f.t[5][0][0]]; map.flyTo({ center: p ? [p.lon, p.lat] : [s[2], s[3]], zoom: Math.max(map.getZoom(), 10) }); }
  draw();
}
function renderTrain(scroll) {
  const { t, off } = S.sel;
  const m = S.minute + off;
  const p = locate(t, m);
  const st = t[5], name = i => S.stations[i][1];
  let status;
  if (!p) status = m < st[0][2] ? `尚未發車・${hhmm(st[0][2])} 從${name(st[0][0])}出發` : `已抵達終點${name(st[st.length - 1][0])}（${hhmm(st[st.length - 1][1])}）`;
  else if (p.dwell) status = `停靠 ${name(st[p.at][0])}・${hhmm(st[p.at][2])} 開`;
  else { const n = st[p.at + 1]; status = `往 ${name(n[0])}・預計 ${hhmm(n[1])} 到，還有 ${Math.max(0, Math.ceil(n[1] - m))} 分`; }
  const c = COLOR[t[1]] || COLOR['其他'];
  const cur = p ? (p.dwell ? p.at : p.at + 1) : (m < st[0][2] ? 0 : st.length);
  const html = `<div class="ptitle"><h2>${t[0]}</h2><span class="tag" style="background:${c}">${t[1]}</span></div>
    <p class="route">${name(t[2])} → ${name(t[3])}・${st.length} 站・${hhmm(st[0][2])}–${hhmm(st[st.length - 1][1])}</p>
    <p class="status${p ? '' : ' wait'}">${status}</p>
    <ol class="stops">${st.map((s, i) => `<li data-i="${s[0]}" class="${i < cur ? 'past' : i === cur ? 'cur' : ''}"><span class="d"></span><span>${name(s[0])}</span><time>${i === 0 ? hhmm(s[2]) : s[1] === s[2] || i === st.length - 1 ? hhmm(s[1]) : hhmm(s[1]) + '–' + hhmm(s[2])}</time></li>`).join('')}</ol>
    ${t[4] ? `<p class="muted">${t[4].replace(/[<>&]/g, '')}</p>` : ''}`;
  if (html !== S.lastHtml) {
    $('#pbody').innerHTML = html; S.lastHtml = html; $('#panel').hidden = false;
    if (scroll) { const el = $('#pbody .cur'); if (el) el.scrollIntoView({ block: 'center' }); }
  }
}
function selectStation(i, fly) {
  S.sel = null; S.selStation = +i;
  map.getSource('route').setData(fc([]));
  history.replaceState(null, '', '#s=' + S.stations[i][0]);
  renderStation();
  if (fly) map.flyTo({ center: [S.stations[i][2], S.stations[i][3]], zoom: Math.max(map.getZoom(), 11) });
  draw();
}
function renderStation() {
  const i = S.selStation; S.boardMinute = Math.floor(S.minute);
  const rows = [];
  for (const [date, off] of [[S.date, 0], [shiftDate(S.date, -1), 1440]]) {
    const day = S.days[date];
    if (!day || day.then) continue;
    for (const t of day.trains) {
      const k = t[5].findIndex(s => s[0] === i);
      if (k < 0 || k === t[5].length - 1) continue;
      const dep = t[5][k][2] - off;
      if (dep >= S.minute - 1 && dep <= S.minute + 180) rows.push({ t, dep, key: `${t[0]}@${off ? 'y' : 'd'}` });
    }
  }
  rows.sort((a, b) => a.dep - b.dep);
  $('#pbody').innerHTML = `<div class="ptitle"><h2 style="font-family:inherit">${S.stations[i][1]}</h2></div>
    <p class="route">接下來 3 小時的發車（${rows.length} 班）</p>
    ${rows.length ? `<table class="board"><tbody>${rows.slice(0, 40).map(r => `<tr data-key="${r.key}"><td class="m">${hhmm(r.dep)}</td><td class="m">${r.t[0]}</td><td><span class="tag" style="background:${COLOR[r.t[1]] || COLOR['其他']}">${r.t[1]}</span></td><td>往 ${S.stations[r.t[3]][1]}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">這段時間沒有車。</p>'}`;
  S.lastHtml = null; $('#panel').hidden = false;
}
$('#pbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-key]'); if (tr) return selectTrain(tr.dataset.key, true);
  const li = e.target.closest('li[data-i]'); if (li) selectStation(li.dataset.i, true);
});
$('#close').addEventListener('click', () => { S.sel = null; S.selStation = null; $('#panel').hidden = true; map.getSource('route').setData(fc([])); history.replaceState(null, '', location.pathname); draw(); });

// --- search ---------------------------------------------------------------
function suggestions(q) {
  q = q.trim(); if (!q) return [];
  const out = [];
  S.stations.forEach((s, i) => { if (s[1].includes(q)) out.push({ label: s[1] + '站', sub: '車站', go: () => selectStation(i, true) }); });
  const seen = new Set();
  for (const [date, off] of [[S.date, 0], [shiftDate(S.date, -1), 1440]]) {
    const day = S.days[date]; if (!day || day.then) continue;
    for (const t of day.trains) if (t[0].startsWith(q) && !seen.has(t[0] + off)) {
      if (off && !(t[5][t[5].length - 1][1] > 1440)) continue;
      seen.add(t[0] + off);
      out.push({ label: t[0] + ' 次', sub: `${t[1]}・${S.stations[t[2]][1]}→${S.stations[t[3]][1]}`, go: () => selectTrain(`${t[0]}@${off ? 'y' : 'd'}`, true) });
    }
  }
  return out.slice(0, 12);
}
let sugg = [];
$('#q').addEventListener('input', e => {
  sugg = suggestions(e.target.value);
  const ul = $('#sugg');
  ul.innerHTML = sugg.map((s, i) => `<li role="option" data-i="${i}"${i ? '' : ' aria-selected="true"'}><span>${s.label}</span><small>${s.sub}</small></li>`).join('');
  ul.hidden = !sugg.length;
});
$('#sugg').addEventListener('click', e => { const li = e.target.closest('li'); if (li) { sugg[+li.dataset.i].go(); $('#sugg').hidden = true; $('#q').blur(); } });
$('#find').addEventListener('submit', e => { e.preventDefault(); if (sugg[0]) { sugg[0].go(); $('#sugg').hidden = true; $('#q').blur(); } });
document.addEventListener('click', e => { if (!e.target.closest('.find')) $('#sugg').hidden = true; });

// --- time controls ----------------------------------------------------------
function setMode() {
  $('#mode').textContent = S.live ? '即時' : '回放';
  $('#mode').classList.toggle('replay', !S.live);
  $('#live').classList.toggle('on', S.live);
  for (const b of document.querySelectorAll('.speeds .btn')) b.classList.toggle('on', !S.live && +b.dataset.speed === S.speed);
  $('#date').textContent = fmtDate(S.date) + (S.live ? '' : '・依時刻表回放');
}
async function setDate(date) {
  S.date = date; $('#day').value = date;
  await Promise.all([loadDay(date), loadDay(shiftDate(date, -1))]);
  if (S.sel) { const f = findTrain(S.sel.key); if (f) Object.assign(S.sel, f); else S.sel = null; }
  setMode(); draw();
}
$('#live').addEventListener('click', () => { S.live = true; const n = taipeiNow(); setDate(n.date); });
for (const b of document.querySelectorAll('.speeds .btn')) b.addEventListener('click', () => { S.live = false; S.speed = +b.dataset.speed; setMode(); });
$('#slider').addEventListener('input', e => { S.live = false; if (S.speed > 600) S.speed = 0; S.minute = +e.target.value; setMode(); draw(); });
$('#day').addEventListener('change', e => { S.live = false; setDate(e.target.value); });

// --- boot -------------------------------------------------------------------
(async () => {
  const [meta, stations, paths, lines] = await Promise.all(['meta', 'stations', 'paths', 'lines'].map(n => getJSON(`data/${n}.json`)));
  Object.assign(S, { meta, stations, paths, lines });
  $('#types').innerHTML = TYPES.map(([t, c]) => `<button type="button" data-t="${t}" aria-pressed="true"><i style="background:${c}"></i>${t} <small>0</small></button>`).join('');
  $('#types').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const t = b.dataset.t; S.hidden.has(t) ? S.hidden.delete(t) : S.hidden.add(t); b.setAttribute('aria-pressed', String(!S.hidden.has(t))); draw(); });
  $('#day').innerHTML = meta.dates.map(d => `<option value="${d}">${fmtDate(d)}</option>`).join('');
  const n = taipeiNow();
  S.minute = n.minute;
  await setDate(meta.dates.includes(n.date) ? n.date : meta.dates[0]);
  if (!meta.dates.includes(n.date)) { S.live = false; S.speed = 60; S.minute = 480; setMode(); }
  const start = () => {
    addLayers();
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('t')) { const k = `${h.get('t')}@d`; if (findTrain(k)) selectTrain(k, true); }
    else if (h.get('s')) { const i = S.stations.findIndex(s => s[0] === h.get('s')); if (i >= 0) selectStation(i, true); }
    $('#d3').addEventListener('click', () => set3D(!Terrain3D.on));
    let want3d = false; try { want3d = localStorage.getItem('rail.3d') === '1' || new URLSearchParams(location.search).has('3d'); } catch {}
    if (want3d) set3D(true);
    requestAnimationFrame(frame);
    document.documentElement.dataset.ready = '1';
  };
  map.loaded() ? start() : map.on('load', start);
})().catch(e => { document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:50%;width:100%;text-align:center;color:#f87171">載入失敗：${String(e.message).replace(/</g, '')}</p>`); });
