'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const CATS = {snack: '小吃', restaurant: '餐廳', nightmarket: '夜市攤位', breakfast: '早餐', dessert: '甜點', coffee: '咖啡茶飲', latenight: '宵夜', gift: '伴手禮', unclassified: '未分類'};
const CAT_ICON = {snack: '🍜', restaurant: '🍱', nightmarket: '🏮', breakfast: '🥪', dessert: '🍧', coffee: '☕', latenight: '🌙', gift: '🎁', unclassified: '🍴'};
const CODE_CAT = {s: 'snack', r: 'restaurant', n: 'nightmarket', b: 'breakfast', d: 'dessert', c: 'coffee', l: 'latenight', g: 'gift', u: 'unclassified'};
const PAGE = 30, MAP_MAX = 500;
const PLACEHOLDER_WIDE = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 260'><rect width='400' height='260' fill='#f3e7da'/><text x='200' y='125' font-size='48' text-anchor='middle'>🍽️</text><text x='200' y='170' font-size='16' text-anchor='middle' fill='#8b7a6c' font-family='sans-serif'>來源未提供照片</text></svg>`).replace(/'/g, '%27');

const S = {index: null, lite: {}, loading: {}, details: {}, origin: null, originKind: null, city: null, radius: 1500, cat: 'all', query: '', mode: 'near', view: 'list', shown: PAGE, selected: null, favs: [], map: null, cluster: null, meMarker: null, selMarker: null, allRequested: false};
try { S.favs = JSON.parse(localStorage.getItem('food-collect-favs-v1') || '[]'); } catch {}

