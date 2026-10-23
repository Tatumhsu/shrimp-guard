// Closed public-site DOM checks. Browser layout and HTTP status are checked separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require(process.env.JSDOM_MODULE || 'jsdom');
const ROOT = path.resolve(__dirname, '../public');
const PAGES = ['index.html', 'projects/index.html', '404.html'];
const PUBLIC_FILES = ['404.html', 'CNAME', 'favicon.ico', 'favicon.svg', 'index.html', 'projects/index.html'];
const NOTICE = '這個網站目前沒有公開內容。';
const checks = [], targets = new Set();
const check = (value, name) => { assert.ok(value, name); checks.push(name); };
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const report = (status, errors = []) => fs.writeFileSync(path.resolve(__dirname, '../verification/merge-dom-check.json'),
  JSON.stringify({task: 'TASK-SITE4', status, checks, count: checks.length, errors,
    scope: 'Closed-site composed output, DOM, noindex, absence of public links and local favicon assets; no browser layout or HTTP validation'}, null, 2) + '\n');
function filesAt(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesAt(file) : [path.relative(ROOT, file).split(path.sep).join('/')];
  }).sort();
}
function checkLocalAssets(file, document) {
  const pageTargets = [];
  for (const element of document.querySelectorAll('[href],[src],[srcset]')) {
    for (const key of ['href', 'src', 'srcset']) {
      if (!element.hasAttribute(key)) continue;
      assert.equal(element.tagName, 'LINK');
      assert.equal(element.getAttribute('rel'), 'icon');
      assert.equal(key, 'href');
      const url = new URL(element.getAttribute(key), 'https://local.invalid/' + file);
      assert.equal(url.origin, 'https://local.invalid');
      const target = decodeURIComponent(url.pathname).slice(1);
      assert.ok(fs.statSync(path.join(ROOT, target)).isFile(), `${file} -> ${target}`);
      targets.add(target); pageTargets.push(target);
    }
  }
  check(JSON.stringify(pageTargets.sort()) === JSON.stringify(['favicon.ico', 'favicon.svg']), file + ' references only existing local favicons');
}
try {
  check(JSON.stringify(filesAt(ROOT)) === JSON.stringify(PUBLIC_FILES), 'output contains exactly six closed-site support files');
  for (const file of PAGES) {
    const dom = new JSDOM(read(file), {url: 'https://local.invalid/' + file}), doc = dom.window.document;
    check(doc.documentElement.lang === 'zh-Hant', file + ' is Traditional Chinese');
    check(doc.querySelectorAll('meta[name="robots"]').length === 1 &&
      doc.querySelector('meta[name="robots"]').content.split(',').map(v => v.trim().toLowerCase()).includes('noindex'), file + ' has noindex');
    check(doc.querySelectorAll('main').length === 1 && doc.querySelectorAll('h1').length === 1, file + ' has one main landmark and heading');
    if (file === '404.html') {
      check(doc.querySelector('h1').textContent === '找不到這個頁面' && doc.body.textContent.includes('404') && doc.body.textContent.includes(NOTICE), 'Chinese 404 explains the closed site');
    } else {
      check(doc.querySelector('h1').textContent === NOTICE && doc.body.textContent.trim() === NOTICE, file + ' shows only the closure notice');
    }
    check(!doc.querySelector('a,area,nav,article,.card,.open,footer'), file + ' has no links, navigation or works content');
    check(!doc.querySelector('script,iframe,object,embed,form,button,input,canvas,picture,img,source'), file + ' has no active content or previews');
    check(![...doc.querySelectorAll('meta[http-equiv]')].some(e => e.httpEquiv.toLowerCase() === 'refresh'), file + ' has no redirect');
    check(![...doc.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name))), file + ' has no event handlers');
    check(!/時光之城|作品入口|\/apps\/|部落格|光影台灣|此刻台灣的聲音|瀏覽器 AI 實驗室|Emergence World|航程風浪|沖繩上岸|projects\/previews\/|dashboard\.shrimp-guard\.us\.ci/.test(read(file)), file + ' has no retired work or private dashboard references');
    checkLocalAssets(file, doc);
    dom.window.close();
  }
  check(read('index.html') === read('projects/index.html'), 'root and projects are identical generated notices');
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../verification/baseline.json')));
  const removals = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../verification/remove.json')));
  const allow = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../verification/allowlist.json')));
  const deleted = Object.keys(baseline).filter(file => removals.some(r => r.endsWith('/') ? file.startsWith(r) : file === r)).sort();
  check(JSON.stringify(deleted) === JSON.stringify(allow.deleted), 'removal manifest matches every exact allowlisted deletion');
  check(deleted.every(file => !fs.existsSync(path.join(ROOT, file))), 'every reviewed baseline deletion is absent');
  check(!fs.existsSync(path.join(ROOT, 'apps/future')), 'entire city including data and vendor assets is retired');
  for (const route of ['apps','room','projects/previews','posts','tags','categories','archives','page','about','public','assets']) {
    check(!fs.existsSync(path.join(ROOT, route)), route + ' has no public directory or redirect');
  }
  fs.writeFileSync(path.resolve(__dirname, '../verification/link-check.json'), JSON.stringify({
    task: 'TASK-SITE4', status: 'passed', project_cards: 0, work_links: 0, navigation_links: 0,
    noindex_pages: PAGES, local_links_exist: true, checked_pages: PAGES,
    checked_local_targets: [...targets].sort(), external_links_checked: false
  }, null, 2) + '\n');
  report('passed');
  console.log(`${checks.length} closed-site DOM checks passed (no browser layout or HTTP validation).`);
} catch (error) {
  report('failed', [error.message]); console.error(error); process.exitCode = 1;
}
