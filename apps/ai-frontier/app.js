// AI 前沿日報 — renders data/<day>.json written by tools/digest.py
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDay = d => `${+d.slice(4, 6)} 月 ${+d.slice(6)} 日`;
const ui = { field: null, doc: null };
const slug = s => 'x-' + String(s).replace(/[^\w.-]+/g, '-');

async function load(day) {
  ui.doc = await (await fetch(`data/${day}.json`, { cache: 'no-cache' })).json();
  ui.field = null; render();
}
function fieldCounts(d) { const c = {}; for (const x of [...d.papers, ...d.models, ...d.repos]) c[x.field] = (c[x.field] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]); }
function render() {
  const d = ui.doc, O = d.overview;
  $('#meta').textContent = `${fmtDay(d.day)}・${d.papers.length} 篇論文・${d.models.length} 個模型・${d.repos.length} 個專案`;
  $('#headline').textContent = O.headline;
  const known = new Set([...d.papers.map(p => p.id), ...d.models.map(m => m.id), ...d.repos.map(r => r.name)]);
  $('#trends').innerHTML = O.trends.map(t => `<div class="trend"><h3>${esc(t.title)}</h3><p>${esc(t.body)}</p><div class="refs">${(t.refs || []).filter(r => known.has(r)).map(r => `<a href="#${slug(r)}">${esc(r)}</a>`).join('')}</div></div>`).join('');
  $('#everyone').textContent = O.for_everyone;
  $('#watch').innerHTML = (O.watch || []).map(w => `<li>${esc(w)}</li>`).join('');
  const counts = fieldCounts(d);
  $('#fields').innerHTML = [`<button type="button" data-f="" aria-pressed="${!ui.field}">全部</button>`, ...counts.map(([f, n]) => `<button type="button" data-f="${esc(f)}" aria-pressed="${ui.field === f}">${esc(f)}<small>${n}</small></button>`)].join('');
  const show = x => !ui.field || x.field === ui.field;
  const tags = x => `<div class="tags"><span class="tag f">${esc(x.field)}</span>${x.level ? `<span class="tag">${esc(x.level)}</span>` : ''}${x.run ? `<span class="tag">可跑在：${esc(x.run)}</span>` : ''}</div>`;
  $('#papers').innerHTML = d.papers.filter(show).map(p => `<article class="card" id="${slug(p.id)}">${tags(p)}<h4>${esc(p.title_zh)}</h4><p class="orig">${esc(p.title)}</p><p class="one">${esc(p.one_line)}</p><p class="why">${esc(p.why)}</p>${p.who ? `<p class="why">誰會在意：${esc(p.who)}</p>` : ''}<div class="links"><span class="num">▲ ${p.upvotes}</span><a href="${esc(p.url)}" target="_blank" rel="noopener">論文頁</a><a href="${esc(p.arxiv)}" target="_blank" rel="noopener">arXiv</a>${p.github ? `<a href="${esc(p.github)}" target="_blank" rel="noopener">程式碼</a>` : ''}</div></article>`).join('') || '<p class="why">這個領域今天沒有論文。</p>';
  $('#models').innerHTML = d.models.filter(show).map(m => `<article class="card" id="${slug(m.id)}">${tags(m)}<h4>${esc(m.id)}</h4><p class="one">${esc(m.what)}</p><p class="why">${esc(m.highlight)}</p><div class="links"><span class="num">♥ ${m.likes ?? '—'}</span>${m.task ? `<span class="num">${esc(m.task)}</span>` : ''}<a href="${esc(m.url)}" target="_blank" rel="noopener">模型頁</a></div></article>`).join('') || '<p class="why">這個領域今天沒有熱門模型。</p>';
  $('#repos').innerHTML = d.repos.filter(show).map(r => `<article class="card" id="${slug(r.name)}">${tags(r)}<h4>${esc(r.name)}</h4><p class="one">${esc(r.what)}</p><p class="why">${esc(r.why)}</p><div class="links"><span class="num">★ ${r.stars}</span>${r.lang ? `<span class="num">${esc(r.lang)}</span>` : ''}<a href="${esc(r.url)}" target="_blank" rel="noopener">GitHub</a></div></article>`).join('') || '<p class="why">這個領域今天沒有新專案。</p>';
}
$('#fields').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ui.field = b.dataset.f || null; render(); });
(async () => {
  try {
    const idx = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
    $('#day').innerHTML = idx.days.map(d => `<option value="${d}">${fmtDay(d)}</option>`).join('');
    const want = new URLSearchParams(location.search).get('day');
    const day = idx.days.includes(want) ? want : idx.latest; $('#day').value = day;
    $('#day').addEventListener('change', e => { history.replaceState(null, '', `?day=${e.target.value}`); load(e.target.value); });
    await load(day);
    if (idx.weeks && idx.weeks.length) {
      const w = await (await fetch(`data/week-${idx.weeks[0]}.json`, { cache: 'no-cache' })).json();
      $('#weekRange').textContent = `${fmtDay(w.days[0])}–${fmtDay(w.days.at(-1))}`;
      const paper = id => `https://huggingface.co/papers/${encodeURIComponent(id)}`;
      $('#weekBody').innerHTML = `<h3>${esc(w.title)}</h3><p>${esc(w.summary)}</p><div class="threads">${w.threads.map(t => `<div class="thread"><b>${esc(t.title)}</b><p>${esc(t.body)}</p></div>`).join('')}</div>` +
        `<p><b>本週必讀</b></p><ol>${w.top_papers.map(p => `<li><a href="${paper(p.id)}" target="_blank" rel="noopener">${esc(p.title_zh)}</a>：${esc(p.why)}</li>`).join('')}</ol>` +
        `<p class="surprise">本週最意外：${esc(w.surprise)}</p><p><b>下週留意</b></p><ol>${w.next_week.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
      $('#week').hidden = false;
    }
  } catch (e) { $('#headline').textContent = '還沒有日報資料。'; }
})();
window.__frontier = ui;
