// AI 預言家 — static page over web/data/{latest,board,history}.json (no frameworks)
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const FC = ['intuition', 'data', 'stats', 'baseline'];
  const NAME = { intuition: '直覺派', data: '數據派', stats: '統計派', baseline: '基準線' };
  const CAT = { weather: '天氣', sea: '海象風力', quake: '地震', wiki: '世界關注' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = p => p == null ? '—' : Math.round(p * 100) + '%';
  const fmtDay = d => d ? `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}` : '';
  const fmtTime = iso => { if (!iso) return ''; const m = iso.match(/(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); return m ? `${+m[2]}/${+m[3]} ${m[4]}:${m[5]}` : iso; };
  const brierTxt = b => b == null ? '—' : b.toFixed(3);
  let filter = 'all';

  async function load(name) {
    const r = await fetch(`data/${name}.json?t=${Date.now()}`);
    if (!r.ok) throw new Error(name + ' ' + r.status);
    return r.json();
  }

  function renderHero(latest, board) {
    $('#hero-date').textContent = latest.day ? fmtDay(latest.day) : '';
    const best = board.forecasters.find(f => f.brier != null);
    const stats = [
      [latest.questions.length, '今天的題目'],
      [board.n_resolved, '已揭曉題數'],
      [best ? brierTxt(best.brier) : '—', best ? `目前最準：${best.name}` : '尚無分數'],
      [board.n_days, '累積天數'],
    ];
    $('#hero-stats').innerHTML = stats.map(([v, k]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('');
  }

  function outcomeTag(o) {
    if (!o) return '';
    return `<span class="tag ${o.outcome ? 'yes' : 'no'}">已揭曉：${o.outcome ? '是' : '否'}${o.actual ? '（' + esc(o.actual) + '）' : ''}</span>`;
  }

  function bars(forecasts, outcome) {
    return `<div class="bars">${FC.map(k => {
      const f = forecasts[k];
      const p = f ? f.p : null;
      const mark = outcome && p != null ? ((p >= 0.5) === !!outcome.outcome ? ' <span class="ok">✓</span>' : ' <span class="bad">✗</span>') : '';
      return `<div class="bar ${k}"><span class="n">${NAME[k]}</span><span class="t"><span class="f" style="width:${p == null ? 0 : Math.round(p * 100)}%"></span></span><span class="p">${pct(p)}${mark}</span><span class="w">${esc(f ? f.why : '（無預測）')}</span></div>`;
    }).join('')}</div>`;
  }

  function renderToday(latest) {
    const meta = [];
    if (latest.created_at) meta.push(`出題時間 ${fmtTime(latest.created_at)}`);
    if (latest.backfilled) meta.push('回填日（事後以當時可得的資料重建）');
    if (latest.model) meta.push(`模型 ${latest.model}`);
    if (latest.cost_usd != null) meta.push(`本日費用 $${latest.cost_usd.toFixed(3)}`);
    $('#today-meta').textContent = meta.join(' · ');
    const box = $('#cards');
    if (!latest.questions.length) { box.innerHTML = '<div class="empty">今天還沒有題目。</div>'; return; }
    box.innerHTML = latest.questions.map(q => `<article class="card" data-cat="${q.category}">
      <div class="tags"><span class="tag">${CAT[q.category] || q.category}</span>${q.outcome ? outcomeTag(q.outcome) : `<span class="tag open">揭曉 ${fmtTime(q.resolve_at)}</span>`}</div>
      <p class="q">${esc(q.text)}</p>
      ${bars(q.forecasts, q.outcome)}
    </article>`).join('');
  }

  function renderFilters() {
    const cats = ['all', ...Object.keys(CAT)];
    $('#filters').innerHTML = cats.map(c => `<button type="button" data-cat="${c}" aria-pressed="${c === filter}">${c === 'all' ? '全部' : CAT[c]}</button>`).join('');
    $('#filters').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      filter = b.dataset.cat;
      $('#filters').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.cat === filter));
      applyFilter();
    };
  }
  function applyFilter() {
    document.querySelectorAll('.card, .hrow').forEach(el => el.classList.toggle('hidden', filter !== 'all' && el.dataset.cat !== filter));
  }

  function renderBoard(board) {
    const tb = $('#board-table tbody');
    const bestB = Math.min(...board.forecasters.filter(f => f.brier != null).map(f => f.brier));
    tb.innerHTML = board.forecasters.map(f => `<tr>
      <td><span class="swatch" style="background:var(--c-${f.key})"></span><span class="nm">${esc(f.name)}</span>${f.kind === 'rule' ? ' <span class="tag">非 AI</span>' : ''}<span class="ds">${esc(f.desc)}</span></td>
      <td class="${f.brier != null && f.brier === bestB ? 'best' : ''}">${brierTxt(f.brier)}</td>
      <td>${pct(f.accuracy)}</td><td>${f.n}</td>
      ${['weather', 'sea', 'quake', 'wiki'].map(c => `<td class="cat-col">${brierTxt(f.by_category[c]?.brier)}<br><small>${f.by_category[c]?.n || 0} 題</small></td>`).join('')}
    </tr>`).join('');
    $('#board-note').textContent = board.n_resolved ? `已依 ${board.n_resolved} 題揭曉結果計算；題數少時排名會大幅波動，請看長期。` : '還沒有題目揭曉，分數會在第一批題目對答案後出現。';
  }

  function renderHistory(h) {
    const list = $('#history-list');
    if (!h.items.length) list.innerHTML = '<div class="empty">還沒有揭曉的題目：第一批結果會在明天對答案後出現。</div>';
    else list.innerHTML = h.items.map(it => `<div class="hrow" data-cat="${it.category}">
      <div class="tags"><span class="tag">${CAT[it.category] || it.category}</span><span>出題 ${fmtDay(it.day)}${it.backfilled ? '（回填）' : ''}</span>${outcomeTag(it)}</div>
      <p class="q">${esc(it.text)}</p>
      <div class="marks">${FC.map(k => { const f = it.forecasts[k]; return f ? `<span>${NAME[k]} ${pct(f.p)} <span class="${f.correct ? 'ok' : 'bad'}">${f.correct ? '✓' : '✗'}</span></span>` : `<span>${NAME[k]} —</span>`; }).join('')}</div>
    </div>`).join('');
    const pend = $('#pending-list');
    pend.innerHTML = h.pending.length ? `<p class="muted">待揭曉（${h.pending.length} 題）</p>` + h.pending.map(p => `<div class="hrow" data-cat="${p.category}"><div class="tags"><span class="tag">${CAT[p.category] || p.category}</span><span>出題 ${fmtDay(p.day)}</span><span class="tag open">揭曉 ${fmtTime(p.resolve_at)}</span></div><p class="q">${esc(p.text)}</p></div>`).join('') : '';
  }

  Promise.all([load('latest'), load('board'), load('history')]).then(([latest, board, history]) => {
    renderHero(latest, board); renderFilters(); renderToday(latest); renderBoard(board); renderHistory(history); applyFilter();
    document.body.dataset.ready = '1';
  }).catch(e => {
    $('#cards').innerHTML = `<div class="empty">資料載入失敗：${esc(e.message)}</div>`;
    document.body.dataset.ready = 'error';
  });
})();
