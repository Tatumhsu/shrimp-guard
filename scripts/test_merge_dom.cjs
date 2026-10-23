// DOM/data regression checks without a server or browser. These do not verify layout/WebGL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL, fileURLToPath} = require('node:url');
const {JSDOM} = require(process.env.JSDOM_MODULE || 'jsdom');
const ROOT = path.resolve(__dirname, '../public');
const checks = [];
const check = (value, name) => { assert.ok(value, name); checks.push(name); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  assert.fail('DOM condition timed out');
}
function setup(app, hash = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'apps', app, 'index.html'), 'utf8'), {
    url: `https://local.invalid/apps/${app}/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const {window} = dom;
  for (const key of ['window','document','location','history','Event']) global[key] = key === 'window' ? window : window[key];
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.ResizeObserver = class { observe() {} };
  window.scrollTo = () => {};
  const requests = [];
  global.fetch = async input => {
    const url = new URL(input, window.location.href);
    const file = url.protocol === 'file:' ? fileURLToPath(url) : path.join(ROOT, url.pathname);
    assert.ok(file.startsWith(ROOT + path.sep), 'fetch stays in built public output');
    requests.push(file.slice(ROOT.length));
    const bytes = fs.readFileSync(file);
    return {ok: true, json: async () => JSON.parse(bytes)};
  };
  return {dom, window, requests};
}
const moduleAt = relative => import(pathToFileURL(path.join(ROOT, relative)));

(async () => {
  const {mountTabs} = await moduleAt('apps/shared/work-tabs.js');
  const {initOracle} = await moduleAt('apps/future/oracle/app.js');
  const {initTaiwan} = await moduleAt('apps/world/taiwan/app.js');
  {
    const {dom,window,requests} = setup('future');
    let cityStarts = 0, oracleStarts = 0;
    const activity = [];
    mountTabs({city: async () => { cityStarts++; return {setActive: active => activity.push(active)}; },
      oracle: root => { oracleStarts++; return initOracle(root); }});
    await tick();
    check(cityStarts === 1 && oracleStarts === 0 && requests.length === 0, 'oracle JS/data stay lazy on city tab');
    document.getElementById('tab-oracle').click();
    await until(() => document.getElementById('oracle-panel').dataset.ready === '1');
    check(location.hash === '#oracle' && document.getElementById('city-panel').hidden, 'oracle click updates hash and hides city');
    check(activity.at(-1) === false, 'city lifecycle deactivates on tab change');
    check(document.querySelectorAll('#oracle-cards .card').length === 15, 'all 15 predictions render');
    check(document.querySelectorAll('#oracle-board-table tbody tr').length === 4, 'all four forecasters render');
    check(document.querySelectorAll('#oracle-history-list .hrow').length === 11 && document.querySelectorAll('#oracle-pending-list .hrow').length === 4, 'resolved and pending histories render');
    check(!document.getElementById('oracle-today-meta').textContent.includes('費用'), 'billing metadata absent');
    const cityBefore = document.getElementById('city-panel').innerHTML;
    document.querySelector('#oracle-filters [data-cat="weather"]').click();
    check(document.querySelectorAll('#oracle-cards .card:not(.hidden)').length === 6, 'oracle weather filtering works');
    check(document.getElementById('city-panel').innerHTML === cityBefore, 'oracle filter does not mutate city DOM');
    document.getElementById('tab-city').click(); document.getElementById('tab-oracle').click();
    await tick();
    check(cityStarts === 1 && oracleStarts === 1 && requests.length === 3, 'repeated switching does not reinitialize or refetch');
    check(document.querySelectorAll('#oracle-cards .card:not(.hidden)').length === 6, 'oracle filter survives tab switch');
    const tab = document.getElementById('tab-oracle');
    tab.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowLeft',bubbles:true}));
    check(document.activeElement.id === 'tab-city' && location.hash === '#city', 'arrow key activates and focuses previous tab');
    window.history.back();
    await until(() => location.hash === '#oracle' && !document.getElementById('oracle-panel').hidden);
    check(true, 'browser history restores selected tab');
    dom.window.close();
  }
  {
    const {dom,requests} = setup('future','#oracle');
    let cityStarts = 0;
    mountTabs({city: async () => cityStarts++, oracle: initOracle});
    await until(() => document.getElementById('oracle-panel').dataset.ready === '1');
    check(cityStarts === 0 && requests.length === 3, 'oracle deep link skips the city initialization');
    dom.window.close();
  }
  {
    const {dom,requests} = setup('world','#taiwan');
    let worldStarts = 0;
    const worldBefore = document.getElementById('world-panel').innerHTML;
    mountTabs({world: async () => worldStarts++, taiwan: initTaiwan});
    await until(() => document.getElementById('taiwan-panel').dataset.ready === '1');
    check(worldStarts === 0 && requests.length === 1, 'Taiwan deep link skips Leaflet and world data');
    check(document.querySelectorAll('#taiwan-cards .card').length === 8, 'all eight news cards render');
    check(document.querySelectorAll('#taiwan-tw3 .twc').length === 3 && document.querySelectorAll('#taiwan-raw > li').length === 122, 'Taiwan highlights and full source list render');
    document.querySelector('#taiwan-panel [data-tab="industry"]').click();
    check(location.hash === '#taiwan' && document.querySelectorAll('#taiwan-cards .card').length === 3, 'Taiwan category does not overwrite work hash');
    document.querySelector('#taiwan-overlay [data-r="japankorea"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    check(document.querySelectorAll('#taiwan-cards .card').length === 2, 'Taiwan map keyboard region filter works');
    document.getElementById('taiwan-clearRegion').click();
    check(document.querySelectorAll('#taiwan-cards .card').length === 3, 'clear region restores category');
    check(document.getElementById('world-panel').innerHTML === worldBefore, 'Taiwan controls do not mutate world DOM');
    document.getElementById('tab-world').click(); document.getElementById('tab-taiwan').click();
    await tick();
    check(requests.length === 1 && document.querySelectorAll('#taiwan-cards .card').length === 3, 'Taiwan state persists without duplicate fetches');
    const ids = [...document.querySelectorAll('[id]')].map(el=>el.id);
    check(new Set(ids).size === ids.length, 'dynamic SVG gradient and panel IDs remain unique');
    dom.window.close();
  }
  {
    const {dom} = setup('world');
    let finishWorld, attempts = 0;
    const activity = [];
    mountTabs({world: () => new Promise(resolve => { finishWorld = () => resolve({setActive: value => activity.push(value)}); }),
      taiwan: async () => { if (++attempts === 1) throw new Error('fixture failure'); }});
    document.getElementById('tab-taiwan').click();
    await until(() => document.querySelector('#taiwan-panel .work-message button'));
    check(document.getElementById('taiwan-panel').getAttribute('aria-busy') === 'false', 'load failure clears busy state and offers retry');
    finishWorld(); await tick();
    check(activity.at(-1) === false, 'slow initialization cannot reactivate a hidden tab');
    document.querySelector('#taiwan-panel .work-message button').click();
    await until(() => !document.querySelector('#taiwan-panel .work-message'));
    check(attempts === 2, 'failed lazy initialization can be retried');
    dom.window.close();
  }
  {
    const {dom,window,requests} = setup('world');
    // Execute the actual vendored map libraries; only layout is unavailable in jsdom.
    window.SVGSVGElement.prototype.createSVGRect = () => ({});
    const originalAppend = document.head.append.bind(document.head);
    document.head.append = script => {
      originalAppend(script);
      const url = new URL(script.src);
      window.eval(fs.readFileSync(url.protocol === 'file:' ? fileURLToPath(url) : path.join(ROOT,url.pathname),'utf8'));
      script.onload();
    };
    const {initWorld} = await moduleAt('apps/world/app.js');
    mountTabs({world: initWorld, taiwan: initTaiwan});
    await until(() => document.getElementById('world-panel').dataset.ready === '1');
    check(document.querySelectorAll('#map .leaflet-overlay-pane path').length > 100, 'actual Leaflet/TopoJSON render country paths');
    check(document.querySelectorAll('#topicCards .card').length > 0 && document.querySelectorAll('#langs button').length === 20, 'world topics and language controls render');
    document.querySelector('#langs [data-l="ja"]').click();
    check(document.querySelector('#region h4').textContent === JSON.parse(fs.readFileSync(path.join(ROOT,'apps/world/data/api/20261016.json'))).doc.regions.ja.name + '維基百科', 'world language selection works');
    const before = document.getElementById('region').innerHTML;
    document.getElementById('tab-taiwan').click();
    await until(() => document.getElementById('taiwan-panel').dataset.ready === '1');
    document.querySelector('#taiwan-panel [data-tab="geo"]').click();
    document.getElementById('tab-world').click();
    check(document.getElementById('region').innerHTML === before, 'world selection survives Taiwan interactions');
    check(requests.every(url=>url.startsWith('/apps/world/')), 'both world tabs load only their bundled local data');
    dom.window.close();
  }
  fs.writeFileSync(path.resolve(__dirname,'../verification/merge-dom-check.json'),JSON.stringify({status:'passed',checks,count:checks.length,scope:'DOM, bundled data and navigation only; no browser layout or WebGL validation'},null,2)+'\n');
  console.log(`${checks.length} DOM/data checks passed (no layout/WebGL validation).`);
})().catch(error=>{
  fs.writeFileSync(path.resolve(__dirname,'../verification/merge-dom-check.json'),JSON.stringify({status:'failed',checks,count:checks.length,errors:[error.message],scope:'DOM/data only; no layout/WebGL validation'},null,2)+'\n');
  console.error(error);process.exitCode=1;
});
