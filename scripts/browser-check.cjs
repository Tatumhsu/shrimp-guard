const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');
const BASE=process.env.BASE_URL || 'http://127.0.0.1:8765';
const viewports=[['desktop',1440,1000,false],['mobile',390,844,true],['mobile360',360,740,true]];
const results=[],screenshots=[];
let browser;
function report(status,errors=[]){
 fs.writeFileSync('verification/browser-check.json',JSON.stringify({status,checks:results,count:results.length,
  browser:'Chromium via Playwright',viewports:viewports.map(([,w,h])=>`${w}x${h}`),base:BASE,screenshots,errors},null,2)+'\n');
}
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
 fs.mkdirSync('verification/screenshots',{recursive:true});
 for(const [label,width,height,mobile] of viewports){
  const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  const check=(value,name)=>{if(!value)throw Error(label+': '+name);results.push(label+': '+name)};
  const screenshot=async name=>{const path=`verification/screenshots/merge-${name}-${label}.png`;await page.screenshot({path,fullPage:name!=='city'});screenshots.push(path)};
  const noOverflow=async name=>check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' no horizontal overflow');
  const targets=async(selector,name)=>check(await page.locator(selector).evaluateAll(elements=>elements.filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44})),name+' targets at least 44 px');
  const tabs=async()=>{
   await targets('.work-tabs a','top tabs');await noOverflow('merged work');
   check(await page.locator('.work-tabs').evaluate(e=>getComputedStyle(e).position)==='sticky','top tabs use sticky positioning');
   await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
   check(await page.locator('.work-tabs').evaluate(e=>Math.abs(e.getBoundingClientRect().top)<1),'tabs stay at viewport top after scroll');
   await page.evaluate(()=>window.scrollTo(0,0));
  };
  await page.goto(BASE+'/projects/');
  await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();
  check(JSON.stringify(await page.locator('nav.jump a').allInnerTexts())===JSON.stringify(['看世界 4','AI 作品 3','遊戲與故事 1','文章 1']),'four themes with merged counts');
  check(await page.locator('#live .card').count()===4&&await page.locator('#ai .card').count()===3&&await page.locator('#game .card').count()===1&&await page.locator('#tools .card').count()===1,'nine cards in themes');
  check(await page.locator('.card.sub').count()===0,'no separate sub cards');
  check(await page.locator('.tags .ok').count()===8&&await page.locator('.tags .dev').count()===1,'status tags on every card');
  check(!/離港前60分鐘|僅擁有者|需要登入|\d+\/\d+ 通過/.test(await page.locator('main').innerText()),'retired owner-only work and testing labels absent');
  check(await page.locator('a[href*="dashboard.shrimp-guard.us.ci"],a[href*="harbor-sixty-minute-game"],a[href="/apps/oracle/"],a[href="/apps/world-taiwan/"]').count()===0,'no retired project destinations');
  const expectedLinks=[
   ['全球關注','全球關注','/apps/world/'],['時光之城＋每日預言','時光之城＋每日預言','/apps/future/'],['光影台灣','光影台灣','/apps/relief/'],['此刻台灣的聲音','此刻台灣的聲音','/apps/sound/'],
   ['AI 前沿日報','AI 前沿日報','/apps/ai-frontier/'],['瀏覽器 AI 實驗室','瀏覽器 AI 實驗室','/apps/ailab/'],
   ['Emergence World','Emergence World','https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/'],
   ['航程風浪','航程風浪','/room/'],['航程風浪','沖繩上岸','/room/#landing'],['Shrimp Guard 部落格','Shrimp Guard 部落格','/']
  ];
  check(JSON.stringify(await page.locator('.open a').evaluateAll(as=>as.map(a=>a.getAttribute('href'))))===JSON.stringify(expectedLinks.map(([, ,u])=>u)),'ten public work links in order');
  for(const [cardName,linkName,url] of expectedLinks){
   const card=page.locator('.card').filter({has:page.getByRole('heading',{name:cardName,exact:true})});
   check(await card.getByRole('link',{name:new RegExp(linkName)}).getAttribute('href')===url,linkName+' destination');
   check((await card.locator('.tags').innerText()).includes('公開'),linkName+' access label');
  }
  check((await page.locator('#game .card').innerText()).includes('沖繩上岸分頁'),'Okinawa link belongs to voyage card');
  check((await page.locator('#live .card',{hasText:'全球關注'}).innerText()).includes('台灣影響 10/18'),'world card describes both dated snapshots');
  check((await page.locator('#live .card',{hasText:'時光之城'}).innerText()).includes('每日預言 10/17'),'future card describes both dated snapshots');
  check((await page.locator('footer').innerText()).includes('2026-10-23'),'checked date updated');
  check(await page.locator('.card .pv img[loading=lazy]').count()===6,'six retained lazy previews');
  for(const img of await page.locator('.pv img').all()){
   await img.scrollIntoViewIfNeeded();await page.waitForFunction(el=>el.complete&&el.naturalWidth>0,await img.elementHandle());
  }
  check(true,'all project previews load');
  await noOverflow('projects');await targets('.open a,nav.jump a','project links');
  check(await page.locator('#live .grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)===(width<600?1:2),'responsive project columns');
  await screenshot('projects');
  await page.getByRole('link',{name:'開啟 航程風浪 →',exact:true}).click();await page.waitForURL('**/room/');
  check((await page.locator('body').innerText()).length>40,'room opens');
  await page.goBack();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'browser back returns to projects');
  await page.reload();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'projects reload');
  for(const gone of ['/world-impact/','/taipei-mrt/']){const r=await page.goto(BASE+gone);check(r.status()===404,'previously retired page stays gone '+gone)}
  await page.goto(BASE+'/projects/');
  await page.getByRole('link',{name:'返回主站',exact:true}).click();await page.locator('.entry-header').first().waitFor();
  check(await page.locator('.entry-header').count()===2,'homepage articles preserved');
  await page.getByRole('link',{name:'作品入口',exact:true}).click();await page.waitForURL('**/projects/');check(true,'homepage entry navigates');

  requests.length=0;
  await page.goto(BASE+'/apps/future/');
  await page.locator('#city-panel[data-ready="1"]').waitFor({timeout:60000});
  check(!requests.some(u=>/\/oracle\/(app\.js|data\/)/.test(u)),'oracle module and data not loaded on city tab');
  await targets('#city-panel button,#city-panel select,#city-panel input,#city-panel .back,#city-panel .datalink','city controls');
  await page.locator('#slider').evaluate(el=>{el.value='2040';el.dispatchEvent(new Event('input',{bubbles:true}))});
  check(await page.locator('#year').innerText()==='2040','city year slider still works');
  await page.locator('[data-mode="day"]').click();check(await page.locator('[data-mode="day"]').getAttribute('aria-pressed')==='true','city day mode works');
  await page.locator('#milestone').selectOption('energy-fusion-grid');await page.locator('#card').waitFor();
  check((await page.locator('#cardTitle').innerText()).includes('核融合'),'milestone selector opens original city detail');
  await page.locator('#cardClose').click();await tabs();await screenshot('city');
  await page.getByRole('tab',{name:'每日預言',exact:true}).click();
  await page.locator('#oracle-panel[data-ready="1"]').waitFor();
  check(new URL(page.url()).hash==='#oracle'&&await page.locator('#city-panel').isHidden(),'oracle tab sets deep link');
  check(await page.locator('#oracle-cards .card').count()===15&&await page.locator('#oracle-board-table tbody tr').count()===4,'oracle predictions and board render');
  check(await page.locator('#oracle-cards .card').first().evaluate(e=>getComputedStyle(e).position)==='static','oracle cards do not inherit city fixed modal CSS');
  const frame=await page.evaluate(()=>window.__fc.frames);
  await page.waitForTimeout(150);
  check(await page.evaluate(()=>window.__fc.frames)===frame,'hidden city rendering pauses');
  await page.locator('#oracle-filters').getByRole('button',{name:'天氣',exact:true}).click();
  check(await page.locator('#oracle-cards .card:visible').count()===6,'oracle weather filter');
  await targets('#oracle-filters button','oracle filters');await tabs();await screenshot('oracle');
  const oracleRequests=requests.filter(u=>/\/oracle\/data\//.test(u)).length;
  await page.getByRole('tab',{name:'未來城市',exact:true}).click();
  await page.waitForFunction(n=>window.__fc.frames>n,frame);
  check(true,'city rendering resumes');
  await page.getByRole('tab',{name:'每日預言',exact:true}).click();
  check(requests.filter(u=>/\/oracle\/data\//.test(u)).length===oracleRequests&&await page.locator('#oracle-cards .card:visible').count()===6,'oracle state preserved without repeated fetch');
  await page.goBack();await page.locator('#city-panel').waitFor();check(true,'tab browser back');
  await page.goForward();await page.locator('#oracle-panel').waitFor();check(true,'tab browser forward');
  requests.length=0;
  await page.reload();await page.locator('#oracle-panel[data-ready="1"]').waitFor();
  check(!requests.some(u=>/\/city\.js|\/vendor\/three\//.test(u)),'oracle deep-link reload skips Three.js');
  await page.getByRole('tab',{name:'每日預言',exact:true}).focus();await page.keyboard.press('Home');await page.locator('#city-panel[data-ready="1"]').waitFor({timeout:60000});
  check(await page.locator('#tab-city').evaluate(e=>e===document.activeElement),'keyboard Home activates and focuses first tab');
  await page.keyboard.press('End');await page.locator('#oracle-panel').waitFor();check(true,'keyboard End activates second tab');

  requests.length=0;
  await page.goto(BASE+'/apps/world/');await page.locator('#world-panel[data-ready="1"]').waitFor();
  check(!requests.some(u=>/\/taiwan\/(app\.js|data\/|assets\/)/.test(u)),'Taiwan app data and map image stay lazy');
  check(await page.locator('#map .leaflet-overlay-pane path').count()>100,'world map countries render');
  await page.locator('#langs [data-l="ja"]').click();
  const region=await page.locator('#region').innerText();
  check(region.includes('日文維基百科'),'world language control works');
  await targets('#langs button,#day,.leaflet-control-zoom a','world controls');await tabs();await screenshot('world');
  await page.getByRole('tab',{name:'對台灣的影響',exact:true}).click();await page.locator('#taiwan-panel[data-ready="1"]').waitFor();
  check(await page.locator('#taiwan-cards .card').count()===8,'Taiwan news renders');
  await page.locator('#taiwan-panel [data-tab="industry"]').click();
  check(new URL(page.url()).hash==='#taiwan'&&await page.locator('#taiwan-cards .card').count()===3,'category filter keeps Taiwan work hash');
  await page.locator('#taiwan-overlay [data-r="japankorea"]').focus();await page.keyboard.press('Enter');
  check(await page.locator('#taiwan-cards .card').count()===2,'Taiwan region keyboard filter works');
  await page.locator('#taiwan-clearRegion').click();
  check(await page.locator('#taiwan-cards .card').count()===3,'Taiwan clear region works');
  await targets('#taiwan-panel .tabs button,#taiwan-panel .chip','Taiwan filters');await tabs();await screenshot('taiwan');
  await page.getByRole('tab',{name:'全球關注',exact:true}).click();
  check(await page.locator('#region').innerText()===region&&await page.locator('#map .leaflet-overlay-pane path').count()>100,'world map and selection survive tab switch');
  await page.getByRole('tab',{name:'對台灣的影響',exact:true}).click();
  check(await page.locator('#taiwan-cards .card').count()===3,'Taiwan filter survives tab switch');
  requests.length=0;await page.reload();await page.locator('#taiwan-panel[data-ready="1"]').waitFor();
  check(!requests.some(u=>/\/vendor\/(leaflet\.js|topojson-client)|\/world\/data\//.test(u)),'Taiwan deep-link reload skips world map initialization');
  await noOverflow('Taiwan after reload');
  for(const [old,target,hash,panel] of [['oracle','future','oracle','oracle'],['world-taiwan','world','taiwan','taiwan']]){
   await page.goto(BASE+'/apps/'+old+'/');await page.waitForURL(BASE+'/apps/'+target+'/#'+hash);
   await page.locator(`#${panel}-panel[data-ready="1"]`).waitFor();check(true,old+' static redirect opens merged tab');
  }
  check(errors.length===0,'no JavaScript errors: '+errors.join('; '));await page.close();
 }
 await browser.close();browser=null;report('passed');console.log(JSON.stringify({passed:results.length}));
})().catch(async e=>{
 if(browser)await browser.close().catch(()=>{});
 const blocked=/Operation not permitted|Permission denied/.test(e.message);
 const message=blocked ? 'Browser launch blocked by environment socket permissions: '+e.message.split('\n').find(line=>/Operation not permitted|Permission denied/.test(line)) : e.message.split('Call log:')[0].slice(0,2000);
 report(blocked?'blocked':'failed',[message]);
 console.error(message);process.exitCode=1;
});
