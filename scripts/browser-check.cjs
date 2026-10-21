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
  const chips=await page.locator('nav.jump a').allInnerTexts();
  check(JSON.stringify(chips)===JSON.stringify(['看世界 5','AI 作品 4','遊戲與故事 3','文章 1']),'four themes with counts');
  check(await page.locator('#live .card').count()===5&&await page.locator('#ai .card').count()===4&&await page.locator('#game .card').count()===3&&await page.locator('#tools .card').count()===1,'card counts match themes');
  check(await page.locator('.card:not(.sub)').count()===12&&await page.locator('.card.sub').count()===1,'12 works plus one sub card');
  check(await page.locator('.tags .ok').count()===11&&await page.locator('.tags .dev').count()===2,'status tags on every card');
  check(await page.locator('a[href*="dashboard.shrimp-guard.us.ci"]').count()===0,'no dashboard links');
  check(!/需要登入|\d+\/\d+ 通過/.test(await page.locator('main').innerText()),'no dashboard login or test pass status');
  const expectedLinks=[
   ['全球關注','/apps/world/'],['時光之城','/apps/future/'],['世界大事對台灣','/apps/world-taiwan/'],['光影台灣','/apps/relief/'],['此刻台灣的聲音','/apps/sound/'],
   ['AI 前沿日報','/apps/ai-frontier/'],['AI 預言家','/apps/oracle/'],['瀏覽器 AI 實驗室','/apps/ailab/'],
   ['Emergence World','https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/'],
   ['航程風浪','/room/'],['沖繩上岸','/room/#landing'],['離港前60分鐘','https://harbor-sixty-minute-game.windy-maple-0615.chatgpt.site'],['Shrimp Guard 部落格','/']
  ];
  check(JSON.stringify(await page.locator('.open a').evaluateAll(as=>as.map(a=>a.getAttribute('href'))))===JSON.stringify(expectedLinks.map(([,u])=>u)),'exact public work links in order');
  for(const [name,url] of expectedLinks){
   const card=page.locator('.card').filter({has:page.getByRole('heading',{name:new RegExp('^'+name)})});
   check(await card.locator('a').getAttribute('href')===url,name+' destination');
   check((await card.locator('.tags').innerText()).includes(name==='離港前60分鐘'?'僅擁有者 ChatGPT 帳號':'公開'),name+' access label');
  }
  const landing=page.locator('.card.sub');
  check((await landing.innerText()).includes('航程風浪裡的分頁'),'Okinawa labelled as room tab');
  check((await page.locator('#live .card',{hasText:'全球關注'}).innerText()).includes('公開版・內容到 10/16'),'world snapshot status');
  check((await page.locator('#live .card',{hasText:'時光之城'}).innerText()).includes('公開版・預測到 10/19'),'future snapshot status');
  const harbor=page.locator('#game .card',{hasText:'離港前60分鐘'});
  check((await harbor.innerText()).includes('可玩測試版')&&(await harbor.innerText()).includes('僅限擁有者開啟'),'owner preview clearly labelled');
  check((await harbor.locator('a').innerText()).trim()==='擁有者預覽 →','harbor owner-preview button text');
  check((await page.locator('.intro').innerText()).includes('免登入')&&(await page.locator('.intro').innerText()).includes('僅擁有者 ChatGPT 帳號')&&(await page.locator('footer').innerText()).includes('僅擁有者 ChatGPT 帳號'),'public intro explains owner-preview exception');
  check(await page.locator('.card .pv img[loading=lazy]').count()===7,'seven lazy previews');
  const pvImg=page.locator('.card',{hasText:'AI 前沿日報'}).locator('.pv img');await pvImg.scrollIntoViewIfNeeded();await page.waitForFunction(el=>el.complete&&el.naturalWidth>0,await pvImg.elementHandle());check(true,'preview image loads');
  // layout
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  const cols=await page.locator('#game .grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
  check(cols===(width<600?1:2),'responsive columns');
  await page.screenshot({path:`verification/screenshots/projects-${label}.png`,fullPage:true});
  // navigation still works
  await page.getByRole('link',{name:'開啟 航程風浪 →',exact:true}).click();await page.waitForURL('**/room/');
  check((await page.locator('body').innerText()).length>40,'room opens');
  await page.goBack();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'browser back returns');
  await page.reload();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'reload persists entry');
  for(const gone of ['/world-impact/','/taipei-mrt/']){const r=await page.goto(BASE+gone);check(r.status()===404,'retired page gone '+gone);}
  await page.goBack();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();
  await page.getByRole('link',{name:'返回主站',exact:true}).first().click();await page.waitForURL(BASE+'/');await page.locator('.entry-header').first().waitFor();check(await page.locator('.entry-header').count()===2,'homepage articles preserved');
  await page.getByRole('link',{name:'作品入口',exact:true}).click();await page.waitForURL('**/projects/');check(true,'homepage entry navigates');
  check(errors.length===0,'no JavaScript errors');await page.close();
 }
 await browser.close();fs.writeFileSync('verification/browser-check.json',JSON.stringify({checks:results,count:results.length,browser:'installed Chromium via existing Playwright',viewports:['1440x1000','390x844','360x740'],base:BASE,errors:[]},null,2));console.log(JSON.stringify({passed:results.length}));
})().catch(e=>{console.error(e.message);process.exit(1)});