function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 3200); }
function distM(a, b) { const R = 6371000, p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180, dp = p2 - p1, dl = (b.lon - a.lon) * Math.PI / 180; const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function fmtDist(m) { if (m == null) return ''; return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
function isFav(id) { return S.favs.some(f => f.id === id); }
function saveFavs() { try { localStorage.setItem('food-collect-favs-v1', JSON.stringify(S.favs)); } catch {} }
function toggleFav(id, city, ck) { if (isFav(id)) S.favs = S.favs.filter(f => f.id !== id); else S.favs.push({id, city, ck: Number(ck)}); saveFavs(); toast(isFav(id) ? '已收藏（只存在這部裝置）' : '已取消收藏'); rerender(); }
function cityOf(name) { return S.index.cities.find(c => c.name === name); }
function nearestCity(p) { return S.index.cities.map(c => ({c, d: distM(p, c)})).sort((a, b) => a.d - b.d)[0].c; }
function citiesAround(p, km) { return S.index.cities.filter(c => distM(p, c) <= km * 1000).map(c => c.name); }

/* ---------- data loading (per-city lite rows, lazily) ---------- */
function decode(row, city) { const cats = {}; for (const ch of row[5]) cats[CODE_CAT[ch.toLowerCase()]] = ch === ch.toUpperCase() ? 'hours' : 'code'; return {id: row[0], name: row[1], city, town: row[2], lat: row[3], lon: row[4], cats, photo: !!row[6], src: row[7] ? 'osm' : 'ta', hid: row[8], rec: row[9], nb: row[10], ck: row[11]}; }
function loadLite(city) {
  if (S.lite[city]) return Promise.resolve(S.lite[city]);
  if (!S.loading[city]) S.loading[city] = fetch(`data/lite/${encodeURIComponent(city)}.json`).then(r => { if (!r.ok) throw Error(city + ' ' + r.status); return r.json(); }).then(rows => { S.lite[city] = rows.map(r => decode(r, city)); return S.lite[city]; }).catch(e => { delete S.loading[city]; throw e; });
  return S.loading[city];
}
function loadAllLite() { if (!S.allRequested) { S.allRequested = true; for (const c of S.index.cities) loadLite(c.name).then(() => { if (S.query) scheduleRender(); }).catch(() => {}); } }
// details are sharded per city into 400-shop chunks; a lite row's ck says which one
const ckey = (city, ck) => city + '#' + ck;
async function loadChunk(city, ck) { const k = ckey(city, ck); if (!S.details[k]) { if (!S.loading[k]) S.loading[k] = fetch(`data/city/${encodeURIComponent(city)}-${ck}.json`).then(r => { if (!r.ok) throw Error('chunk ' + r.status); return r.json(); }).then(d => { S.details[k] = Object.fromEntries(d.shops.map(s => [s.id, s])); return S.details[k]; }).catch(e => { delete S.loading[k]; throw e; }); return S.loading[k]; } return S.details[k]; }
function detailOf(s) { return S.details[ckey(s.city, s.ck)]?.[s.id]; }
async function loadDetail(id, city, ck) { return loadChunk(city, ck).then(c => c[id]); }
function loadedRows(cities) { return cities.flatMap(c => S.lite[c] || []); }
function scopeCities() {
  if (S.query) return S.index.cities.map(c => c.name);                       // live search = whole Taiwan
  if (S.origin && S.radius) return citiesAround(S.origin, 60);
  if (S.city) return [S.city];
  if (S.origin) return [nearestCity(S.origin).name];
  return [];
}
async function ensureScope() { const cs = scopeCities(); if (S.query) loadAllLite(); else await Promise.all(cs.map(c => loadLite(c).catch(() => {}))); return cs; }

/* ---------- query ---------- */
function matchQuery(s) {
  const q = S.query.toLowerCase().replace(/台/g, '臺');
  const hay = [s.name, s.city, s.town, Object.keys(s.cats).map(k => CATS[k]).join(' ')].join(' ').toLowerCase().replace(/台/g, '臺');
  return q.split(/\s+/).every(w => hay.includes(w));
}
function results(cities) {
  let rows = loadedRows(cities).map(s => ({...s, d: S.origin ? distM(S.origin, s) : null}));
  if (!S.query && S.origin && S.radius) rows = rows.filter(s => s.d <= S.radius);
  if (S.cat !== 'all') rows = rows.filter(s => s.cats[S.cat]);
  if (S.query) rows = rows.filter(matchQuery);
  if (S.mode === 'hidden') rows = rows.filter(s => s.hid >= 1);
  if (S.mode === 'rec') rows = rows.filter(s => s.rec >= 2 && !s.cats.gift || (S.cat === 'gift' && s.rec >= 1));
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant');
  if (S.mode === 'hidden') rows.sort((a, b) => b.hid - a.hid || (a.d ?? 0) - (b.d ?? 0) || b.rec - a.rec || byName(a, b));
  else if (S.mode === 'rec') rows.sort((a, b) => b.rec - a.rec || (a.d ?? 0) - (b.d ?? 0) || byName(a, b));
  else if (S.query) rows.sort((a, b) => (b.name.includes(S.query) - a.name.includes(S.query)) || (a.d ?? 0) - (b.d ?? 0) || byName(a, b));
  else rows.sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || byName(a, b));
  return rows;
}

/* ---------- cards ---------- */
function reasons(s, det) {
  const r = [];
  if (det?.image) r.push('有照片'); if ((det?.descLen || 0) >= 50) r.push('有介紹'); if (det?.hours) r.push('有營業時間');
  if (det && det.codes && det.codes.some(c => [1, 100, 113, 114, 115].includes(c))) r.push('在地品項');
  if (s.src === 'osm' && det?.codeLabels?.length > 1) r.push('有料理標記');
  return r;
}
function hidMeter(h) { return `<span class="hid-meter" title="隱藏指數 ${h}/3">${[1, 2, 3].map(i => `<i class="${h >= i ? 'on' : ''}"></i>`).join('')}</span>`; }
function cardHtml(s, det) {
  const tags = Object.entries(s.cats).map(([k, basis]) => `<span class="tag${k === 'gift' ? ' gift' : k === 'unclassified' ? ' unc' : ''}">${CATS[k]}${basis === 'hours' ? '*' : ''}</span>`).join('');
  const src = s.src === 'osm' ? '<span class="tag osm">OSM</span>' : '<span class="tag src">觀光署</span>';
  const hid = s.hid >= 1 ? `<span class="tag hid">🕵️ 隱藏 ${hidMeter(s.hid)}</span>` : '';
  const why = S.mode === 'rec' && det ? reasons(s, det).slice(0, 3).map(w => `<span class="tag why">${w}</span>`).join('') : '';
  const img = det?.image ? `<img src="${esc(det.image)}" alt="${esc(s.name)} 的照片（來源提供）" loading="lazy" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${CAT_ICON[Object.keys(s.cats)[0]] || '🍴'}'}))">` : `<span class="ph" aria-hidden="true">${CAT_ICON[Object.keys(s.cats)[0]] || '🍴'}</span>`;
  const place = `${esc(s.city)}${esc(s.town)}${det?.address ? ' · ' + esc(det.address.replace(new RegExp('^' + s.city + '(' + s.town + ')?'), '').replace(/^\d{3,5}/, '')) : ''}`;
  return `<article class="card${S.selected === s.id ? ' card-sel' : ''}" data-card="${s.id}">${img}<div class="card-body"><strong>${esc(s.name)}</strong><div class="tags">${tags}${hid}${src}${why}</div><div class="meta"><span><b>營業時間</b> ${esc((det?.hours || '來源未提供').slice(0, 28))}</span><span>${place}</span>${S.mode === 'hidden' ? `<span>方圓 300 m 內其他登錄店家：${s.nb} 家</span>` : ''}</div></div>${s.d != null ? `<span class="dist">${fmtDist(s.d)}</span>` : ''}<button class="fav-btn${isFav(s.id) ? ' on' : ''}" data-fav="${s.id}" data-city="${esc(s.city)}" data-ck="${s.ck}" aria-label="收藏">${isFav(s.id) ? '♥' : '♡'}</button><button class="card-open" data-open="${s.id}" data-city="${esc(s.city)}" data-ck="${s.ck}" aria-label="查看 ${esc(s.name)}"></button></article>`;
}

/* ---------- main render ---------- */
let renderToken = 0;
function scheduleRender() { clearTimeout(scheduleRender.t); scheduleRender.t = setTimeout(renderResults, 60); }
async function renderResults() {
  const token = ++renderToken;
  const cities = await ensureScope(); if (token !== renderToken) return;
  const rows = results(cities);
  const pending = cities.filter(c => !S.lite[c] && cityOf(c).count > 0);
  const where = S.query ? '全台' : S.originKind === 'gps' ? '你附近' : S.city ? S.city : S.origin ? nearestCity(S.origin).name : '全台';
  const modeName = {near: '附近美食', rec: '推薦給你', hidden: '隱藏美食', fav: '我的收藏'}[S.mode] || '';
  $('#result-title').textContent = S.query ? `搜尋「${S.query}」` : `${where} · ${modeName}`;
  const scopeTxt = S.query ? '全台即時搜尋' + (S.origin ? '，依距離排序' : '') : S.origin && S.radius ? `${S.originKind === 'gps' ? '你目前位置' : '手選中心'} ${S.radius >= 1000 ? S.radius / 1000 + ' km' : S.radius + ' m'} 內` : S.city ? `${S.city}全境` : '';
  $('#result-line').textContent = `${rows.length} 家 · ${scopeTxt}${pending.length ? ` · 載入中 ${pending.length} 縣市…` : ''}${S.mode === 'hidden' ? ' · 依隱藏指數排序' : ''}`;
  $('#cat-chips').innerHTML = `<button class="chip${S.cat === 'all' ? ' chip-on' : ''}" data-cat="all">全部</button>` + Object.keys(CATS).map(k => `<button class="chip${S.cat === k ? ' chip-on' : ''}" data-cat="${k}">${CAT_ICON[k]} ${CATS[k]}</button>`).join('');
  for (const b of $$('[data-dist]')) { b.classList.toggle('chip-on', Number(b.dataset.dist) === S.radius && !S.query); b.disabled = (!S.origin && Number(b.dataset.dist) > 0) || !!S.query; b.classList.toggle('chip-off', b.disabled); }
  $('#rec-tools').hidden = S.mode !== 'rec';
  $('#hidden-note').hidden = S.mode !== 'hidden'; if (S.mode === 'hidden') $('#hidden-note').textContent = S.index.hiddenMethod;
  const pageRows = rows.slice(0, S.shown);
  await Promise.all([...new Set(pageRows.map(s => ckey(s.city, s.ck)))].map(k => loadChunk(...k.split('#')).catch(() => {}))); if (token !== renderToken) return;
  const c = S.city && cityOf(S.city);
  let empty = '';
  if (!rows.length) {
    if (!S.origin && !S.city && !S.query) empty = '<b>還沒有位置。</b><br>允許定位、打字搜尋，或按右上「縣市」手選一個縣市。';
    else if (pending.length) empty = '<b>資料載入中…</b>';
    else if (c && c.status === 'pending') empty = `來源目前沒有${c.name}的店家資料（資料待補），不代表這裡沒有美食。`;
    else empty = `<b>沒有符合的店家。</b><br>${S.query ? '換個關鍵字試試，店名用繁體、台／臺皆可。' : S.mode === 'hidden' ? '這個範圍內登錄店家都很密集；放寬到 5 km 或整個縣市再看看。' : '試試放寬範圍、清除搜尋，或換個分類。'}`;
  }
  $('#list-view').innerHTML = pageRows.length ? pageRows.map(s => cardHtml(s, detailOf(s))).join('') : `<p class="empty">${empty}</p>`;
  $('#more').innerHTML = rows.length > S.shown ? `<button data-more>顯示更多（還有 ${rows.length - S.shown} 家）</button>` : '';
  $('#list-view').hidden = S.view !== 'list'; $('#map-view').hidden = S.view !== 'map';
  $('#seg-list').classList.toggle('seg-on', S.view === 'list'); $('#seg-map').classList.toggle('seg-on', S.view === 'map');
  if (S.view === 'map' || matchMedia('(min-width:900px)').matches) renderMap(rows);
}

/* ---------- map ---------- */
function pinIcon(cls, glyph, size = 26) { return L.divIcon({className: '', html: `<div class="pin ${cls}"><span>${glyph}</span></div>`, iconSize: [size, size], iconAnchor: [size / 2, size]}); }
function renderMap(rows) {
  const center = S.origin || (S.city ? cityOf(S.city) : rows[0] || {lat: 23.7, lon: 120.95});
  if (!S.map) {
    S.map = L.map('map', {zoomControl: true, attributionControl: true});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(S.map);
    S.cluster = L.markerClusterGroup({maxClusterRadius: 48, spiderfyOnMaxZoom: true, showCoverageOnHover: false, disableClusteringAtZoom: 18});
    S.map.addLayer(S.cluster);
    S.map.setView([center.lat, center.lon], 15);
  }
  S.cluster.clearLayers();
  for (const m of [S.meMarker, S.selMarker]) if (m) m.remove();
  S.meMarker = S.selMarker = null;
  if (S.origin && S.originKind === 'gps') S.meMarker = L.marker([S.origin.lat, S.origin.lon], {icon: L.divIcon({className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10]}), zIndexOffset: 900}).addTo(S.map).bindTooltip('你目前位置');
  const city = S.city || (S.origin ? nearestCity(S.origin).name : null);
  if (!S.query) for (const mk of S.index.markets.filter(m => m.lat != null && (!city || m.city === city))) S.cluster.addLayer(L.marker([mk.lat, mk.lon], {icon: pinIcon('market', '🏮')}).on('click', () => { S.marketFocus = mk.id; showMarket(); }));
  const shown = rows.slice(0, MAP_MAX);
  for (const s of shown) {
    if (s.id === S.selected) continue;
    const m = L.marker([s.lat, s.lon], {icon: pinIcon(s.hid >= 2 ? 'hid' : '', CAT_ICON[Object.keys(s.cats)[0]] || '🍴')});
    m.on('click', () => selectShop(s));
    S.cluster.addLayer(m);
  }
  const sel = rows.find(s => s.id === S.selected);
  if (sel) { S.selMarker = L.marker([sel.lat, sel.lon], {icon: pinIcon('sel', CAT_ICON[Object.keys(sel.cats)[0]] || '🍴', 38), zIndexOffset: 1000}).addTo(S.map); loadChunk(sel.city, sel.ck).then(c => { $('#map-sheet').innerHTML = cardHtml(sel, c[sel.id]); }); }
  else $('#map-sheet').innerHTML = '';
  const key = `${center.lat},${center.lon},${S.radius},${S.query},${S.city}`;
  if (renderMap.key !== key) { if (S.query && shown.length > 1 && !S.origin) S.map.fitBounds(shown.map(s => [s.lat, s.lon]), {padding: [20, 20], maxZoom: 15}); else S.map.setView([center.lat, center.lon], S.origin && S.radius && !S.query ? (S.radius <= 500 ? 17 : S.radius <= 1500 ? 15 : 13) : 12); renderMap.key = key; }
  setTimeout(() => S.map.invalidateSize(), 60);
}
function selectShop(s) { S.selected = s.id; renderResults(); const card = document.querySelector(`[data-card="${s.id}"]`); if (card && matchMedia('(min-width:900px)').matches) card.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }

