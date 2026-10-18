// 光影台灣 — MapLibre 3D terrain whose hillshade follows the real sun over Taiwan.
import { PEAKS, VIEWS, sunAt, lighting, firstLight } from './light.js';

const A = window.Astronomy, $ = s => document.querySelector(s);
const store = { get(k, d) { try { const v = localStorage.getItem('relief.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('relief.' + k, JSON.stringify(v)); } catch {} } };
const HM = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
const HMS = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' });
const midnight = () => { const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); return new Date(s + 'T00:00:00+08:00'); };
const DIR8 = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const ui = { t: new Date(), live: true, view: store.get('view', 'central'), playing: false };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const v0 = VIEWS.find(v => v.id === ui.view) || VIEWS[1];
const L0 = lighting(sunAt(A, ui.t));
const map = new maplibregl.Map({
  container: 'map', center: v0.center, zoom: v0.zoom, pitch: v0.pitch, bearing: v0.bearing, maxPitch: 80, attributionControl: { compact: true },
  maxBounds: [[117.5, 20.5], [124.5, 26.8]],
  style: {
    version: 8,
    sources: {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 17, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Terrain: Tilezen / AWS Open Data' },
      hill: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13 },
      places: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 15 },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': L0.sky } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': L0.brightness, 'raster-saturation': L0.saturation } },
      { id: 'shade', type: 'hillshade', source: 'hill', paint: { 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': L0.direction, 'hillshade-exaggeration': L0.exaggeration, 'hillshade-highlight-color': L0.highlight, 'hillshade-shadow-color': L0.shadow, 'hillshade-accent-color': L0.accent } },
      { id: 'places', type: 'raster', source: 'places', maxzoom: 10.5, paint: { 'raster-opacity': 0.75 } },
    ],
    terrain: { source: 'dem', exaggeration: 1.5 },
    sky: { 'sky-color': L0.sky, 'horizon-color': L0.horizon, 'fog-color': L0.horizon, 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2, 'atmosphere-blend': 0.6 },
  },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.on('error', e => { if (!String(e.error?.message || '').includes('Failed to fetch')) console.warn(e.error?.message); });

// ---- light
let applied = '';
function applyLight() {
  const sun = sunAt(A, ui.t), L = lighting(sun), key = JSON.stringify(L);
  $('#phase').textContent = L.phase;
  $('#sunline').textContent = sun.alt > -1 ? `太陽在${DIR8[Math.round(sun.az / 45) % 8]}方・高度 ${sun.alt.toFixed(0)}°` : `太陽在地平線下 ${(-sun.alt).toFixed(0)}°`;
  if (key === applied || !map.isStyleLoaded()) return; applied = key;
  map.setPaintProperty('shade', 'hillshade-illumination-direction', L.direction);
  map.setPaintProperty('shade', 'hillshade-exaggeration', L.exaggeration);
  map.setPaintProperty('shade', 'hillshade-highlight-color', L.highlight);
  map.setPaintProperty('shade', 'hillshade-shadow-color', L.shadow);
  map.setPaintProperty('shade', 'hillshade-accent-color', L.accent);
  map.setPaintProperty('sat', 'raster-brightness-max', L.brightness);
  map.setPaintProperty('sat', 'raster-saturation', L.saturation);
  map.setPaintProperty('places', 'raster-opacity', 0.45 + 0.35 * L.brightness);
  map.setPaintProperty('bg', 'background-color', L.sky);
  map.setSky({ 'sky-color': L.sky, 'horizon-color': L.horizon, 'fog-color': L.horizon, 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2, 'atmosphere-blend': 0.6 });
}
function setTime(t, live) {
  ui.t = t; ui.live = live;
  const min = Math.round((t - midnight()) / 60000); $('#slider').value = String(Math.max(0, Math.min(1439, min)));
  $('#clock').textContent = `${DAY.format(t)} ${HM.format(t)}${live ? '・現在' : ''}`;
  applyLight();
}
map.on('load', () => { applied = ''; applyLight(); document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'); });  // start collapsed: it sits under the view buttons on phones
$('#slider').addEventListener('input', e => setTime(new Date(+midnight() + +e.target.value * 60000), false));
$('#now').addEventListener('click', () => setTime(new Date(), true));
let playT = null;
$('#play').addEventListener('click', () => {
  ui.playing = !ui.playing; $('#play').setAttribute('aria-pressed', String(ui.playing)); $('#play').textContent = ui.playing ? '❚❚' : '▶';
  clearInterval(playT); if (ui.playing) playT = setInterval(() => { let m = +$('#slider').value + 3; if (m > 1439) m = 0; setTime(new Date(+midnight() + m * 60000), false); }, 60);
});
setInterval(() => { if (ui.live && document.visibilityState === 'visible') setTime(new Date(), true); }, 60000);

// ---- views
$('#views').append(...VIEWS.map(v => { const b = document.createElement('button'); b.type = 'button'; b.dataset.view = v.id; b.textContent = v.label; b.onclick = () => fly(v); return b; }));
function fly(v) {
  ui.view = v.id; store.set('view', v.id);
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v.id)));
  map.flyTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, duration: reduced ? 0 : 2600, essential: true });
}
document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));

// ---- peaks + first light
const ranks = firstLight(A, midnight());
$('#dayLabel').textContent = DAY.format(midnight());
for (const p of PEAKS) {
  const el = document.createElement('div'); el.className = 'peak'; el.textContent = `${p.name} ${p.ele}`;
  const r = ranks.find(x => x.name === p.name);
  const pop = new maplibregl.Popup({ offset: 12, closeButton: true }).setHTML(`<b>${p.name}</b>　${p.ele} 公尺${p.note ? `<br>${p.note}` : ''}<br>今天日出 ${r?.rise ? HMS.format(r.rise) : '—'}${r?.gain > 30 ? `（比海平面早 ${Math.round(r.gain / 60)} 分鐘）` : ''}`);
  new maplibregl.Marker({ element: el, anchor: p.anchor || 'bottom' }).setLngLat([p.lon, p.lat]).setPopup(pop).addTo(map);
}
$('#first').append(...ranks.map(r => {
  const li = document.createElement('li'); li.tabIndex = 0;
  li.innerHTML = `<span>${r.name}<span class="m">　${r.ele} m</span></span><span class="t">${r.rise ? HMS.format(r.rise) : '—'}</span>`;
  const go = () => { map.flyTo({ center: [r.lon, r.lat], zoom: 12, pitch: 70, bearing: 90, duration: reduced ? 0 : 2400 }); if (r.rise) setTime(new Date(+r.rise + 5 * 60000), false); };
  li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  return li;
}));

setTime(new Date(), true);
window.__relief = { ui, map, setTime, get ranks() { return ranks; } };
