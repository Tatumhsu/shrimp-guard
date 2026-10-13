const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');
const BASE=process.env.BASE_URL || 'http://127.0.0.1:8765';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
 const results=[];fs.mkdirSync('verification/screenshots',{recursive:true});
 for(const [label,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true],['mobile360',360,740,true]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/projects/');
  await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();
  const check=(value,name)=>{if(!value)throw Error(label+': '+name);results.push(label+': '+name)};
  // groups and counts
  const chips=await page.locator('nav.jump a').allInnerTexts();
  check(JSON.stringify(chips)===JSON.stringify(['可使用 9','開發中 4','舊版／暫停 6','待確認 3']),'four groups with counts');
  check(await page.locator('#ok .card').count()===9&&await page.locator('#dev .card').count()===4&&await page.locator('#old .card').count()===6&&await page.locator('#ask .card').count()===3,'card counts match groups');
  // 台股小鎮 is a LIFE COMPASS tab, not another deployment
  const town=page.locator('.card',{hasText:'台股小鎮'});
  check((await town.innerText()).includes('LIFE COMPASS 裡的分頁')&&(await town.innerText()).includes('成交金額影響人潮'),'stock town labelled as LIFE COMPASS tab');
  check(await town.locator('a').getAttribute('href')==='https://dashboard.shrimp-guard.us.ci/one-life/#town','stock town links to /one-life/#town');
  // test-data version moved to 開發中, formal card keeps only the formal entry
  check(await page.locator('#ok .card',{hasText:'LIFE COMPASS'}).first().locator('a').count()===1,'formal LIFE card has one entry');
  check((await page.locator('#dev .card',{hasText:'雲端測試版'}).innerText()).includes('測試資料'),'test version in 開發中 marked 測試資料');
  check(!/\d+\/\d+ 通過/.test(await page.locator('main').innerText()),'no test pass counts on public cards');
  // Login labels distinguish dashboard accounts from the owner-only ChatGPT preview.
  const bad=await page.locator('.card').evaluateAll(cs=>cs.filter(c=>{const a=c.querySelector('.open a');if(!a)return false;const t=c.querySelector('.tags').textContent;if(a.href.includes('harbor-sixty-minute-game.windy-maple-0615.chatgpt.site'))return !t.includes('僅擁有者 ChatGPT 帳號')||t.includes('公開');return a.href.includes('dashboard.shrimp-guard.us.ci')?!t.includes('需要登入'):!t.includes('公開')}).map(c=>c.querySelector('.name').textContent));
  check(bad.length===0,'login labels match entry hosts');
  const harbor=page.locator('#dev .card',{hasText:'離港前60分鐘'});
  check(await page.locator('.card').count()===22,'22 total works');
  check((await harbor.innerText()).includes('可玩測試版')&&(await harbor.innerText()).includes('僅限擁有者開啟'),'private playable preview clearly labelled');
  check((await harbor.locator('a').innerText()).trim()==='擁有者預覽 →','harbor owner-preview button text');
  check((await page.locator('.intro').innerText()).includes('僅擁有者 ChatGPT 帳號')&&(await page.locator('footer').innerText()).includes('僅擁有者 ChatGPT 帳號'),'header/footer explain owner-only preview');
  check(await harbor.locator('a').getAttribute('href')==='https://harbor-sixty-minute-game.windy-maple-0615.chatgpt.site','harbor preview exact destination');
  // pending items have no open button; 小王國 has no button
  check(await page.locator('#ask a').count()===0,'pending items have no open buttons');
  check(await page.locator('.card',{hasText:'小王國'}).locator('a').count()===0,'kingdom paused without entry');
  // 舊版 collapsed by default and expandable
  check(!(await page.locator('#old .card').first().isVisible()),'old versions collapsed by default');
  await page.locator('#old summary').click();check(await page.locator('#old .card').first().isVisible(),'old versions expand');
  await page.locator('#old summary').click();check(!(await page.locator('#old .card').first().isVisible()),'old versions collapse again');
  // layout
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  const cols=await page.locator('#ok .grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
  check(cols===(width<600?1:2),'responsive columns');
  await page.screenshot({path:`verification/screenshots/projects-${label}.png`,fullPage:true});
  // navigation still works
  await page.getByRole('link',{name:'開啟 航程風浪 →',exact:true}).click();await page.waitForURL('**/room/');
  check((await page.locator('body').innerText()).length>40,'room opens');
  await page.goBack();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'browser back returns');
  await page.reload();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'reload persists entry');
  await page.locator('#old summary').click();await page.getByRole('link',{name:'開啟 世界與我 →',exact:true}).click();await page.waitForURL('**/world-impact/');check(await page.locator('.event-card').count()===3,'retained world page loads');
  await page.goBack();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();
  await page.getByRole('link',{name:'返回主站',exact:true}).first().click();await page.waitForURL(BASE+'/');check(await page.locator('.entry-header').count()===2,'homepage articles preserved');
  await page.getByRole('link',{name:'作品入口',exact:true}).click();await page.waitForURL('**/projects/');check(true,'homepage entry navigates');
  check(errors.length===0,'no JavaScript errors');await page.close();
 }
 await browser.close();fs.writeFileSync('verification/browser-check.json',JSON.stringify({checks:results,count:results.length,browser:'installed Chromium via existing Playwright',viewports:['1440x1000','390x844','360x740'],base:BASE,errors:[]},null,2));console.log(JSON.stringify({passed:results.length}));
})().catch(e=>{console.error(e.message);process.exit(1)});