/* ---------- detail ---------- */
async function renderDetail(id, city, ck) {
  const det = await loadDetail(id, city, ck).catch(() => null);
  if (!det) { toast('找不到這家店的資料'); return; }
  const d = S.origin ? distM(S.origin, det) : null;
  const tags = Object.entries(det.cats).map(([k, b]) => `<span class="tag${k === 'gift' ? ' gift' : k === 'unclassified' ? ' unc' : ''}">${CATS[k]}${b === 'hours' ? '*' : ''}</span>`).join('') + (det.hid >= 1 ? `<span class="tag hid">🕵️ 隱藏美食 ${hidMeter(det.hid)}</span>` : '');
  const why = reasons(det, det);
  const srcLine = det.src === 'osm' ? `<b>資料來源</b> OpenStreetMap 貢獻者（ODbL）· <a href="${esc(det.osmUrl)}" target="_blank" rel="noopener">在 OSM 查看／修正</a>${det.brand ? ' · 品牌標記：' + esc(det.brand) : ''}<br>OSM 只有名稱、座標與部分標籤，沒有照片與介紹；營業時間為 OSM opening_hours 原文。` : `<b>資料來源</b> 交通部觀光署「餐飲 - 觀光資訊資料庫」（政府資料開放授權第 1 版）<br>來源更新時間 ${esc((det.updateTime || '未提供').replace('T', ' ').slice(0, 16))} · ${det.image ? '照片由來源提供' : '來源未提供照片'} · 觀光署代碼 ${esc(det.codes.join(', ') || '無')}`;
  $('#screen-detail').innerHTML = `<div class="detail-hero">${det.image ? `<img src="${esc(det.image)}" alt="${esc(det.name)} 的照片（來源提供）" onerror="this.onerror=null;this.src='${PLACEHOLDER_WIDE}'">` : `<span aria-hidden="true">${CAT_ICON[Object.keys(det.cats)[0]] || '🍴'}</span>`}<button class="icon" data-back="1" aria-label="返回">‹</button><button class="fav-big${isFav(id) ? ' on' : ''}" data-fav="${id}" data-city="${esc(city)}" data-ck="${ck}" aria-label="收藏">${isFav(id) ? '♥' : '♡'}</button></div><div class="detail-body"><div class="tags">${tags}${det.src === 'osm' ? '<span class="tag osm">OSM</span>' : '<span class="tag src">觀光署</span>'}</div><h2>${esc(det.name)}</h2><div class="muted">${esc(det.codeLabels.join('、') || '來源未提供分類')}${d != null ? ' · 直線 ' + fmtDist(d) + (S.originKind === 'gps' ? '（從你目前位置）' : '（從手選中心）') : ''}</div><dl class="kv"><dt>營業時間</dt><dd${det.hours ? '' : ' class="na"'}>${esc(det.hours || '來源未提供')}</dd><dt>地址</dt><dd${det.address ? '' : ' class="na"'}>${esc(det.address || '來源未提供')}</dd><dt>電話</dt><dd${det.tel ? '' : ' class="na"'}>${det.tel ? `<a href="tel:${esc(det.tel.replace(/[^\d+]/g, ''))}">${esc(det.tel)}</a>` : '來源未提供'}</dd>${det.website ? `<dt>網站</dt><dd><a href="${esc(det.website)}" target="_blank" rel="noopener">${esc(det.website)}</a></dd>` : ''}<dt>隱藏指數</dt><dd>${det.hid}/3 · 方圓 300 m 內其他登錄店家 ${det.nb} 家${det.chain ? '（連鎖不列入隱藏）' : ''}</dd><dt>推薦依據</dt><dd${why.length ? '' : ' class="na"'}>${why.length ? esc(why.join('、')) : '來源欄位不足，不足以推薦'}</dd><dt>預算</dt><dd class="na">來源未提供價格，不自行估算</dd></dl>${det.desc ? `<p class="detail-desc">${esc(det.desc)}${det.descLen > 260 ? '…' : ''}</p>` : '<p class="detail-desc muted">來源未提供介紹。</p>'}<div class="actions"><a class="btn-nav" href="${esc(det.mapsUrl)}" target="_blank" rel="noopener">🧭 Google 導航</a><button class="btn-second" data-fav="${id}" data-city="${esc(city)}" data-ck="${ck}">${isFav(id) ? '♥ 已收藏' : '♡ 收藏'}</button></div><div class="src-box">${srcLine}<br>導航目的地＝來源座標 ${det.lat}, ${det.lon}${Object.values(det.cats).includes('hours') ? '；* 為依營業時間推定' : ''}</div></div>`;
  showScreen('detail');
}

