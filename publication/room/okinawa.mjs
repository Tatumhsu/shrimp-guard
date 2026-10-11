// okinawa.mjs — 「沖繩上岸」分頁：以當下定位（或手選區域）依直線距離排序那霸景點與美食。
// 原則：座標只在本頁面記憶體使用，不上傳、不寫入儲存、不記錄軌跡；不猜營業中、不算步行時間；
// 人不在那霸附近時明示「尚未抵達」，只依手選區域排序。資料來源見 okinawa-data.mjs（維基百科／Wikidata／OpenStreetMap）。
import { DATA } from './okinawa-data.mjs';
import { formatInZone } from './cruise-data.mjs';

const T = globalThis.__CRUISE_TEST__ ?? {};
const TW = 480, JP = 540;
const NAHA = { lat: 26.2146, lon: 127.6816 };   // 那霸市中心附近（國際通西端）
const NEAR_KM = 25;                             // 超過此距離視為尚未抵達那霸
const GEO_TIMEOUT_MS = Number.isFinite(T.geoTimeoutMs) ? T.geoTimeoutMs : 12_000;
const MEETING_KEY = 'room-landing-meeting-jst';  // 只存使用者自己填的集合時間（不含座標）
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nowMs = () => (typeof T.now === 'function' ? T.now() : Date.now());
const online = () => (T.isOnLine ? T.isOnLine() : (typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true));

export function haversineKm(a, b) {
  const R = 6371.0088, d = Math.PI / 180, dLat = (b.lat - a.lat) * d, dLon = (b.lon - a.lon) * d;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);
const mapsDir = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`;
const mapsSearch = (p, name) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=&center=${p.lat},${p.lon}`;

