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
  check(JSON.stringify(chips)===JSON.stringify(['台灣即時 2','AI 前沿與實驗 3','交通與旅行 3','美食 1','投資理財 3','工具與文章 2']),'six themes with counts');
  check(await page.locator('#live .card').count()===2&&await page.locator('#ai .card').count()===3&&await page.locator('#travel .card').count()===3&&await page.locator('#money .card').count()===3&&await page.locator('#old').count()===0,'card counts match themes; no retired section');
  check(await page.locator('.tags .ok').count()===12&&await page.locator('.tags .dev').count()===2&&await page.locator('.tags .old').count()===0,'status tags on every card');
  // 台股小鎮 is a LIFE COMPASS tab, not another deployment
  const town=page.locator('.card',{hasText:'台股小鎮'});
  check((await town.innerText()).includes('LIFE COMPASS 裡的分頁')&&(await town.innerText()).includes('成交金額影響人潮'),'stock town labelled as LIFE COMPASS tab');
  check(await town.locator('a').getAttribute('href')==='https://dashboard.shrimp-guard.us.ci/one-life/#town','stock town links to /one-life/#town');
  // test-data version moved to 開發中, formal card keeps only the formal entry
  check(await page.locator('#money .card',{hasText:'LIFE COMPASS'}).first().locator('a').count()===1,'formal LIFE card has one entry');
  check(await page.locator('.card',{hasText:'雲端測試版'}).count()===0&&await page.locator('.card',{hasText:'Technology Tycoon'}).count()===0,'test copy and undeployed works removed');
  check(!/\d+\/\d+ 通過/.test(await page.locator('main').innerText()),'no test pass counts on public cards');
  // Login labels distinguish dashboard accounts from the owner-only ChatGPT preview.
  const bad=await page.locator('.card').evaluateAll(cs=>cs.filter(c=>{const a=c.querySelector('.open a');if(!a)return false;const t=c.querySelector('.tags').textContent;if(a.href.includes('harbor-sixty-minute-game.windy-maple-0615.chatgpt.site'))return !t.includes('僅擁有者 ChatGPT 帳號')||t.includes('公開');return a.href.includes('dashboard.shrimp-guard.us.ci')?!t.includes('需要登入'):!t.includes('公開')}).map(c=>c.querySelector('.name').textContent));
  check(bad.length===0,'login labels match entry hosts');
  const harbor=page.locator('#ai .card',{hasText:'離港前60分鐘'});
  check(await page.locator('.card').count()===14,'14 total works');
  // moving previews (lazy, with a still poster for reduced motion); none for works that show personal data
  check(await page.locator('.card .pv img[loading=lazy]').count()===7,'seven lazy moving previews');
  check(await page.locator('.card',{hasText:'LIFE COMPASS'}).locator('.pv').count()===0&&await page.locator('.card',{hasText:'Fund Manager'}).locator('.pv').count()===0&&await page.locator('.card',{hasText:'VPS 狀態'}).locator('.pv').count()===0,'no previews of personal-data works');
  const pvImg=page.locator('.card',{hasText:'AI 前沿日報'}).locator('.pv img');await pvImg.scrollIntoViewIfNeeded();await page.waitForFunction(el=>el.complete&&el.naturalWidth>0,await pvImg.elementHandle());check(true,'preview image loads');
  for(const [n,u] of [['台灣鐵道','/apps/rail/'],['AI 前沿日報','/apps/ai-frontier/'],["God's Eye View 3D 地球",'/globe/'],['VPS 狀態','/apps/vps/'],['台灣此刻','/apps/taiwan/']]){const c=page.locator('.card',{hasText:n});check((await c.locator('a').getAttribute('href'))==='https://dashboard.shrimp-guard.us.ci'+u&&(await c.innerText()).includes('需要登入'),n+' card links to dashboard with login label');}
  check(await page.locator('.card',{hasText:'生存者'}).count()===0,'retired survivor card removed');
  check((await harbor.innerText()).includes('可玩測試版')&&(await harbor.innerText()).includes('僅限擁有者開啟'),'private playable preview clearly labelled');
  check((await harbor.locator('a').innerText()).trim()==='擁有者預覽 →','harbor owner-preview button text');
  check((await page.locator('.intro').innerText()).includes('僅擁有者 ChatGPT 帳號')&&(await page.locator('footer').innerText()).includes('僅擁有者 ChatGPT 帳號'),'header/footer explain owner-only preview');
  check(await harbor.locator('a').getAttribute('href')==='https://harbor-sixty-minute-game.windy-maple-0615.chatgpt.site','harbor preview exact destination');
  // placeholders removed; 小王國 has no button
  check(await page.locator('#ask').count()===0&&await page.locator('.card',{hasText:'實驗槽'}).count()===0&&await page.locator('.card',{hasText:'Studio 001'}).count()===0,'empty placeholders removed');
  check(await page.locator('.card',{hasText:'小王國'}).count()===0&&await page.locator('.card',{hasText:'世界與我'}).count()===0,'retired works removed from the entrance');
  // 舊版 collapsed by default and expandable



  // layout
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  const cols=await page.locator('#travel .grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
  check(cols===(width<600?1:2),'responsive columns');
  await page.screenshot({path:`verification/screenshots/projects-${label}.png`,fullPage:true});
  // navigation still works
  await page.getByRole('link',{name:'開啟 航程風浪 →',exact:true}).click();await page.waitForURL('**/room/');
  check((await page.locator('body').innerText()).length>40,'room opens');
  await page.goBack();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'browser back returns');
  await page.reload();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();check(true,'reload persists entry');
  await page.goto(BASE+'/world-impact/');await page.locator('.event-card').first().waitFor();check(await page.locator('.event-card').count()===3,'retained world page still loads (unlisted)');
  await page.goBack();await page.getByRole('heading',{name:'作品入口',exact:true}).waitFor();
  await page.getByRole('link',{name:'返回主站',exact:true}).first().click();await page.waitForURL(BASE+'/');await page.locator('.entry-header').first().waitFor();check(await page.locator('.entry-header').count()===2,'homepage articles preserved');
  await page.getByRole('link',{name:'作品入口',exact:true}).click();await page.waitForURL('**/projects/');check(true,'homepage entry navigates');
  check(errors.length===0,'no JavaScript errors');await page.close();
 }
 await browser.close();fs.writeFileSync('verification/browser-check.json',JSON.stringify({checks:results,count:results.length,browser:'installed Chromium via existing Playwright',viewports:['1440x1000','390x844','360x740'],base:BASE,errors:[]},null,2));console.log(JSON.stringify({passed:results.length}));
})().catch(e=>{console.error(e.message);process.exit(1)});