/* ---------- market ---------- */
function showMarket() {
  const city = S.city || (S.origin ? nearestCity(S.origin).name : null);
  let list = S.index.markets.filter(m => !city || m.city === city);
  if (!list.length) list = S.index.markets;
  if (S.origin) list = list.map(m => ({...m, d: m.lat != null ? distM(S.origin, m) : null})).sort((a, b) => (a.d ?? 1e12) - (b.d ?? 1e12));
  const focus = list.find(m => m.id === S.marketFocus) || list[0];
  const fmt = m => `${esc(m.city)}${esc(m.town)} ${esc(m.address || '')}${m.d != null ? ' · ' + fmtDist(m.d) : ''}`;
  $('#screen-market').innerHTML = `<div class="section-head"><h2>夜市與市場入口${city ? `・${esc(city)}` : ''}</h2><span class="muted">${list.length} 處</span></div>
  ${focus ? `<div class="market-hero">${focus.image ? `<img src="${esc(focus.image)}" alt="${esc(focus.name)}（來源：觀光署景點資料）">` : `<img src="${PLACEHOLDER_WIDE}" alt="來源未提供照片">`}<div class="cap"><strong>${esc(focus.name)}</strong><small>${fmt(focus)}</small></div></div>
  <div class="market-guide"><h3>找攤指引</h3>${focus.desc ? `<p class="muted" style="font-size:13px;margin:0 0 8px">${esc(focus.desc)}</p>` : ''}${focus.hours ? `<p style="font-size:13px;margin:0 0 6px"><b>營業時間（來源文字）</b> ${esc(focus.hours)}</p>` : ''}${focus.moeaHours ? `<p style="font-size:13px;margin:0 0 6px"><b>商業發展署夜市資料</b> ${esc(focus.moeaHours)}${focus.moeaFeature ? '；' + esc(focus.moeaFeature) : ''}</p>` : ''}<ol><li>導航終點是<b>入口</b>（來源座標），不是個別攤位。</li><li>攤位沒有座標，本站不標示假位置；進場後依攤名找。</li></ol><div class="actions"><a class="btn-nav" href="${esc(focus.mapsUrl)}" target="_blank" rel="noopener">${focus.lat != null ? '🧭 導航到入口' : '🧭 以地址搜尋'}</a>${focus.lat != null ? `<button class="btn-second" data-place-market="${esc(focus.id)}">看入口附近店家</button>` : '<button class="btn-second" disabled>無座標</button>'}</div><p class="muted" style="font-size:11px;margin:8px 0 0">來源：${focus.sources.map(s => s === '7777' ? '觀光署景點資料集 7777' : '商業發展署夜市資料 95760').join('＋')}</p></div>` : ''}
  <div class="market-list">${list.map(m => `<button class="market-item" data-market="${esc(m.id)}">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : '<span class="ph">🏮</span>'}<span><strong>${esc(m.name)}</strong><small>${fmt(m)}${m.lat == null ? ' · 無座標' : ''}</small></span></button>`).join('')}</div>`;
  showScreen('market');
}

