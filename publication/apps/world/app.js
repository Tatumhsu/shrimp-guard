// 全球關注 — renders the bundled public day snapshots.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDay = d => `${+d.slice(4, 6)} 月 ${+d.slice(6)} 日`;
const wan = n => n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)} 萬` : String(n);
const PALETTE = ['#ffb454', '#7cc6e8', '#e57a9a', '#9ed37c', '#c59cf0', '#f0d264', '#6fd3c0', '#f08a5d', '#8fa8ff', '#d7a86e', '#b3e07a', '#ef9fd4', '#5fb7ff', '#e6c08a', '#9bd0b7', '#ff9f80', '#a0a7ff', '#d8e36a', '#7fd6ea', '#e98bb3', '#b9c08a'];
let doc = null, layer = null, sel = null, colorOf = {};
async function api(p) {
  let file = 'days';
  if (p !== 'world/days') {
    let day = p.startsWith('world/') ? p.slice(6) : '';
    if (day === 'latest') {
      const index = await api('world/days');
      day = [...index.days].sort().at(-1);
    }
    if (!/^\d{8}$/.test(day || '')) throw new Error('這一天沒有公開版資料');
    file = day;
  }
  const r = await fetch(`data/api/${file}.json`);
  if (!r.ok) throw new Error('這一天沒有公開版資料');
  return r.json();
}

const map = L.map('map', { zoomSnap: 0.25, minZoom: 1, maxZoom: 5, worldCopyJump: true, attributionControl: false }).setView([25, 30], 1.6);
let countries = null;
async function loadWorld() { const w = await (await fetch('data/countries-110m.json')).json(); countries = topojson.feature(w, w.objects.countries); countries.features = countries.features.filter(f => f.id !== '010'); countries.features.forEach(unwrap); }   // no Antarctica
// rings that cross the 180° line (Russia, Fiji, the Aleutians) would be drawn as a band across the map: move their west half past 180
function unwrap(f) {
  const fix = ring => { const xs = ring.map(c => c[0]); if (Math.max(...xs) - Math.min(...xs) > 180) ring.forEach(c => { if (c[0] < 0) c[0] += 360; }); };
  const g = f.geometry; (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach(poly => poly.forEach(fix));
}
const langOfCountry = id => doc && Object.entries(doc.langs).find(([, v]) => v.countries.includes(id))?.[0];

function drawMap() {
  layer?.remove();
  layer = L.geoJSON(countries, {
    style: f => { const l = langOfCountry(f.id); return { color: '#0c1117', weight: 0.6, fillColor: l ? colorOf[l] : getComputedStyle(document.documentElement).getPropertyValue('--none'), fillOpacity: l ? (sel && sel !== l ? 0.3 : 0.85) : 1 }; },
    onEachFeature: (f, ly) => {
      const l = langOfCountry(f.id);
      ly.bindTooltip(`${esc(f.properties.name)}${l ? `・${esc(doc.langs[l].name)}` : '・沒有收錄'}`, { sticky: true, className: 'cn' });
      if (l) ly.on('click', () => pick(l));
    },
  }).addTo(map);
}
function pick(l) {
  sel = l; layer && layer.setStyle(layer.options.style);
  document.querySelectorAll('#langs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === l)));
  const r = doc.regions[l];
  if (!r) { $('#region').innerHTML = `<h4>${esc(doc.langs[l].name)}</h4><p class="rs">這一天沒有這個語言的資料。</p>`; return; }
  $('#region').innerHTML = `<h4>${esc(r.name)}維基百科</h4><p class="rs">${esc(r.summary)}</p><ol>${r.items.map(it =>
    `<li><b>${esc(it.title_zh)}</b>${it.shared >= 3 ? `<span class="badge">${it.shared} 語言共同</span>` : ''}<div class="o"><a href="${esc(it.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(it.title)}</a>・${wan(it.views)} 次閱讀</div><p>${esc(it.why)}</p></li>`).join('')}</ol>`;
}
function render() {
  $('#status').hidden = true;
  colorOf = Object.fromEntries(Object.keys(doc.langs).map((l, i) => [l, PALETTE[i % PALETTE.length]]));
  $('#headline').textContent = doc.headline; $('#summary').textContent = doc.summary; $('#hero').hidden = false;
  $('#topicCards').innerHTML = doc.topics.map(t => `<article class="card"><span class="cat">${esc(t.category)}</span><h4>${esc(t.title_zh)}</h4><p>${esc(t.why)}</p>` +
    `<span class="n">${Object.keys(t.langs).length} 種語言上榜・共 ${wan(t.views)} 次閱讀</span><div class="ll">${Object.entries(t.langs).map(([l, v]) => `<a href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}">${esc(doc.langs[l]?.name || l)} #${v.rank}</a>`).join('')}</div></article>`).join('');
  $('#topics').hidden = !doc.topics.length; $('#mapsec').hidden = false;
  $('#langs').innerHTML = Object.entries(doc.langs).filter(([l]) => doc.regions[l]).map(([l, v]) => `<button type="button" data-l="${l}" aria-pressed="false"><i style="background:${colorOf[l]}"></i>${esc(v.name)}</button>`).join('');
  drawMap(); map.invalidateSize();
  pick(doc.regions.zh ? 'zh' : Object.keys(doc.regions)[0]);
}
$('#langs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pick(b.dataset.l); });

async function open(day) {
  $('#hero').hidden = $('#topics').hidden = $('#mapsec').hidden = true;
  try {
    const j = await api('world/' + (day || 'latest'));
    if (j.status === 'done') { doc = j.doc; render(); return; }
  } catch (_) { /* Missing snapshots have the same plain public message. */ }
  doc = null;
  $('#status').hidden = false;
  $('#status').textContent = '這一天沒有公開版資料';
}
(async () => {
  try {
    await loadWorld();
    const d = await api('world/days');
    const list = [...new Set(d.days)].sort().reverse();
    $('#day').innerHTML = list.map(x => `<option value="${x}">${fmtDay(prevDay(x))} 的閱讀</option>`).join('');
    $('#day').addEventListener('change', e => open(e.target.value));
    await open('latest');
  } catch (_) { $('#status').hidden = false; $('#status').textContent = '這一天沒有公開版資料'; }
  document.documentElement.dataset.ready = '1';
})();
function prevDay(d) { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6)) - 86400000); return t.toISOString().slice(0, 10).replace(/-/g, ''); }
window.__world = { get doc() { return doc; }, pick };
