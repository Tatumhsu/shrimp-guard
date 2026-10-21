// 未來世界 — renders data/world.json: timeline (lanes × years), list, signals, detail drawer with history chart.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? esc(u) : '#';
const store = { get(k) { try { return localStorage.getItem('fw:' + k); } catch { return null; } }, set(k, v) { try { localStorage.setItem('fw:' + k, v); } catch { } } };

let W, Y0, Y1, view = store.get('view') || (innerWidth < 720 ? 'list' : 'timeline');
const hidden = new Set(JSON.parse(store.get('hidden') || '[]'));
const col = id => `var(--d-${id})`;
const yLabel = y => y > Y1 ? `${Y1} 之後` : String(y);
const born = () => { const b = parseInt(store.get('born')); return b >= 1920 && b <= 2026 ? b : null; };
const ageAt = y => { const b = born(); return b && y <= Y1 ? `那年你 ${y - b} 歲` : ''; };

function lastMove(m) {
  const h = m.history || [];
  if (h.length < 2) return 0;
  return h[h.length - 1].median - h[h.length - 2].median;
}
const mvTag = d => d < 0 ? `<span class="mv up" title="比上次提早">▲${-d}</span>` : d > 0 ? `<span class="mv down" title="比上次延後">▼${d}</span>` : '';

async function main() {
  try {
    const r = await fetch('data/world.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    W = await r.json();
  } catch (e) {
    $('#summary').textContent = '資料讀取失敗，請稍後重新整理。'; $('#meta').textContent = ''; return;
  }
  [Y0, Y1] = W.span;
  $('#meta').textContent = `${W.milestones.length} 個里程碑 · 更新 ${String(W.updated).slice(0, 16).replace('T', ' ')}`;
  renderToday(); renderChips(); renderSignals();
  const b = born(); if (b) $('#born').value = b;
  $('#born').addEventListener('input', e => { store.set('born', e.target.value); render(); });
  document.querySelectorAll('.seg button').forEach(btn => btn.addEventListener('click', () => { view = btn.dataset.view; store.set('view', view); render(); }));
  $('#dClose').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer') closeDrawer(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  addEventListener('resize', () => view === 'timeline' && renderTimeline());
  render();
  const fromHash = () => { const want = decodeURIComponent(location.hash.slice(1)); const m = want && W.milestones.find(x => x.id === want); if (m) openDrawer(m); };
  addEventListener('hashchange', fromHash); fromHash();
}

function renderToday() {
  const d = (W.days || [])[0];
  $('#todayDate').textContent = d ? d.date : '';
  $('#summary').textContent = d ? d.summary : `初始時間軸：${W.milestones.length} 個里程碑，由 Claude 綜合專家與預測市場整理。每天的更新會從明天開始。`;
  const t = d?.team || {};
  const agents = [
    ['C', 'Claude', '指揮・搜尋新信號、調整年份', t.claude || '已建立初始時間軸', 'ok'],
    ['G', 'Grok', 'X（Twitter）即時輿論', t.grok || '待接通', /已回信/.test(t.grok || '') ? 'ok' : 'wait'],
    ['X', 'Codex', '審查調整幅度', t.codex || '待登入', /Codex 審查/.test(t.codex || '') ? 'ok' : 'wait'],
  ];
  $('#team').innerHTML = agents.map(([a, n, role, st, cls]) =>
    `<div class="agent"><div class="av">${a}</div><div><b>${n}<span class="st ${cls}">${cls === 'ok' ? '運作中' : '待接通'}</span></b><span class="role">${esc(role)}<br></span><span>${esc(st)}</span></div></div>`).join('');
}

function renderChips() {
  $('#chips').innerHTML = W.domains.map(d => `<button type="button" data-d="${d.id}" style="--c:${col(d.id)}" aria-pressed="${!hidden.has(d.id)}"><i></i>${esc(d.name)}</button>`).join('');
  $('#chips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.d; hidden.has(id) ? hidden.delete(id) : hidden.add(id);
    if (hidden.size === W.domains.length) hidden.delete(id);   // never hide everything
    store.set('hidden', JSON.stringify([...hidden])); renderChips(); render();
  }));
}

function render() {
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#timelineView').hidden = view !== 'timeline'; $('#listView').hidden = view !== 'list';
  view === 'timeline' ? renderTimeline() : renderList();
}

const shown = () => W.milestones.filter(m => !hidden.has(m.domain));

