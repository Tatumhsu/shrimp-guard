// 台灣鄉鎮圖鑑 — 368 townships: map, profile cards, search, today's pick, stamps (集章, browser-only).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem('towns.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('towns.' + k, JSON.stringify(v)); } catch {} } };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// tag families → colours
const FAM = [
  ['海與島', '#3b82c4', ['海港', '漁村', '海岸', '離島', '濕地']], ['山與森林', '#2f855a', ['山城', '高山', '森林', '溫泉']],
  ['田園', '#b7791f', ['茶鄉', '果鄉', '稻米', '農村']], ['人文', '#c05621', ['客家', '原住民', '眷村', '老街', '宗教信仰', '古蹟']],
  ['城市', '#6b46c1', ['都會', '商圈', '大學城']], ['產業', '#4a5568', ['科技園區', '工業']],
];
const famOf = tag => FAM.find(f => f[2].includes(tag));
const ui = { color: ['tag', 'rail', 'stamp'].includes(store.get('color', 'tag')) ? store.get('color', 'tag') : 'tag', sel: null, stamps: new Set(store.get('stamps', [])) };
let towns = [], byId = {}, prof = {}, layer = null, geo = null;

const map = L.map('map', { zoomSnap: 0.25, minZoom: 6.5, maxZoom: 13, attributionControl: true }).setView([23.75, 120.9], 7.5);
map.attributionControl.setPrefix('');

function fillOf(t) {
  const p = prof[t.id];
  if (ui.color === 'stamp') return ui.stamps.has(t.id) ? css('--stamp') : css('--land');
  if (ui.color === 'rail') return t.stations.length ? '#2f855a' : css('--land');
  const f = p && p.tags && p.tags.map(famOf).find(Boolean); return f ? f[1] : css('--land');
}
function style(f) {
  const t = byId[f.properties.TOWNCODE], sel = ui.sel === t.id;
  return { color: sel ? css('--ink') : css('--paper'), weight: sel ? 2.5 : 0.7, fillColor: fillOf(t), fillOpacity: ui.color === 'tag' || ui.color === 'rail' ? 0.72 : 1 };
}
function legend() {
  const L = ui.color === 'tag' ? FAM.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('') + `<span><i style="background:${css('--land')}"></i>資料不足</span>`
    : ui.color === 'rail' ? `<span><i style="background:#2f855a"></i>有台鐵車站</span><span><i style="background:${css('--land')}"></i>沒有</span>`
    : `<span><i style="background:${css('--stamp')}"></i>去過（已蓋章）</span><span>${ui.stamps.size} / ${towns.length}</span>`;
  $('#legend').innerHTML = L;
}
function restyle() { layer && layer.setStyle(style); legend(); document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === ui.color))); }

