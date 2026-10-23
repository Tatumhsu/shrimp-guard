const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const viewports = [['desktop',1440,1000,false],['mobile',390,844,true],['mobile360',360,740,true]];
const results = [], screenshots = [];
let browser;
function report(status, errors = []) {
 fs.writeFileSync('verification/browser-check.json', JSON.stringify({status, checks: results, count: results.length,
  browser: 'Chromium via Playwright', viewports: viewports.map(([,w,h]) => `${w}x${h}`), base: BASE, screenshots, errors}, null, 2) + '\n');
}
(async () => {
 const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
 browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})});
 fs.mkdirSync('verification/screenshots', {recursive: true});
 const baseline = JSON.parse(fs.readFileSync('verification/baseline.json'));
 const removals = JSON.parse(fs.readFileSync('verification/remove.json'));
 const deleted = Object.keys(baseline).filter(p => removals.some(r => r.endsWith('/') ? p.startsWith(r) : p === r));
 const expectedLinks = [
  ['時光之城','時光之城','/apps/future/'],['光影台灣','光影台灣','/apps/relief/'],['此刻台灣的聲音','此刻台灣的聲音','/apps/sound/'],
  ['瀏覽器 AI 實驗室','瀏覽器 AI 實驗室','/apps/ailab/'],
  ['Emergence World','Emergence World','https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/'],
  ['航程風浪','航程風浪','/room/'],['航程風浪','沖繩上岸','/room/#landing']
 ];
 for (const [label,width,height,mobile] of viewports) {
  const page = await browser.newPage({viewport: {width,height}, isMobile: mobile, hasTouch: mobile});
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  const check = (value, name) => {if (!value) throw Error(label + ': ' + name); results.push(label + ': ' + name);};
  const screenshot = async name => {
   const file = `verification/screenshots/site2-${name}-${label}.png`;
   await page.screenshot({path: file, fullPage: name !== 'city'}); screenshots.push(file);
  };
  const noOverflow = async name => check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no horizontal overflow');
  const targets = async (selector,name) => check(await page.locator(selector).evaluateAll(elements => elements.filter(e => e.getClientRects().length).every(e => {
   const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44;
  })), name + ' targets at least 44 px');
  for (const route of ['/', '/projects/']) {
   const response = await page.goto(BASE + route);
   check(response.status() === 200, route + ' returns works page without redirect');
   await page.getByRole('heading', {name: '作品入口', exact: true}).waitFor();
   check(JSON.stringify(await page.locator('nav.jump a').allInnerTexts()) === JSON.stringify(['看台灣 3','AI 作品 2','遊戲與故事 1']), route + ' three themes');
   check(await page.locator('#live .card').count() === 3 && await page.locator('#ai .card').count() === 2 && await page.locator('#game .card').count() === 1, route + ' six cards');
   check(await page.locator('.tags .ok').count() === 5 && await page.locator('.tags .dev').count() === 1, route + ' status tags');
   check(!/全球關注|對台灣的影響|AI 前沿日報|每日預言|部落格|文章|離港前60分鐘|僅擁有者|需要登入|\d+\/\d+ 通過/.test(await page.locator('main').innerText()), route + ' retired content absent');
   check(JSON.stringify(await page.locator('.open a').evaluateAll(as => as.map(a => a.getAttribute('href')))) === JSON.stringify(expectedLinks.map(([, ,u]) => u)), route + ' seven work links in order');
   for (const [cardName,linkName,url] of expectedLinks) {
    const card = page.locator('.card').filter({has: page.getByRole('heading', {name: cardName, exact: true})});
    check(await card.getByRole('link', {name: new RegExp(linkName)}).getAttribute('href') === url, route + ' ' + linkName + ' destination');
   }
   check((await page.locator('footer').innerText()).includes('2026-10-24'), route + ' checked date');
   check(await page.locator('.pv img[loading=lazy]').count() === 3, route + ' three retained previews');
   for (const img of await page.locator('.pv img').all()) {
    await img.scrollIntoViewIfNeeded(); await page.waitForFunction(el => el.complete && el.naturalWidth > 0, await img.elementHandle());
   }
   check(true, route + ' all preview images load');
   await noOverflow(route); await targets('.open a,nav.jump a', route + ' navigation');
   check(await page.locator('#live .grid').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length) === (width < 600 ? 1 : 2), route + ' responsive columns');
   await screenshot(route === '/' ? 'home' : 'projects');
   await page.emulateMedia({reducedMotion: 'reduce'});
   await page.waitForFunction(() => [...document.querySelectorAll('.pv img')].every(img => img.currentSrc.endsWith('.poster.webp')));
   check(await page.locator('.pv img').evaluateAll(imgs => imgs.every(img => img.currentSrc.endsWith('.poster.webp'))), route + ' reduced motion uses static posters');
   await page.emulateMedia({reducedMotion: 'no-preference'});
  }
  await page.getByRole('link', {name: '開啟 航程風浪 →', exact: true}).click(); await page.waitForURL('**/room/');
  check((await page.locator('body').innerText()).length > 40, 'voyage opens');
  await page.goBack(); await page.getByRole('heading', {name: '作品入口', exact: true}).waitFor(); check(true, 'back returns to works');
  await page.reload(); await page.getByRole('heading', {name: '作品入口', exact: true}).waitFor(); check(true, 'works reload');
  await page.locator('nav.top a[href="/"]').click(); await page.waitForURL(BASE + '/');
  check(await page.locator('.card').count() === 6 && await page.locator('.entry-header').count() === 0, 'site brand opens works homepage');
  await page.locator('nav.top a[href="/projects/"]').click(); await page.waitForURL('**/projects/'); check(true, 'homepage links to projects');
  await page.goto(BASE + '/404.html');
  check(await page.locator('html').getAttribute('lang') === 'zh-Hant' && (await page.locator('h1').innerText()).includes('找不到'), 'Chinese 404');
  await targets('a', '404 return link'); await noOverflow('404'); await screenshot('404');
  await page.getByRole('link', {name: '返回作品入口 →'}).click(); await page.waitForURL('**/projects/'); check(true, '404 links to projects');
  for (const gone of ['/apps/world/', '/apps/world-taiwan/', '/apps/ai-frontier/', '/apps/oracle/', '/apps/future/oracle/', '/posts/', '/tags/', '/categories/', '/archives/', '/index.xml', '/public/', '/world-impact/', '/taipei-mrt/']) {
   const r = await page.request.get(BASE + gone, {maxRedirects: 0}); check(r.status() === 404, 'retired URL returns 404 ' + gone);
  }
  if (label === 'desktop') {
   for (const file of deleted) {
    const r = await page.request.get(BASE + '/' + file, {maxRedirects: 0});
    check(r.status() === 404, 'reviewed deletion returns 404 ' + file);
   }
   for (const file of ['favicon.ico','favicon.svg','CNAME']) {
    const r = await page.request.get(BASE + '/' + file); check(r.status() === 200, 'preserved support file ' + file);
   }
  }
  requests.length = 0;
  await page.goto(BASE + '/apps/future/');
  await page.locator('#city-panel[data-ready="1"]').waitFor({timeout: 60000});
  await page.waitForFunction(() => window.__fc?.frames > 1);
  check(await page.title() === '時光之城' && await page.locator('[role="tab"],[role="tablist"],[role="tabpanel"],.work-tabs').count() === 0, 'standalone city without tab bar');
  check(!requests.some(u => /oracle|work-tabs|\/tabs\.js/.test(u)), 'city loads no retired resources');
  check(await page.locator('#scene').evaluate(el => el.getBoundingClientRect().top) === 0, 'city canvas starts at top without tab gap');
  await targets('#city-panel button,#city-panel select,#city-panel input,#city-panel .back,#city-panel .datalink', 'city controls');
  await page.locator('#slider').evaluate(el => {el.value = '2040'; el.dispatchEvent(new Event('input', {bubbles: true}));});
  check(await page.locator('#year').innerText() === '2040', 'city year slider');
  await page.locator('[data-mode="day"]').click(); check(await page.locator('[data-mode="day"]').getAttribute('aria-pressed') === 'true', 'city day mode');
  await page.locator('#milestone').selectOption('energy-fusion-grid'); await page.locator('#card').waitFor();
  check((await page.locator('#cardTitle').innerText()).includes('核融合'), 'milestone detail');
  await page.locator('#cardClose').click();
  await page.locator('#play').click(); check(await page.locator('#play').getAttribute('aria-pressed') === 'true', 'time travel starts');
  await page.locator('#play').click(); check(await page.locator('#play').getAttribute('aria-pressed') === 'false', 'time travel pauses');
  await noOverflow('city'); await screenshot('city');
  await page.locator('.datalink').click(); await page.waitForURL('**/apps/future/data.html');
  await page.waitForFunction(() => document.querySelector('#meta').textContent.includes('個里程碑'));
  check(true, 'city data page loads retained snapshot');
  await page.locator('a.back').click(); await page.locator('#city-panel[data-ready="1"]').waitFor({timeout: 60000}); check(true, 'data page returns to city');
  await page.goto(BASE + '/apps/future/#oracle'); await page.locator('#city-panel[data-ready="1"]').waitFor({timeout: 60000});
  check(await page.locator('[role="tab"],#oracle-panel').count() === 0, 'old fragment opens city with no oracle view');
  check(errors.length === 0, 'no JavaScript errors: ' + errors.join('; '));
  await page.close();
 }
 await browser.close(); browser = null; report('passed'); console.log(JSON.stringify({passed: results.length}));
})().catch(async e => {
 if (browser) await browser.close().catch(() => {});
 const blocked = /Operation not permitted|Permission denied/.test(e.message);
 const message = blocked ? 'Browser launch blocked by environment socket permissions: ' + e.message.split('\n').find(line => /Operation not permitted|Permission denied/.test(line)) : e.message.split('Call log:')[0].slice(0,2000);
 report(blocked ? 'blocked' : 'failed', [message]); console.error(message); process.exitCode = 1;
});