export function mountLanding(root, { onShow, onHide } = {}) {
  const state = { status: 'idle', fix: null, error: null, region: null, meeting: null, foodLimit: 12, attempt: 0 };
  try { const m = localStorage.getItem(MEETING_KEY); if (m && /^\d{2}:\d{2}$/.test(m)) state.meeting = m; } catch { /* 無儲存權限也沒關係 */ }

  root.innerHTML = `
    <section class="land-head">
      <h2 class="land-title">沖繩上岸</h2>
      <p class="land-sub">那霸：國際通、牧志市場、壺屋、波上宮周邊。按「我的位置」後依直線距離排序；定位不可用時可手選區域。</p>
      <div class="land-loc">
        <button type="button" class="btn land-locate" id="land-locate">我的位置</button>
        <div class="land-fix" id="land-fix" role="status" aria-live="polite">尚未定位</div>
      </div>
      <div class="land-regions" role="radiogroup" aria-label="手選區域" id="land-regions"></div>
      <p class="land-basis" id="land-basis"></p>
      <div class="land-offline" id="land-offline" hidden>目前離線：清單為頁面內建資料，照片與地圖連結需要網路。本頁未標示為離線可用。</div>
    </section>
    <section class="land-meet">
      <label for="land-meeting">集合時間（自行填寫，日本時間）</label>
      <div class="land-meet-row"><input type="time" id="land-meeting" step="300" aria-describedby="land-meet-note"><button type="button" class="btn ghost small" id="land-meet-clear">清除</button></div>
      <p class="land-meet-note" id="land-meet-note">依船公司／領隊公告自行填寫；本頁不會用離港時間代替集合時間。<span id="land-meet-left"></span></p>
    </section>
    <h2 class="label">景點</h2>
    <div class="land-list" id="land-sights"></div>
    <h2 class="label">美食</h2>
    <p class="note">名稱、類型、地址取自 OpenStreetMap；營業時間與是否營業本頁不判斷，請以店家公告或 Google Maps 為準。</p>
    <div class="land-list" id="land-food"></div>
    <button type="button" class="btn ghost" id="land-more" hidden>顯示更多美食</button>
    <section class="land-privacy">
      <h3>隱私與資料</h3>
      <p>定位座標只在這支手機的這個頁面使用：不上傳、不公開、不寫入儲存、不記錄軌跡；重新整理即清除。集合時間只存在這個瀏覽器。</p>
      <p>景點簡介與照片來自維基百科／Wikimedia Commons（各卡片標示授權與作者）；地點與美食名稱來自 OpenStreetMap 貢獻者（<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ODbL</a>）。資料整理日 ${esc(DATA.generatedAt.slice(0, 10))}；距離為直線距離，非步行距離或時間。</p>
    </section>`;
  const $ = (id) => root.querySelector('#' + id);

  // ---------- 區域 ----------
  $('land-regions').innerHTML = DATA.areas.map((a) => `<button type="button" role="radio" aria-checked="false" class="land-region" data-area="${a.id}">${esc(a.name)}</button>`).join('');
  // 點區域 = 依該區域排序；再點一次已選的區域 = 取消手選（回到依定位排序）
  $('land-regions').addEventListener('click', (e) => { const b = e.target.closest('.land-region'); if (!b) return; state.region = state.region === b.dataset.area ? null : b.dataset.area; render(); });

  // ---------- 定位 ----------
  function locate() {
    const geo = T.geolocation ?? (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    if (!geo || typeof geo.getCurrentPosition !== 'function') { state.status = 'unsupported'; state.error = null; render(); return; }
    state.status = 'locating'; state.attempt++; const attempt = state.attempt; render();
    let done = false;
    const finish = (fn) => { if (done || attempt !== state.attempt) return; done = true; clearTimeout(guard); fn(); render(); };
    const guard = setTimeout(() => finish(() => { state.status = 'timeout'; }), GEO_TIMEOUT_MS + 500);
    geo.getCurrentPosition(
      (pos) => finish(() => { state.fix = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, at: nowMs() }; state.status = 'ok'; state.error = null; }),
      (err) => finish(() => { state.status = err && err.code === 1 ? 'denied' : err && err.code === 3 ? 'timeout' : 'error'; state.error = err && err.message ? String(err.message) : null; }),
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 },
    );
  }
  $('land-locate').addEventListener('click', locate);

  // ---------- 集合時間 ----------
  const meetInput = $('land-meeting'); if (state.meeting) meetInput.value = state.meeting;
  meetInput.addEventListener('change', () => { state.meeting = /^\d{2}:\d{2}$/.test(meetInput.value) ? meetInput.value : null; try { if (state.meeting) localStorage.setItem(MEETING_KEY, state.meeting); else localStorage.removeItem(MEETING_KEY); } catch { /* ignore */ } renderMeeting(); });
  $('land-meet-clear').addEventListener('click', () => { meetInput.value = ''; state.meeting = null; try { localStorage.removeItem(MEETING_KEY); } catch { /* ignore */ } renderMeeting(); });
  function renderMeeting() {
    const el = $('land-meet-left');
    if (!state.meeting) { el.textContent = ''; return; }
    const now = nowMs() / 1000, jp = formatInZone(Math.floor(now), JP);
    const [h, m] = state.meeting.split(':').map(Number); const [ch, cm] = jp.time.split(':').map(Number);
    const left = (h * 60 + m) - (ch * 60 + cm);
    el.textContent = left >= 0 ? ` 你填的集合時間 ${state.meeting}（日本時間）距現在約 ${Math.floor(left / 60)} 小時 ${left % 60} 分。` : ` 你填的集合時間 ${state.meeting}（日本時間）今天已過。`;
  }

  // ---------- 排序依據 ----------
  function basis() {
    const far = state.fix ? haversineKm(state.fix, NAHA) : null;
    if (state.fix && far <= NEAR_KM && !state.region) return { origin: state.fix, kind: 'fix', far };
    if (state.region) { const a = DATA.areas.find((x) => x.id === state.region); return { origin: a, kind: 'region', area: a, far }; }
    return { origin: null, kind: 'none', far };
  }
  function card(p, origin) {
    const dist = origin ? haversineKm(origin, p) : null;
    const photo = p.photo ? `<figure class="land-photo"><img src="photos/${esc(p.photo.file)}" alt="${esc(p.name)}" loading="lazy" width="320" height="200"><figcaption>照片：${esc(p.photo.author || '未具名')}，<a href="${esc(p.photo.commons)}" target="_blank" rel="noopener">${esc(p.photo.license)}</a></figcaption></figure>` : '';
    const links = (p.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('<span class="sep">·</span>');
    return `<article class="land-card" data-id="${esc(p.id)}">${photo}
      <div class="land-body"><h3 class="land-name">${esc(p.name)}${p.nameJa && p.nameJa !== p.name ? ` <small>${esc(p.nameJa)}</small>` : ''}</h3>
      ${p.kind ? `<p class="land-kind">${esc(p.kind)}</p>` : ''}
      ${p.intro ? `<p class="land-intro">${esc(p.intro)}</p>` : ''}
      <p class="land-addr">${p.address ? esc(p.address) : '地址：資料未提供'}</p>
      <p class="land-dist">${dist === null ? '距離：請先定位或選區域' : `直線距離 ${fmtDist(dist)}`}</p>
      <p class="land-links"><a class="land-nav" href="${mapsDir(p)}" target="_blank" rel="noopener">Google Maps 導航</a><span class="sep">·</span><a href="${mapsSearch(p, p.nameJa || p.name)}" target="_blank" rel="noopener">查看營業資訊</a>${links ? '<span class="sep">·</span>' + links : ''}</p>
      </div></article>`;
  }
  function render() {
    const b = basis();
    const fixEl = $('land-fix'), msg = {
      idle: '尚未定位', locating: '定位中…', unsupported: '這個瀏覽器不支援定位，請手選區域。', denied: '定位被拒絕：請手選區域，或在瀏覽器設定允許位置權限後重新定位。',
      timeout: '定位逾時：可再試一次，或手選區域。', error: `定位失敗${state.error ? '（' + esc(state.error) + '）' : ''}：可再試一次，或手選區域。`,
    }[state.status];
    if (state.status === 'ok' && state.fix) {
      const tw = formatInZone(Math.floor(state.fix.at / 1000), TW), jp = formatInZone(Math.floor(state.fix.at / 1000), JP);
      fixEl.innerHTML = `定位時間 ${esc(tw.time)}（台灣）／${esc(jp.time)}（日本）${Number.isFinite(state.fix.acc) ? `，精度約 ±${Math.round(state.fix.acc)} m` : ''}`
        + (b.far > NEAR_KM ? `<br><b class="land-far">你距離那霸約 ${fmtDist(b.far)}，尚未抵達；下方不依你的位置排序，請手選區域。</b>` : '');
    } else fixEl.innerHTML = msg;
    $('land-locate').textContent = state.status === 'locating' ? '定位中…' : state.fix ? '重新定位' : '我的位置';
    $('land-locate').disabled = state.status === 'locating';
    for (const el of root.querySelectorAll('.land-region')) el.setAttribute('aria-checked', String(el.dataset.area === state.region));
    $('land-basis').textContent = b.kind === 'fix' ? '依你目前位置排序（直線距離，非步行時間）。' : b.kind === 'region' ? `依「${b.area.name}」中心排序（直線距離，非步行時間）。${state.fix && b.far <= NEAR_KM ? '要改用你的位置排序，請再按一次已選的區域取消。' : ''}` : '尚未排序：按「我的位置」或手選一個區域。';
    $('land-offline').hidden = online();
    const sort = (list) => (b.origin ? list.map((p) => [haversineKm(b.origin, p), p]).sort((x, y) => x[0] - y[0]).map((x) => x[1]) : list);
    $('land-sights').innerHTML = sort(DATA.sights).map((p) => card(p, b.origin)).join('');
    const food = sort(DATA.food);
    $('land-food').innerHTML = food.slice(0, state.foodLimit).map((p) => card(p, b.origin)).join('');
    $('land-more').hidden = food.length <= state.foodLimit; $('land-more').textContent = `顯示更多美食（還有 ${Math.max(0, food.length - state.foodLimit)} 家）`;
    renderMeeting();
  }
  $('land-more').addEventListener('click', () => { state.foodLimit += 12; render(); });
  window.addEventListener('online', render); window.addEventListener('offline', render);
  const tick = setInterval(renderMeeting, 30_000);
  render();
  return {
    show() { onShow?.(); render(); }, hide() { onHide?.(); },
    locate, get state() { return { status: state.status, hasFix: !!state.fix, fixAt: state.fix?.at ?? null, region: state.region, meeting: state.meeting, basis: basis().kind, far: basis().far }; },
    destroy() { clearInterval(tick); window.removeEventListener('online', render); window.removeEventListener('offline', render); },
  };
}