function card(t) {
  const p = prof[t.id] || {};
  const famChips = (p.tags || []).map(tag => `<span class="chip" style="background:${(famOf(tag) || [0, '#8d867b'])[1]}">${esc(tag)}</span>`).join('');
  const st = ui.stamps.has(t.id);
  $('#card').innerHTML = `<div class="county">${esc(t.county)}</div><h2>${esc(t.town)}</h2><div class="eng">${esc(t.eng)}</div>` +
    (p.one_line ? `<p class="one">${esc(p.one_line)}</p>` : '<p class="one empty">這裡的介紹還在整理中。</p>') + (p.vibe ? `<p class="vibe">${esc(p.vibe)}</p>` : '') +
    (famChips ? `<div class="chips">${famChips}</div>` : '') +
    ((p.highlights || []).length ? `<ul class="hl">${p.highlights.map(h => `<li><b>${esc(h.kind)}</b><span>${esc(h.text)}</span></li>`).join('')}</ul>` : '') +
    (p.fun_fact ? `<div class="fun">小知識：${esc(p.fun_fact)}</div>` : '') +
    `<dl class="facts"><dt>美食</dt><dd>美食大蒐集收錄 ${t.food.toLocaleString()} 家<br><span class="low">（收錄數受各縣市公開資料多寡影響，不代表實際店家多少）</span></dd><dt>台鐵</dt><dd>${t.stations.length ? esc(t.stations.join('、')) : '沒有台鐵車站'}</dd></dl>` +
    (p.confidence === 'low' ? '<p class="low">這裡的公開資料比較少，介紹寫得比較保守。</p>' : '') +
    `<div class="acts"><button type="button" class="stampbtn" id="stampBtn" aria-pressed="${st}">${st ? '已蓋章 ✓' : '我去過，蓋章'}</button>` +
    (t.wiki ? `<a href="${esc(t.wiki)}" target="_blank" rel="noopener">維基百科：${esc(t.wikiTitle)}</a>` : '') + `</div>`;
  $('#stampBtn').onclick = () => toggleStamp(t.id);
}
function select(id, fly = true, keepUrl = false) {
  const t = byId[id]; if (!t) return;
  ui.sel = id; restyle(); card(t);
  if (!keepUrl) history.replaceState(null, '', '#' + id);   // today's pick on arrival leaves the URL alone
  if (fly) { const f = geo.features.find(x => x.properties.TOWNCODE === id); const b = L.geoJSON(f).getBounds(); map.flyToBounds(b, { maxZoom: Math.max(map.getZoom(), 10), padding: [40, 40], duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.7 }); }
  if (innerWidth <= 980 && fly) $('#card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function toggleStamp(id) {
  ui.stamps.has(id) ? ui.stamps.delete(id) : ui.stamps.add(id); store.set('stamps', [...ui.stamps]);
  card(byId[id]); restyle(); passport();
}
function passport() {
  $('#stampCount').textContent = `${ui.stamps.size} / ${towns.length}`;
  const counties = [...new Set(towns.map(t => t.county))];
  $('#stampBar').innerHTML = counties.map(c => { const all = towns.filter(t => t.county === c), got = all.filter(t => ui.stamps.has(t.id)).length; return `<div class="cbar">${esc(c)} ${got}/${all.length}<div class="track"><i style="width:${(got / all.length * 100).toFixed(0)}%"></i></div></div>`; }).join('');
  $('#stampList').innerHTML = [...ui.stamps].map(id => byId[id]).filter(Boolean).map(t => `<button type="button" data-id="${t.id}">${esc(t.county.replace(/[縣市]$/, ''))}${esc(t.town)}</button>`).join('') || '<span class="empty">還沒有蓋章。點地圖上的鄉鎮，按「我去過，蓋章」。</span>';
}
$('#stampList').addEventListener('click', e => { const b = e.target.closest('button'); if (b) select(b.dataset.id); });

// search
const q = $('#q'), sugg = $('#sugg'); let hits = [], hi = 0;
function suggest() {
  const s = q.value.trim().replace(/台/g, '臺'); if (!s) { sugg.hidden = true; return; }
  hits = towns.filter(t => (t.county + t.town).includes(s) || t.eng.toLowerCase().includes(s.toLowerCase()) || (prof[t.id]?.one_line || '').includes(s)).slice(0, 12); hi = 0;
  sugg.innerHTML = hits.map((t, i) => `<li role="option" data-id="${t.id}" aria-selected="${i === hi}">${esc(t.town)}<small>${esc(t.county)}</small></li>`).join('') || '<li>找不到</li>';
  sugg.hidden = false;
}
q.addEventListener('input', suggest);
q.addEventListener('keydown', e => {
  if (sugg.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; [...sugg.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === hi))); }
  if (e.key === 'Escape') sugg.hidden = true;
});
$('#find').addEventListener('submit', e => { e.preventDefault(); if (hits[hi]) { select(hits[hi].id); sugg.hidden = true; q.blur(); } });
sugg.addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) { select(li.dataset.id); sugg.hidden = true; } });
document.addEventListener('click', e => { if (!e.target.closest('.find')) sugg.hidden = true; });

document.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => { ui.color = b.dataset.color; store.set('color', ui.color); restyle(); }));
const todayId = () => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()).replace(/-/g, ''); let h = 0; for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0; return towns[h % towns.length].id; };
$('#today').addEventListener('click', () => select(todayId()));
$('#random').addEventListener('click', () => select(towns[Math.floor(Math.random() * towns.length)].id));

(async () => {
  const [topo, list, profiles] = await Promise.all(['towns-10t', 'towns', 'profiles'].map(n => fetch(`data/${n}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))));
  towns = list; byId = Object.fromEntries(towns.map(t => [t.id, t])); prof = profiles || {};
  geo = topojson.feature(topo, topo.objects.towns);
  const land = L.geoJSON(topojson.feature(topo, topo.objects.nation), { interactive: false, style: { color: css('--ink3'), weight: 1, fill: false } });
  layer = L.geoJSON(geo, { style, onEachFeature: (f, l) => {
    const t = byId[f.properties.TOWNCODE];
    l.bindTooltip(`${t.town}<small style="color:var(--ink3)"> ${t.county}</small>`, { sticky: true, className: 'tname', direction: 'top' });
    l.on('click', () => select(t.id, false));
  } }).addTo(map); land.addTo(map);
  map.fitBounds(layer.getBounds(), { padding: [10, 10] });
  restyle(); passport();
  const h = location.hash.slice(1); select(byId[h] ? h : todayId(), !!byId[h], !byId[h]);
  if (!byId[h]) $('#card').insertAdjacentHTML('afterbegin', '<div class="county" style="color:var(--stamp)">今日鄉鎮</div>');
  document.documentElement.dataset.ready = '1';
})();
window.__towns = { ui, select, get towns() { return towns; }, get prof() { return prof; } };