function renderTimeline() {
  const box = $('#tlscroll'), avail = box.clientWidth || 900;
  const ppy = Math.max(34, Math.min(60, (avail - 40) / (Y1 + 2 - Y0)));      // px per year; phones scroll sideways
  const width = Math.ceil((Y1 + 2 - Y0) * ppy) + 40, X = y => 20 + (y - Y0) * ppy;
  const nowY = new Date().getFullYear() + new Date().getMonth() / 12;
  let html = `<div class="axis" style="width:${width}px">`;
  for (let y = Y0; y <= Y1 + 1; y++) if (y % 5 === 0 || y === Y0) html += `<span class="yr" style="left:${X(y)}px">${y > Y1 ? Y1 + '+' : y}</span>`;
  html += `</div>`;
  let grid = '';
  for (let y = Math.ceil(Y0 / 5) * 5; y <= Y1; y += 5) grid += `<div class="gridline" style="left:${X(y)}px"></div>`;
  for (const d of W.domains) {
    if (hidden.has(d.id)) continue;
    const ms = W.milestones.filter(m => m.domain === d.id).sort((a, b) => a.median - b.median);
    const rows = [];                 // greedy packing: each row keeps its right edge
    const placed = ms.map(m => {
      const labW = [...m.title].length * 13 + 52;
      const left = Math.min(X(m.lo), X(m.median) - 6), right = Math.max(X(Math.min(m.hi, Y1 + 1)), X(m.median) - 6 + labW);
      let r = rows.findIndex(edge => edge + 10 < left); if (r < 0) { rows.push(0); r = rows.length - 1; }
      rows[r] = right; return { m, r, left };
    });
    const h = 30 + rows.length * 36;
    html += `<div class="lane" style="width:${width}px;height:${h}px;--c:${col(d.id)}"><span class="lanelab"><i></i>${esc(d.name)}</span>${grid}`;
    for (const { m, r, left } of placed) {
      const top = 26 + r * 36, mx = X(m.median) - left;
      html += `<button type="button" class="ms${m.status === 'happened' ? ' happened' : ''}" data-id="${esc(m.id)}" style="left:${left}px;top:${top}px;width:${Math.max(X(Math.min(m.hi, Y1 + 1)) - left, mx + 12)}px" aria-label="${esc(m.title)}，最可能 ${yLabel(m.median)} 年，區間 ${yLabel(m.lo)} 到 ${yLabel(m.hi)}">`
        + `<span class="rng" style="left:${X(m.lo) - left}px;width:${Math.max(4, X(Math.min(m.hi, Y1 + 1)) - X(m.lo))}px"></span>`
        + `<span class="dot" style="left:${mx - 6}px"></span>`
        + `<span class="lab" style="left:${mx - 6}px">${esc(m.title)}<em>${yLabel(m.median)}</em>${mvTag(lastMove(m))}</span></button>`;
    }
    html += `</div>`;
  }
  const tl = $('#tl'); tl.style.width = width + 'px';
  tl.innerHTML = html + `<div class="nowline" style="left:${X(nowY)}px"></div><span class="nowtag" style="left:${X(nowY)}px">現在</span>`;
  tl.querySelectorAll('.ms').forEach(el => {
    const m = W.milestones.find(x => x.id === el.dataset.id);
    el.addEventListener('click', () => openDrawer(m));
    el.addEventListener('pointerenter', e => showTip(e, m)); el.addEventListener('pointermove', e => showTip(e, m));
    el.addEventListener('pointerleave', hideTip); el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip({ clientX: r.left + 20, clientY: r.bottom }, m); }); el.addEventListener('blur', hideTip);
  });
}

function showTip(e, m) {
  const t = $('#tip'); const age = ageAt(m.median);
  t.innerHTML = `<b>${esc(m.title)}</b><span>最可能 ${yLabel(m.median)}・區間 ${yLabel(m.lo)}–${yLabel(m.hi)}${age ? '・' + age : ''}</span>`;
  t.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8), y = e.clientY + 18 + t.offsetHeight > innerHeight ? e.clientY - t.offsetHeight - 10 : e.clientY + 18;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function hideTip() { $('#tip').hidden = true; }

function renderList() {
  const ms = shown().sort((a, b) => a.median - b.median || a.lo - b.lo);
  const buckets = new Map();
  for (const m of ms) { const k = m.median > Y1 ? Y1 + 1 : Math.floor(m.median / 5) * 5; (buckets.get(k) || buckets.set(k, []).get(k)).push(m); }
  const b = born();
  $('#listView').innerHTML = [...buckets].map(([k, list]) => `<div class="bucket"><h3>${k > Y1 ? Y1 + ' 之後' : `${Math.max(k, Y0)}–${k + 4}`}${b && k <= Y1 ? `<small>你 ${k - b}–${k + 4 - b} 歲</small>` : ''}</h3><div class="cards">`
    + list.map(m => `<button type="button" class="card" data-id="${esc(m.id)}" style="--c:${col(m.domain)}"><b>${esc(m.title)} ${mvTag(lastMove(m))}</b><span class="yrs">最可能 ${yLabel(m.median)}・${yLabel(m.lo)}–${yLabel(m.hi)}${m.status === 'happened' ? '・已發生' : ''}</span><p>${esc(m.desc)}</p></button>`).join('')
    + `</div></div>`).join('') || '<p class="empty">沒有符合的里程碑。</p>';
  $('#listView').querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openDrawer(W.milestones.find(x => x.id === el.dataset.id))));
}