/* ---------- favourites ---------- */
async function renderFav() {
  await Promise.all(S.favs.map(f => Promise.all([loadLite(f.city), loadChunk(f.city, f.ck)]).catch(() => {})));
  const rows = S.favs.map(f => { const l = (S.lite[f.city] || []).find(s => s.id === f.id); return l && {...l, d: S.origin ? distM(S.origin, l) : null}; }).filter(Boolean);
  $('#result-title').textContent = '我的收藏'; $('#result-line').textContent = `${rows.length} 家 · 只存在這部裝置`;
  $('#rec-tools').hidden = true; $('#hidden-note').hidden = true; $('#more').innerHTML = '';
  $('#list-view').innerHTML = rows.length ? rows.map(s => cardHtml(s, detailOf(s))).join('') : '<p class="empty">還沒有收藏。<br>在店家卡片或詳情按 ♡ 就會存在這部裝置。</p>';
  $('#list-view').hidden = false; $('#map-view').hidden = true;
  if (matchMedia('(min-width:900px)').matches) renderMap(rows);
}

function showScreen(name) { $('#screen-results').hidden = name !== 'results'; $('#screen-market').hidden = name !== 'market'; $('#screen-detail').hidden = name !== 'detail'; $('.about').hidden = name === 'detail'; window.scrollTo(0, 0); }
function render() { for (const b of $$('.mode')) b.classList.toggle('mode-on', b.dataset.mode === S.mode); if (S.mode === 'market') { showMarket(); return; } showScreen('results'); if (S.mode === 'fav') renderFav(); else renderResults(); }
function rerender() { if (!$('#screen-detail').hidden) { const b = $('#screen-detail [data-fav]'); if (b) renderDetail(b.dataset.fav, b.dataset.city, b.dataset.ck); } else render(); }
function setMode(m) { S.mode = m; S.shown = PAGE; S.selected = null; if (m === 'rec' && S.origin && S.radius && S.radius < 5000) S.radius = 5000; if (m === 'hidden' && S.origin && S.radius && S.radius < 5000) S.radius = 5000; render(); }

