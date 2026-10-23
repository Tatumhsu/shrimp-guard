const fs = require('node:fs');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const NOTICE = '這個網站目前沒有公開內容。';
const viewports = [['desktop',1440,1000,false],['mobile',390,844,true],['mobile360',360,740,true]];
const results = [], screenshots = [];
let browser;
function report(status, errors = []) {
 fs.writeFileSync('verification/browser-check.json', JSON.stringify({task: 'TASK-SITE4', status, checks: results, count: results.length,
  browser: 'Chromium via Playwright', viewports: viewports.map(([,w,h]) => `${w}x${h}`), base: BASE, screenshots, errors,
  scope: 'Closed-site notices, no links/noindex, mobile layout, Chinese 404, support files and HTTP 404 for all exact deletions'}, null, 2) + '\n');
}
(async () => {
 const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
 browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})});
 fs.mkdirSync('.release/screenshots', {recursive: true});
 const baseline = JSON.parse(fs.readFileSync('verification/baseline.json'));
 const removals = JSON.parse(fs.readFileSync('verification/remove.json'));
 const allow = JSON.parse(fs.readFileSync('verification/allowlist.json'));
 const deleted = Object.keys(baseline).filter(p => removals.some(r => r.endsWith('/') ? p.startsWith(r) : p === r)).sort();
 if (JSON.stringify(deleted) !== JSON.stringify(allow.deleted)) throw Error('Removal manifest differs from exact deletion allowlist');
 if (Object.keys(baseline).some(p => p.startsWith('apps/future/') && !deleted.includes(p))) throw Error('City files are missing from exact deletion allowlist');
 for (const [label,width,height,mobile] of viewports) {
  const page = await browser.newPage({viewport: {width,height}, isMobile: mobile, hasTouch: mobile});
  const errors = [], requests = [], failedRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  page.on('requestfailed', r => failedRequests.push(r.url()));
  const check = (value, name) => {if (!value) throw Error(label + ': ' + name); results.push(label + ': ' + name);};
  const screenshot = async name => {
   const file = `.release/screenshots/site4-${name}-${label}.png`;
   await page.screenshot({path: file, fullPage: true}); screenshots.push(file);
  };
  const noOverflow = async name => check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no horizontal overflow');
  const closedPage = async (route, missing = false) => {
   check(await page.locator('html').getAttribute('lang') === 'zh-Hant', route + ' Traditional Chinese');
   check(await page.locator('meta[name="robots"]').count() === 1 &&
    (await page.locator('meta[name="robots"]').getAttribute('content')).split(',').map(v => v.trim().toLowerCase()).includes('noindex'), route + ' noindex');
   check(await page.locator('main').count() === 1 && await page.locator('h1').count() === 1, route + ' one main landmark and heading');
   const heading = missing ? '找不到這個頁面' : NOTICE;
   check(await page.locator('h1').innerText() === heading && await page.locator('h1').isVisible(), route + ' visible Chinese heading');
   if (missing) {
    const body = await page.locator('body').innerText();
    check(body.includes('404') && body.includes(NOTICE), route + ' explains closed site');
   } else {
    check((await page.locator('body').innerText()).trim() === NOTICE, route + ' shows only closure notice');
   }
   check(await page.locator('a,area,nav,article,.card,.open,footer').count() === 0, route + ' no links, navigation or works');
   check(await page.locator('script,iframe,object,embed,form,button,input,canvas,picture,img,source').count() === 0, route + ' no active content or previews');
   check(await page.locator('meta[http-equiv]').evaluateAll(es => es.every(e => e.httpEquiv.toLowerCase() !== 'refresh')), route + ' no meta redirect');
   check(await page.locator('*').evaluateAll(es => es.every(e => [...e.attributes].every(a => !/^on/i.test(a.name)))), route + ' no event handlers');
   check(!/時光之城|作品入口|\/apps\/|部落格|光影台灣|此刻台灣的聲音|瀏覽器 AI 實驗室|Emergence World|航程風浪|沖繩上岸|projects\/previews\/|dashboard\.shrimp-guard\.us\.ci/.test(await page.content()), route + ' no retired work or private dashboard references');
   const assets = await page.locator('[href],[src],[srcset]').evaluateAll(es => es.map(e => [e.tagName, e.getAttribute('rel'), e.getAttribute('href'), e.getAttribute('src'), e.getAttribute('srcset')]));
   check(JSON.stringify(assets) === JSON.stringify([['LINK','icon','/favicon.ico',null,null],['LINK','icon','/favicon.svg',null,null]]), route + ' references only local favicons');
   await noOverflow(route);
  };
  let rootBody;
  for (const route of ['/', '/projects/', '/404.html']) {
   const response = await page.goto(BASE + route);
   check(response.status() === 200 && response.request().redirectedFrom() === null && page.url() === BASE + route, route + ' served without redirect');
   if (route === '/') rootBody = await response.body();
   if (route === '/projects/') check(rootBody.equals(await response.body()), 'root and projects have identical bytes');
   await closedPage(route, route === '/404.html');
   await screenshot(route === '/' ? 'home' : route === '/projects/' ? 'projects' : '404');
   const reloaded = await page.reload();
   check(reloaded.status() === 200 && await page.locator('h1').innerText() === (route === '/404.html' ? '找不到這個頁面' : NOTICE), route + ' reload retains notice');
   await page.emulateMedia({reducedMotion: 'reduce', colorScheme: 'dark'});
   check(await page.locator('h1').isVisible(), route + ' notice visible in dark/reduced-motion mode');
   await noOverflow(route + ' dark/reduced-motion');
   await page.emulateMedia({reducedMotion: 'no-preference', colorScheme: 'light'});
  }
  check(requests.every(u => {
   const url = new URL(u);
   return url.origin === new URL(BASE).origin && ['/', '/projects/', '/404.html', '/favicon.ico', '/favicon.svg'].includes(url.pathname);
  }), 'pages request only closure documents and favicons');
  check(failedRequests.length === 0, 'no failed page requests: ' + failedRequests.join('; '));
  check(errors.length === 0, 'no JavaScript errors: ' + errors.join('; '));
  const goneRoutes = [...new Set([
   ...removals.filter(r => r.endsWith('/')).map(r => '/' + r),
   '/apps/future', '/apps/future/', '/apps/future/#oracle', '/apps/future/data/', '/apps/future/vendor/',
   '/apps/world/', '/apps/world-taiwan/', '/apps/ai-frontier/', '/apps/oracle/',
   '/apps/relief/', '/apps/sound/', '/apps/ailab/', '/assets/css/',
   '/apps/future/oracle/', '/apps/shared/', '/room/#landing', '/archives/', '/world-impact/', '/taipei-mrt/'
  ])];
  for (const gone of goneRoutes) {
   const response = await page.request.get(BASE + gone, {maxRedirects: 0});
   check(response.status() === 404, 'retired URL returns 404 without redirect ' + gone);
  }
  if (label === 'desktop') {
   for (const file of deleted) {
    const response = await page.request.get(BASE + '/' + file, {maxRedirects: 0});
    check(response.status() === 404, 'reviewed deletion returns 404 ' + file);
   }
   for (const file of ['favicon.ico','favicon.svg','CNAME']) {
    const response = await page.request.get(BASE + '/' + file, {maxRedirects: 0});
    check(response.status() === 200, 'preserved support file ' + file);
    check((await response.body()).equals(fs.readFileSync('public/' + file)), 'support file bytes match candidate ' + file);
   }
  }
  await page.close();
 }
 await browser.close(); browser = null; report('passed'); console.log(JSON.stringify({passed: results.length}));
})().catch(async e => {
 if (browser) await browser.close().catch(() => {});
 const blocked = /Operation not permitted|Permission denied/.test(e.message);
 const message = blocked ? 'Browser check blocked by environment permissions: ' + e.message.split('\n').find(line => /Operation not permitted|Permission denied/.test(line)) : e.message.split('Call log:')[0].slice(0,2000);
 report(blocked ? 'blocked' : 'failed', [message]); console.error(message); process.exitCode = 1;
});
