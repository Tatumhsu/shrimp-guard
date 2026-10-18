// 台灣天象曆 — render the computed events, filters, countdown, .ics export, deep links into 今晚星空.
import { events, ics, CATS } from './almanac.js';

const A = window.Astronomy, $ = s => document.querySelector(s);
const store = { get(k, d) { try { const v = localStorage.getItem('almanac.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('almanac.' + k, JSON.stringify(v)); } catch {} } };
const ui = { cats: new Set(store.get('cats', Object.keys(CATS))), visOnly: store.get('visOnly', true) };
const D = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
const WD = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' });
const HM = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
const YM = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NIGHT_LINK = new Set(['eclipse', 'moon', 'planet', 'meet', 'meteor']);

const start = new Date(Date.now() - 86400000);
const all = events(A, start, 13);

function shown() { return all.filter(e => ui.cats.has(e.cat) && (!ui.visOnly || e.visible) && +e.t > Date.now() - 12 * 3600e3); }
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' })); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function render() {
  $('#cats').replaceChildren(...Object.entries(CATS).map(([k, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(ui.cats.has(k)));
    b.innerHTML = `<i style="background:var(--c-${k})"></i>${label}`;
    b.onclick = () => { ui.cats.has(k) ? ui.cats.delete(k) : ui.cats.add(k); store.set('cats', [...ui.cats]); render(); };
    return b;
  }));
  $('#visOnly').checked = ui.visOnly;
  const list = shown(), groups = new Map();
  for (const e of list) { const k = YM.format(e.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  $('#list').replaceChildren(...(list.length ? [...groups].map(([month, evs]) => {
    const sec = document.createElement('section'); sec.className = 'month';
    sec.innerHTML = `<h3>${month}</h3>`;
    for (const e of evs) {
      const div = document.createElement('div'); div.className = 'ev' + (e.visible ? '' : ' off');
      const showTime = e.cat !== 'meteor';
      div.innerHTML = `<div class="d"><b>${D.format(e.t)}</b>${WD.format(e.t)}${showTime ? ' ' + HM.format(e.t) : ''}</div>` +
        `<div><h4>${esc(e.title)}<span class="tag" style="background:var(--c-${e.cat})">${CATS[e.cat]}</span>${e.big ? '<span class="seal">推薦</span>' : ''}${e.visible ? '' : '<span class="tag" style="background:var(--ink3)">台灣看不到</span>'}</h4>` +
        `<p>${esc(e.detail)}</p><div class="acts"><button type="button" data-ics>加到行事曆</button>${NIGHT_LINK.has(e.cat) && e.visible ? `<a href="../sky/?t=${encodeURIComponent(skyTime(e).toISOString())}${document.documentElement.classList.contains('embed') ? '&embed=1' : ''}">在「今晚星空」看這一刻</a>` : ''}</div></div>`;
      div.querySelector('[data-ics]').onclick = () => download(`${e.title}.ics`, ics([e]));
      sec.append(div);
    }
    return sec;
  }) : [Object.assign(document.createElement('p'), { className: 'empty', textContent: '沒有符合篩選的天象。' })]));
  renderNext();
}
// a daytime instant (e.g. 滿月 at 14:00) is shown that evening at 21:00
function skyTime(e) {
  const o = new A.Observer(25.03, 121.56, 10), eq = A.Equator('Sun', e.t, o, true, true), alt = A.Horizon(e.t, o, eq.ra, eq.dec, null).altitude;
  if (alt < -6) return e.t;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(e.t);
  return new Date(day + 'T21:00:00+08:00');
}
function renderNext() {
  const n = all.find(e => e.big && e.visible && +e.t > Date.now());
  if (!n) { $('#next').hidden = true; return; }
  const ms = +n.t - Date.now(), d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24;
  $('#next').innerHTML = `<div class="k">下一個推薦天象</div><h2>${esc(n.title)}</h2><div class="when">${D.format(n.t)}（${WD.format(n.t)}）${n.cat === 'meteor' ? '' : HM.format(n.t)}・還有 <span class="count">${d} 天 ${h} 小時</span></div><p>${esc(n.detail)}</p>`;
}
$('#visOnly').addEventListener('change', e => { ui.visOnly = e.target.checked; store.set('visOnly', ui.visOnly); render(); });
$('#dlAll').addEventListener('click', () => download('台灣天象曆.ics', ics(shown())));
render();
setInterval(renderNext, 60000);
window.__almanac = { all, ui, shown };