/* ---------- location ---------- */
function setLoc(state, text) { const c = $('#loc-chip'); c.className = 'loc-chip ' + state; $('#loc-text').textContent = text; }
function applyPosition(p) {
  const near = nearestCity(p); const dc = distM(p, near);
  if (dc > 120000) { setLoc('fail', '不在台灣，請手選縣市'); toast('你的位置不在台灣資料範圍內，請手選縣市或直接搜尋'); return; }
  S.origin = p; S.originKind = 'gps'; S.city = null; if (!S.radius) S.radius = 1500; S.shown = PAGE; S.selected = null; renderMap.key = null;
  loadLite(near.name).then(rows => { const t = rows.map(s => ({s, d: distM(p, s)})).sort((a, b) => a.d - b.d)[0]; setLoc('ok', `你在 ${near.name}${t && t.d < 3000 ? t.s.town : ''}`); }).catch(() => setLoc('ok', `你在 ${near.name}`));
  render();
}
function locate(manual) {
  if (!navigator.geolocation) { setLoc('fail', '瀏覽器不支援定位'); return; }
  setLoc('busy', '定位中…');
  navigator.geolocation.getCurrentPosition(pos => applyPosition({lat: pos.coords.latitude, lon: pos.coords.longitude}), err => {
    setLoc('fail', err.code === 1 ? '定位被拒 · 點此重試' : '定位失敗 · 點此重試');
    if (manual || err.code !== 1) toast(err.code === 1 ? '沒有定位權限：可以直接搜尋，或按「縣市」手選' : '定位失敗：可以直接搜尋，或按「縣市」手選');
    if (!S.origin && !S.city) { $('#city-panel').hidden = false; render(); }
  }, {enableHighAccuracy: false, timeout: 10000, maximumAge: 60000});
}
function setCity(name) { const c = cityOf(name); S.city = name; S.origin = null; S.originKind = null; S.radius = 0; S.shown = PAGE; S.selected = null; renderMap.key = null; setLoc('', `手選 ${name}`); if (c.status === 'pending') toast(`${name}：來源目前沒有店家資料（資料待補）`); $('#city-panel').hidden = true; renderCityGrid(); render(); }
function setPlaceMarket(id) { const m = S.index.markets.find(x => x.id === id); if (!m || m.lat == null) return; S.origin = {lat: m.lat, lon: m.lon}; S.originKind = 'place'; S.city = null; S.radius = 1500; S.shown = PAGE; S.selected = null; renderMap.key = null; setLoc('', `中心：${m.name}`); S.mode = 'near'; render(); }
function renderCityGrid() { $('#city-grid').innerHTML = S.index.cities.map(c => `<button class="city${S.city === c.name ? ' city-on' : ''}" data-city="${esc(c.name)}">${esc(c.name)}<small>${c.count ? c.count.toLocaleString() + ' 家' : '待補'}</small></button>`).join(''); }

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const t = ev.target;
  const fav = t.closest('[data-fav]'); if (fav) { toggleFav(fav.dataset.fav, fav.dataset.city, fav.dataset.ck); return; }
  const open = t.closest('[data-open]'); if (open) { renderDetail(open.dataset.open, open.dataset.city, open.dataset.ck); return; }
  if (t.closest('[data-back]')) { render(); return; }
  const pm = t.closest('[data-place-market]'); if (pm) { setPlaceMarket(pm.dataset.placeMarket); return; }
  const mk = t.closest('[data-market]'); if (mk) { S.marketFocus = mk.dataset.market; showMarket(); return; }
  const mode = t.closest('[data-mode]'); if (mode) { setMode(mode.dataset.mode); return; }
  const c = t.closest('[data-cat]'); if (c) { S.cat = c.dataset.cat; S.shown = PAGE; render(); return; }
  const d = t.closest('[data-dist]'); if (d && !d.disabled) { S.radius = Number(d.dataset.dist); S.shown = PAGE; renderMap.key = null; render(); return; }
  const v = t.closest('[data-view]'); if (v) { S.view = v.dataset.view; render(); return; }
  if (t.closest('[data-more]')) { S.shown += PAGE; renderResults(); return; }
  const city = t.closest('[data-city]'); if (city) { setCity(city.dataset.city); return; }
  if (t.closest('[data-open-city]')) { const p = $('#city-panel'); p.hidden = !p.hidden; renderCityGrid(); return; }
  if (t.closest('[data-close-city]')) { $('#city-panel').hidden = true; return; }
  if (t.closest('#loc-chip')) { locate(true); return; }
  if (t.closest('#q-clear')) { $('#q').value = ''; S.query = ''; $('#q-clear').hidden = true; S.shown = PAGE; render(); return; }
  if (t.closest('#dice')) { const rows = results(scopeCities()).filter(s => s.rec >= 2); if (!rows.length) { toast('這個範圍內還沒有可推薦的店家'); return; } const pick = rows[Math.floor(Math.random() * Math.min(rows.length, 60))]; renderDetail(pick.id, pick.city, pick.ck); return; }
});
$('#q').addEventListener('input', e => { S.query = e.target.value.trim(); $('#q-clear').hidden = !S.query; S.shown = PAGE; S.selected = null; if (S.mode === 'market' || S.mode === 'fav') S.mode = 'near'; if ($('#screen-results').hidden) showScreen('results'); clearTimeout(S.qt); S.qt = setTimeout(render, 120); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

(async () => {
  try {
    S.index = await fetch('data/index.json').then(r => r.json());
    const ta = S.index.sources.find(s => s.key === 'ta'), osm = S.index.sources.find(s => s.key === 'osm');
    $('#status-strip').textContent = `全台 ${S.index.cities.length} 縣市 ${S.index.total.toLocaleString()} 家 · 資料建置 ${S.index.builtAt.replace('T', ' ').slice(0, 16)}`;
    $('#about-list').innerHTML = S.index.sources.map(s => `<li>${esc(s.name)}：${esc(s.license)}，${s.fileTime ? '檔案時間 ' + esc(s.fileTime) : '取得 ' + esc(s.downloaded)}，使用 ${s.used.toLocaleString()}/${s.rows.toLocaleString()} 筆。</li>`).join('') + `<li>縣市覆蓋：觀光署餐飲資料集 ${ta.used.toLocaleString()} 家；臺北市、高雄市、金門縣在該資料集沒有店家，改用 OpenStreetMap ${osm.used.toLocaleString()} 家（沒有照片與介紹）。</li><li>分類依${esc(S.index.codeTable)}；標 * 的早餐／宵夜是依營業時間推定。</li><li><b>隱藏美食：</b>${esc(S.index.hiddenMethod)}</li><li><b>推薦：</b>${esc(S.index.recommendMethod)}</li><li>價格：來源沒有，本站不自行填寫。營業狀態：只顯示來源文字，不推算「現在營業中」。</li><li>定位：打開頁面時取得一次目前位置，用來排序與篩選；不儲存、不上傳。按右上角可重新定位。</li><li>地圖底圖：© OpenStreetMap 貢獻者（ODbL），只在開啟地圖時載入。</li><li>收藏只存在這部裝置的瀏覽器。</li>`;
    renderCityGrid();
    render();
    locate(false);
  } catch (e) { $('#status-strip').textContent = '資料載入失敗，請重新整理'; toast('資料載入失敗'); }
})();