const DIR = { earlier: ['▲ 提早', 'up'], later: ['▼ 延後', 'down'], none: ['● 相關', ''], happened: ['★ 已發生', 'up'] };
function sigHtml(s) {
  const [t, c] = DIR[s.direction] || DIR.none, m = W.milestones.find(x => x.id === s.milestone);
  return `<div class="sig" style="--c:${col(s.domain)}"><span class="dir ${c}">${t}</span><div><a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`
    + `<p>${esc(s.summary)}</p><small>${esc(s.date || s.found)}・${s.source === 'grok' ? 'Grok（X）' : 'Claude 搜尋'}${m ? '・→ ' + esc(m.title) : ''}・強度 ${'●'.repeat(s.strength || 1)}</small></div></div>`;
}
function renderSignals() {
  const s = (W.signals || []).slice(0, 24);
  $('#signals').innerHTML = s.length ? s.map(sigHtml).join('') : '<p class="empty">還沒有信號。每天更新後，影響時間軸的新聞會出現在這裡。</p>';
}

function histChart(m) {
  const h = m.history || [];
  if (h.length < 2) return `<p>目前只有初始預測（${esc(h[0]?.date || '')}）。之後每次移動都會畫在這裡。</p>`;
  const w = 460, ht = 150, pl = 34, pr = 10, pt = 10, pb = 22;
  const ys = h.flatMap(p => [p.lo, Math.min(p.hi, Y1 + 1)]), ymin = Math.min(...ys) - 1, ymax = Math.max(...ys) + 1;
  const t0 = Date.parse(h[0].date), t1 = Math.max(Date.parse(h[h.length - 1].date), t0 + 864e5);
  const X = d => pl + (Date.parse(d) - t0) / (t1 - t0) * (w - pl - pr), Y = y => pt + (y - ymin) / (ymax - ymin) * (ht - pt - pb);   // earlier years on top
  const step = (k) => h.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(Math.min(p[k], Y1 + 1)).toFixed(1)}`).join('');
  const band = `M${h.map(p => `${X(p.date).toFixed(1)},${Y(p.lo).toFixed(1)}`).join('L')}L${[...h].reverse().map(p => `${X(p.date).toFixed(1)},${Y(Math.min(p.hi, Y1 + 1)).toFixed(1)}`).join('L')}Z`;
  const ticks = [ymin + 1, Math.round((ymin + ymax) / 2), ymax - 1].map(y => `<text x="${pl - 4}" y="${Y(y) + 3}" text-anchor="end">${y}</text>`).join('');
  return `<svg class="hist" viewBox="0 0 ${w} ${ht}" role="img" aria-label="${esc(m.title)} 預測年份的變化">`
    + `<path d="${band}" fill="${col(m.domain)}" opacity=".18"/><path d="${step('median')}" fill="none" stroke="${col(m.domain)}" stroke-width="2"/>`
    + h.map(p => `<circle cx="${X(p.date)}" cy="${Y(p.median)}" r="4" fill="${col(m.domain)}" stroke="var(--surface)" stroke-width="2"><title>${esc(p.date)}：${p.median}（${p.lo}–${p.hi}）${esc(p.why)}</title></circle>`).join('')
    + ticks + `<text x="${pl}" y="${ht - 6}">${esc(h[0].date)}</text><text x="${w - pr}" y="${ht - 6}" text-anchor="end">${esc(h[h.length - 1].date)}</text></svg>`;
}

let lastFocus = null;
function openDrawer(m) {
  if (!m) return;
  lastFocus = document.activeElement; hideTip();
  const d = W.domains.find(x => x.id === m.domain), age = ageAt(m.median);
  const sigs = (W.signals || []).filter(s => s.milestone === m.id).slice(0, 10);
  $('#dBody').innerHTML = `<span class="dk" style="--c:${col(m.domain)}"><i></i>${esc(d?.name)}</span><h3 id="dTitle">${esc(m.title)}</h3>`
    + `<div class="big"><b>${m.status === 'happened' ? '已發生' : yLabel(m.median)}</b><span>80% 區間 ${yLabel(m.lo)}–${yLabel(m.hi)}</span>${age ? `<span class="age">${age}</span>` : ''}</div>`
    + `<p>${esc(m.desc)}</p>`
    + `<h4>對台灣人的影響</h4><p>${esc(m.impact)}</p>`
    + `<h4>年份怎麼來的</h4><p>${esc(m.basis)}</p>`
    + `<h4>預測的變化</h4>${histChart(m)}`
    + `<table class="htab"><thead><tr><th>日期</th><th>年份</th><th>原因</th></tr></thead><tbody>${[...(m.history || [])].reverse().map(p => `<tr><td>${esc(p.date)}</td><td>${yLabel(p.median)}（${yLabel(p.lo)}–${yLabel(p.hi)}）</td><td>${esc(p.why)}</td></tr>`).join('')}</tbody></table>`
    + (sigs.length ? `<h4>相關信號</h4><div class="signals">${sigs.map(sigHtml).join('')}</div>` : '')
    + `<h4>來源</h4><ul>${(m.sources || []).map(s => `<li><a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('')}</ul>`;
  $('#drawer').hidden = false; $('#dClose').focus();
  history.replaceState(null, '', '#' + encodeURIComponent(m.id));
}
function closeDrawer() {
  if ($('#drawer').hidden) return;
  $('#drawer').hidden = true; history.replaceState(null, '', location.pathname + location.search);
  lastFocus?.focus?.();
}

main();
