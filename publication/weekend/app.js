import { trips, candidates, sortCandidates, fmt, dur, openOn, suggest, LOCAL_TYPES } from './planner.js?v=20261016231156';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
};
const WD = '日一二三四五六';
const PAGE = 20;
const S = { meta: null, stations: [], byName: new Map(), food: null, tt: new Map(), list: [], shown: PAGE, legs: null, foodKind: '全部', events: new Map() };
const DEF = { from: '1000', date: '', leave: 480, back: 1200, ride: 120, stay: 180, local: false, direct: false, sort: 'best', to: '' };
const P = { ...DEF };

const json = async url => { const r = await fetch(url); if (!r.ok) throw Error(url + ' ' + r.status); return r.json(); };
const dayOf = d => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6)).getDay();
const dateLabel = d => `${+d.slice(4, 6)}/${+d.slice(6)}（${WD[dayOf(d)]}）`;
const evOf = (c, d) => S.events.get(c + '|' + d) || [];
const nameOf = i => S.stations[i].n;
const viaTxt = it => it.via != null ? `，${nameOf(it.via)}轉車` : '';
const allLocal = (...its) => its.every(it => (it.legs || [it]).every(l => LOCAL_TYPES.has(l.type)));
const mapsWalk = (a, b) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&travelmode=walking`;

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  Object.assign(P, DEF);
  for (const k of Object.keys(P)) {
    if (!q.has(k)) continue;
    const v = q.get(k);
    P[k] = typeof P[k] === 'number' ? (Number.isFinite(+v) ? +v : P[k]) : typeof P[k] === 'boolean' ? v === '1' : v;
  }
}
function writeHash(replace = true) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(P)) if (v !== '' && v !== false) q.set(k, typeof v === 'boolean' ? '1' : v);
  const h = '#' + q.toString();
  if (h !== location.hash) (replace ? history.replaceState : history.pushState).call(history, null, '', h);
}

async function timetable(date) {
  if (!S.tt.has(date)) S.tt.set(date, json(`data/tt/${date}.json?v=20261016231156`).catch(e => { S.tt.delete(date); throw e; }));
  return S.tt.get(date);
}

function fillForm() {
  const dl = $('#station-list');
  dl.replaceChildren(...S.stations.filter(s => s.ok).map(s => el('option', { value: s.n })));
  $('#from').value = S.stations[S.idx[P.from]]?.n || '臺北';
  const dates = S.meta.dates;
  if (!dates.includes(P.date)) P.date = dates[0];
  $('#dates').replaceChildren(...dates.map(d => el('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(d === P.date), 'data-date': d, onclick: () => { P.date = d; P.to = ''; update(); } }, dateLabel(d))));
  const opts = (sel, from, to, v) => { sel.replaceChildren(...Array.from({ length: to - from + 1 }, (_, i) => { const m = (from + i) * 60; return el('option', { value: m, selected: m === v }, fmt(m)); })); };
  opts($('#leave'), 5, 13, P.leave);
  opts($('#back'), 15, 24, P.back);
  $('#ride').value = String(P.ride);
  $('#stay').value = String(P.stay);
  $('#local').checked = P.local;
  $('#direct').checked = P.direct;
  $('#sort').value = P.sort;
  $('#tt-date').textContent = `資料更新 ${S.meta.built_at.slice(0, 10)}，涵蓋 ${dateLabel(dates[0])}～${dateLabel(dates[dates.length - 1])} 的週末`;
}

function syncChips() {
  for (const b of document.querySelectorAll('#dates .chip')) b.setAttribute('aria-checked', String(b.dataset.date === P.date));
}

async function update(push = false) {
  syncChips();
  writeHash(!push);
  const origin = S.idx[P.from];
  $('#from-err').textContent = '';
  if (origin == null) { $('#from-err').textContent = '找不到這個車站'; return; }
  $('#summary').textContent = '計算中…';
  let day;
  try { day = await timetable(P.date); } catch { $('#summary').textContent = '時刻表讀取失敗，請稍後再試'; return; }
  S.legs = trips(day.trains, origin, { leaveAfter: P.leave, returnBy: P.back, localOnly: P.local, direct: P.direct, maxRide: P.ride });
  S.list = sortCandidates(candidates(S.legs, S.stations, origin, { maxRide: P.ride, minStay: P.stay }), P.sort);
  S.shown = PAGE;
  renderList();
  if (P.to && S.idx[P.to] != null) await showDetail(S.idx[P.to], false); else hideDetail();
}

function renderList() {
  const from = S.stations[S.idx[P.from]].n;
  const n = S.list.length;
  $('#summary').textContent = n ? `${dateLabel(P.date)} 從${from}出發，${n} 個車站符合` : `${dateLabel(P.date)} 從${from}出發，沒有符合的車站`;
  const items = S.list.slice(0, S.shown).map(c => {
    const f = c.st.f;
    return el('li', {}, el('button', { type: 'button', class: 'dest', 'data-code': c.st.c, onclick: () => { P.to = c.st.c; showDetail(c.idx, true); } },
      el('div', { class: 'row1' }, el('h2', {}, c.st.n, c.st.co ? el('small', {}, c.st.co) : null), el('span', { class: 'stay' }, `可停留 ${dur(c.stay)}`)),
      el('div', { class: 'line' }, `去 ${fmt(c.first.dep)}→${fmt(c.first.arr)}（${dur(c.ride)}，${c.first.type}${viaTxt(c.first)}）・回 ${fmt(c.last.dep)} 出發${c.last.via != null ? `（${nameOf(c.last.via)}轉車）` : ''}`),
      el('div', { class: 'food' },
        f.n ? `附近 1 公里美食 ${f.n} 家` : '附近美食資料很少',
        f.hid ? el('span', {}, '　', el('span', { class: 'tag hid' }, `隱藏 ${f.hid}`)) : null,
        c.xf ? el('span', {}, '　', el('span', { class: 'tag xf' }, c.xf === 1 ? '轉車 1 次' : '來回各轉 1 次')) : null,
        c.goCount <= 2 ? el('span', {}, '　', el('span', { class: 'tag ltd' }, `去程只有 ${c.goCount} 班`)) : null,
        evOf(c.st.c, P.date).length ? el('span', {}, '　', el('span', { class: 'tag ev' }, `這天活動 ${evOf(c.st.c, P.date).length}`)) : null)));
  });
  $('#list').replaceChildren(...(items.length ? items : [el('li', { class: 'empty' }, '試試放寬車程、提早出門、延後回程，或取消「只搭區間車」。')]));
  $('#more').hidden = S.shown >= n;
}

function shopItem(s, station, weekday) {
  const o = openOn(s.h, weekday);
  return el('li', { class: 'shop' },
    el('div', { class: 'nm' }, s.n, s.hid >= 2 ? el('span', {}, ' ', el('span', { class: 'tag hid' }, '隱藏')) : null),
    el('div', { class: 'meta' }, `${s.lab || s.k}・步行約 ${s.w} 分（${s.d} 公尺）`),
    el('div', { class: 'meta hrs' + (o.open === false ? ' no' : '') }, o.open === false ? o.note : s.h ? `營業 ${o.note}` : '營業時間未提供'),
    s.x ? el('div', { class: 'x' }, s.x) : null,
    el('a', { href: mapsWalk(station, s), target: '_blank', rel: 'noopener' }, '從車站步行導航 →'));
}

async function showDetail(idx, push) {
  if (!S.food) {
    $('#detail').hidden = false;
    $('#detail').replaceChildren(el('p', { class: 'summary' }, '讀取美食資料中…'));
    try { S.food = await json('data/food.json?v=20261016231156'); } catch { $('#detail').replaceChildren(el('p', { class: 'err' }, '美食資料讀取失敗')); return; }
  }
  const st = S.stations[idx];
  P.to = st.c;
  writeHash(!push);
  const c = S.list.find(x => x.idx === idx);
  const legs = S.legs.get(idx);
  const weekday = dayOf(P.date);
  const food = S.food[st.c] || [];
  const from = S.stations[S.idx[P.from]].n;
  const sec = $('#detail');
  const kids = [el('button', { type: 'button', class: 'back', onclick: () => { P.to = ''; hideDetail(); writeHash(true); } }, '← 回到車站列表'),
    el('h2', { class: 'dh' }, st.n, st.co ? el('small', {}, st.co) : null)];
  if (!c || !legs) {
    kids.push(el('p', { class: 'empty' }, '這個車站不符合目前的條件。'));
    sec.replaceChildren(...kids); sec.hidden = false; $('#results').hidden = true; return;
  }
  kids.push(el('p', { class: 'dsum' }, `${dateLabel(P.date)}・${from}出發・最早 ${fmt(c.first.arr)} 到、最晚 ${fmt(c.last.dep)} 回，可停留 ${dur(c.stay)}`));
  const go = legs.out.filter(l => l.arr - l.dep <= P.ride && l.arr < c.last.dep).slice(0, 5);
  const back = legs.back.filter(l => l.arr - l.dep <= P.ride && l.dep > c.first.arr).slice(0, 5).reverse();
  const tl = (ls, pick) => el('ul', { class: 'tlist' }, ls.map(l => el('li', { class: [l === pick ? 'pick' : '', l.via != null ? 'xf' : ''].join(' ').trim() || null },
    el('span', {}, `${fmt(l.dep)} → ${fmt(l.arr)}`),
    el('span', { class: 'no' }, l.via != null
      ? `${l.legs[0].type} ${l.legs[0].no} → ${nameOf(l.via)} ${fmt(l.legs[0].arr)} 到、${fmt(l.legs[1].dep)} 轉 ${l.legs[1].type} ${l.legs[1].no}・共 ${dur(l.arr - l.dep)}`
      : `${l.type} ${l.no}・${dur(l.arr - l.dep)}`))));
  kids.push(el('div', { class: 'card' }, el('div', { class: 'trains' },
    el('div', {}, el('h3', {}, `去程（${from} → ${st.n}）`), tl(go, c.first)),
    el('div', {}, el('h3', {}, `回程（${st.n} → ${from}）`), tl(back, c.last))),
    el('p', { class: 'note' }, (allLocal(c.first, c.last) ? '標框的是建議班次。區間車不用訂位。' : '標框的是建議班次。自強號、莒光號建議先訂票。') + (c.xf ? '轉車預留至少 6 分鐘；誤點時請改搭下一班。' : ''))));
  const plan = suggest(food, weekday, c.first.arr, c.last.dep);
  kids.push(el('div', { class: 'card' }, el('h3', {}, '建議行程'), el('ol', { class: 'plan' },
    el('li', {}, el('time', {}, fmt(c.first.arr)), el('div', {}, `抵達${st.n}站`)),
    plan.map(p => el('li', {}, el('time', {}, fmt(p.at)), el('div', {}, el('div', { class: 'what' }, p.what), el('div', {}, p.s.n, `・步行 ${p.s.w} 分`)))),
    el('li', {}, el('time', {}, fmt(c.last.dep)), el('div', {}, `搭 ${c.last.type} ${c.last.no} 回${from}${viaTxt(c.last)}，${fmt(c.last.arr)} 到`))),
    plan.length ? el('p', { class: 'note' }, '店家依資料完整度與在地特色排序，不是評分。營業時間以店家公告為準。') : el('p', { class: 'note' }, '這站附近的店家資料不夠，沒辦法排行程。')));
  const evs = evOf(st.c, P.date);
  if (evs.length) kids.push(el('div', { class: 'card' }, el('h3', {}, '這天附近的活動'), el('ul', { class: 'shops' }, evs.map(e => el('li', { class: 'shop ev' },
    el('div', { class: 'nm' }, e.t), (e.p || e.tm) ? el('div', { class: 'meta' }, [e.p, e.tm].filter(Boolean).join('・')) : null,
    e.x ? el('div', { class: 'x' }, e.x) : null, el('a', { href: e.u, target: '_blank', rel: 'noopener' }, '活動資訊 →')))),
    el('p', { class: 'note' }, '每週四自動整理，日期與時間以主辦單位公告為準。')));
  const kinds = ['全部', ...new Set(food.map(s => s.k))];
  if (!kinds.includes(S.foodKind)) S.foodKind = '全部';
  const list = el('ul', { class: 'shops' });
  const draw = () => list.replaceChildren(...food.filter(s => S.foodKind === '全部' || s.k === S.foodKind).map(s => shopItem(s, st, weekday)));
  const chips = el('div', { class: 'fchips', role: 'radiogroup', 'aria-label': '美食分類' }, kinds.map(k => el('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(k === S.foodKind),
    onclick: e => { S.foodKind = k; for (const b of chips.children) b.setAttribute('aria-checked', String(b === e.currentTarget)); draw(); } }, k)));
  draw();
  kids.push(el('div', { class: 'card' }, el('h3', {}, food.length ? `車站附近美食（${food.length} 家，1 公里內共 ${st.f.n} 家）` : '車站附近美食'),
    food.length ? [chips, list] : el('p', { class: 'note' }, '資料庫在這站附近沒有店家。')));
  sec.replaceChildren(...kids);
  sec.hidden = false;
  $('#results').hidden = true;
  $('#form').hidden = true;
  window.scrollTo(0, 0);
}

function hideDetail() {
  $('#detail').hidden = true;
  $('#results').hidden = false;
  $('#form').hidden = false;
}

function bind() {
  const fromInput = $('#from');
  const setFrom = () => {
    const v = fromInput.value.trim().replace(/^台/, '臺').replace(/站$/, '');
    const s = S.byName.get(v);
    if (s) { if (P.from !== s.c) { P.from = s.c; P.to = ''; update(); } } else if (v) $('#from-err').textContent = '找不到這個車站，請從清單選擇';
  };
  fromInput.addEventListener('change', setFrom);
  fromInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setFrom(); fromInput.blur(); } });
  for (const [id, key] of [['leave', 'leave'], ['back', 'back'], ['ride', 'ride'], ['stay', 'stay']]) $('#' + id).addEventListener('change', e => { P[key] = +e.target.value; update(); });
  $('#local').addEventListener('change', e => { P.local = e.target.checked; update(); });
  $('#direct').addEventListener('change', e => { P.direct = e.target.checked; update(); });
  $('#sort').addEventListener('change', e => { P.sort = e.target.value; S.list = sortCandidates(S.list, P.sort); S.shown = PAGE; writeHash(); renderList(); });
  $('#more').addEventListener('click', () => { S.shown += PAGE; renderList(); });
  $('#form').addEventListener('submit', e => e.preventDefault());
  window.addEventListener('popstate', () => { readHash(); fillForm(); update(); });
}

(async function main() {
  try {
    [S.meta, S.stations] = await Promise.all([json('data/meta.json?v=20261016231156'), json('data/stations.json?v=20261016231156')]);
  } catch {
    $('#summary').textContent = '資料讀取失敗，請重新整理';
    return;
  }
  try { for (const e of (await json('data/events.json?v=20261016231156')).items) { const k = e.c + '|' + e.d; S.events.set(k, [...(S.events.get(k) || []), e]); } } catch {}
  S.idx = Object.fromEntries(S.stations.map((s, i) => [s.c, i]));
  for (const s of S.stations) S.byName.set(s.n, s);
  readHash();
  fillForm();
  bind();
  await update();
  if (!S.food) json('data/food.json?v=20261016231156').then(f => { S.food = f; }).catch(() => {});
})();
