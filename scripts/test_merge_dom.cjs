// Public-site DOM/data checks. Real browser layout and WebGL are checked separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require(process.env.JSDOM_MODULE || 'jsdom');
const ROOT = path.resolve(__dirname, '../public');
const checks = [], targets = new Set();
const check = (value, name) => { assert.ok(value, name); checks.push(name); };
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const report = (status, errors = []) => fs.writeFileSync(path.resolve(__dirname, '../verification/merge-dom-check.json'),
  JSON.stringify({status, checks, count: checks.length, errors,
    scope: 'Composed output, DOM, local links and actual city data-page interactions; no layout/WebGL validation'}, null, 2) + '\n');
function documentAt(file) {
  return new JSDOM(read(file), {url: 'https://local.invalid/' + file});
}
function checkLocalLinks(file, document) {
  for (const element of document.querySelectorAll('[href],[src],[srcset]')) {
    for (const key of ['href', 'src', 'srcset']) {
      if (!element.hasAttribute(key)) continue;
      const url = new URL(element.getAttribute(key), 'https://local.invalid/' + file);
      if (url.origin !== 'https://local.invalid') continue;
      let target = decodeURIComponent(url.pathname).slice(1);
      if (!target || target.endsWith('/')) target += 'index.html';
      assert.ok(fs.statSync(path.join(ROOT, target)).isFile(), `${file} -> ${target}`);
      targets.add(target);
    }
  }
  check(true, file + ' local links/assets resolve in composed output');
}
(async () => {
  for (const file of ['index.html', 'projects/index.html']) {
    const dom = documentAt(file), doc = dom.window.document;
    check(doc.documentElement.lang === 'zh-Hant' && doc.querySelector('h1').textContent === '作品入口', file + ' is a Chinese works page');
    check(doc.querySelectorAll('.card').length === 6 && doc.querySelectorAll('.open a').length === 7, file + ' has six cards and seven work links');
    check([...doc.querySelectorAll('nav.jump a')].map(el => el.textContent).join('|') === '看台灣 3|AI 作品 2|遊戲與故事 1', file + ' has three themes');
    check(doc.querySelector('#game .card').querySelectorAll('.open a').length === 2 && doc.querySelector('a[href="/room/#landing"]'), file + ' keeps Okinawa inside voyage card');
    check(doc.querySelectorAll('.pv').length === 3 && doc.querySelectorAll('.pv source[media="(prefers-reduced-motion: reduce)"]').length === 3, file + ' retains three previews with reduced-motion posters');
    check(!/部落格|每日預言|AI 前沿日報|全球關注|文章/.test(doc.body.textContent), file + ' has no retired cards/groups');
    check(doc.querySelector('footer').textContent.includes('2026-10-24'), file + ' checked date');
    checkLocalLinks(file, doc);
    dom.window.close();
  }
  check(read('index.html') === read('projects/index.html'), 'root and projects are identical generated pages');
  for (const file of ['404.html', 'apps/future/index.html', 'apps/future/data.html']) {
    const dom = documentAt(file), doc = dom.window.document;
    checkLocalLinks(file, doc);
    if (file === '404.html') {
      check(doc.documentElement.lang === 'zh-Hant' && doc.querySelector('a[href="/projects/"]'), 'Chinese 404 returns to projects');
    } else if (file.endsWith('index.html')) {
      const ids = [...doc.querySelectorAll('[id]')].map(el => el.id);
      check(ids.length === new Set(ids).size, 'standalone city has unique IDs');
      check(doc.title === '時光之城' && doc.querySelector('main#city-panel') && !doc.querySelector('[role="tab"],[role="tablist"],[role="tabpanel"]'), 'city is a single page without tab UI');
      check(doc.querySelector('script[type="module"][src="city.js"]') && doc.querySelector('#milestone'), 'city boots directly and retains milestone selector');
      check(!/oracle|work-tabs|tabs\.js/.test(read(file)), 'city has no retired module/style references');
    }
    dom.window.close();
  }
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../verification/baseline.json')));
  const removals = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../verification/remove.json')));
  const deleted = Object.keys(baseline).filter(file => removals.some(r => r.endsWith('/') ? file.startsWith(r) : file === r));
  check(deleted.every(file => !fs.existsSync(path.join(ROOT, file))), 'every reviewed baseline deletion is absent');
  for (const route of ['apps/world','apps/world-taiwan','apps/ai-frontier','apps/oracle','apps/future/oracle','apps/shared','posts','tags','categories','archives','public']) {
    check(!fs.existsSync(path.join(ROOT, route)), route + ' has no public directory or redirect');
  }
  // Execute the retained data-page script against the real bundled JSON, including deep links.
  const dom = new JSDOM(read('apps/future/data.html'), {
    url: 'https://local.invalid/apps/future/data.html#energy-fusion-grid',
    pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const {window} = dom, doc = window.document, requests = [];
  const data = JSON.parse(read('apps/future/data/world.json'));
  window.fetch = async input => {
    const url = new URL(input, window.location.href);
    assert.equal(url.origin, 'https://local.invalid');
    requests.push(url.pathname);
    return {ok: true, json: async () => JSON.parse(read(url.pathname.slice(1)))};
  };
  window.eval(read('apps/future/app.js'));
  for (let i = 0; i < 100 && doc.querySelector('#meta').textContent === '讀取中…'; i++) await tick();
  check(requests.length === 1 && requests[0] === '/apps/future/data/world.json', 'data page loads the retained local snapshot once');
  check(doc.querySelector('#meta').textContent.includes(String(data.milestones.length)), 'data page renders the real milestone count');
  check(!doc.querySelector('#drawer').hidden && doc.querySelector('#dTitle').textContent.includes('核融合'), 'milestone deep link still opens its data detail');
  doc.querySelector('#dClose').click();
  check(doc.querySelector('#drawer').hidden && !window.location.hash, 'data detail closes and clears hash');
  doc.querySelector('[data-view="list"]').click();
  check(doc.querySelectorAll('#listView .card').length === data.milestones.length, 'list view renders every milestone');
  doc.querySelector('#chips [data-d="energy"]').click();
  check(doc.querySelectorAll('#listView .card').length === data.milestones.filter(m => m.domain !== 'energy').length, 'domain filter still works');
  doc.querySelector('#chips [data-d="energy"]').click();
  doc.querySelector('#listView .card').click();
  check(!doc.querySelector('#drawer').hidden && doc.querySelectorAll('#dBody a').length > 0, 'milestone card opens detail and source links');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  check(doc.querySelector('#drawer').hidden, 'Escape closes the data detail');
  check(doc.querySelector('a.back').getAttribute('href') === './', 'data page returns to standalone city');
  dom.window.close();
  fs.writeFileSync(path.resolve(__dirname, '../verification/link-check.json'), JSON.stringify({
    status: 'passed', project_cards: 6, work_links: 7, local_links_exist: true,
    checked_pages: ['index.html','projects/index.html','404.html','apps/future/index.html','apps/future/data.html'],
    checked_local_targets: [...targets].sort(), external_links_checked: false
  }, null, 2) + '\n');
  report('passed');
  console.log(`${checks.length} DOM/data checks passed (no layout/WebGL validation).`);
})().catch(error => { report('failed', [error.message]); console.error(error); process.exitCode = 1; });
