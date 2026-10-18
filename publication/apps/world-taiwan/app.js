/* 世界大事對台灣 — renders data/news.json */
(function(){
  "use strict";
  const LON0=-130,LON1=165,LAT0=-42,LAT1=72,W=1000,H=390;
  const proj=(lon,lat)=>{return[(lon-LON0)/(LON1-LON0)*W,(LAT1-lat)/(LAT1-LAT0)*H]};
  const REG={
    us:{name:"美國",lon:-98,lat:39},europe:{name:"歐洲",lon:8,lat:50},russia:{name:"俄羅斯",lon:62,lat:58},
    mideast:{name:"中東",lon:47,lat:28},china:{name:"中國",lon:106,lat:34},japankorea:{name:"日韓",lon:137,lat:38},
    other:{name:"其他地區",lon:20,lat:0}
  };
  const TW=proj(121,23.7);
  const TAB={geo:"地緣政治",econ:"經濟影響",industry:"產業衝擊"};
  const ICON={
    oil:'<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
    fx:'<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    chip:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    price:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l3 12h11l2-8H6"/>',
    tariff:'<path d="M3 7h18v13H3zM3 7l3-4h12l3 4M9 12h6"/>',
    war:'<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
    policy:'<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-7 10 7z"/>',
    trade:'<path d="M3 17l6-6 4 4 8-8M21 7v6M21 7h-6"/>'
  };
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt=iso=>{const d=new Date(iso);return d.toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})};
  let DATA=null,tab="all",region=null;

  function drawMap(items){
    const svg=$("#overlay");const counts={};const z=Math.min(2.3,Math.max(1,700/(svg.clientWidth||1000)));
    items.forEach(it=>{const r=REG[it.region]?it.region:"other";counts[r]=(counts[r]||0)+1});
    let s='<defs><radialGradient id="twg"><stop offset="0" stop-color="#38d6ff" stop-opacity=".7"/><stop offset="1" stop-color="#38d6ff" stop-opacity="0"/></radialGradient></defs>';
    for(const k of Object.keys(counts)){
      const [x,y]=proj(REG[k].lon,REG[k].lat);const mx=(x+TW[0])/2,my=Math.min(y,TW[1])-60-Math.abs(x-TW[0])*.12;
      s+=`<path class="arc" d="M${x},${y} Q${mx},${my} ${TW[0]},${TW[1]}" stroke="var(--${k})"/>`;
    }
    s+=`<circle cx="${TW[0]}" cy="${TW[1]}" r="${34*z}" fill="url(#twg)"/><circle cx="${TW[0]}" cy="${TW[1]}" r="${6*z}" fill="var(--tw)"/>`;
    s+=`<text class="tw-label" x="${TW[0]+10*z}" y="${TW[1]+30*z}" font-size="${24*z}">台灣</text>`;
    for(const [k,n] of Object.entries(counts)){
      const [x,y]=proj(REG[k].lon,REG[k].lat);const dim=region&&region!==k?" dim":"";
      s+=`<g class="pin${dim}" tabindex="0" role="button" data-r="${k}" aria-label="${REG[k].name}，${n} 則新聞">
        <circle class="halo" cx="${x}" cy="${y}" r="${22*z}" fill="var(--${k})"/><circle class="dot" cx="${x}" cy="${y}" r="${13*z}" fill="var(--${k})"/>
        <text class="n" x="${x}" y="${y+4.5*z}" text-anchor="middle" font-size="${13*z}">${n}</text>
        <text x="${x}" y="${y-22*z}" text-anchor="middle" font-size="${17*z}">${REG[k].name}</text></g>`;
    }
    svg.innerHTML=s;
    svg.querySelectorAll(".pin").forEach(g=>{
      const go=()=>{region=region===g.dataset.r?null:g.dataset.r;render()};
      g.addEventListener("click",go);g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}});
    });
  }

  function card(it){
    const r=REG[it.region]?it.region:"other";
    const li=s=>`<li><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.source)}</a>・${fmt(s.published)}・${esc(s.title)}</li>`;const all=it.sources||[];
    const srcs=all.slice(0,3).map(li).join("")+(all.length>3?`<li><details><summary>還有 ${all.length-3} 則來源</summary><ul class="srcs">${all.slice(3).map(li).join("")}</ul></details></li>`:"");
    const impact=it.impact?`<div class="impact"><b>對台灣影響</b><p>${esc(it.impact)}</p></div>`:"";
    return `<article class="card">
      <div class="ico" style="background:color-mix(in srgb,var(--${r}) 18%,transparent);color:var(--${r})"><svg viewBox="0 0 24 24">${ICON[it.icon]||ICON.policy}</svg></div>
      <h3>${esc(it.headline)}</h3>
      <div class="meta"><span class="rtag" style="color:var(--${r})">${REG[r].name}</span><span>${TAB[it.tab]||""}</span><span>${fmt(it.published)}</span></div>
      ${it.summary?`<p class="sum">${esc(it.summary)}</p>`:""}${impact}
      ${(it.tags||[]).length?`<div class="tags">${it.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`:""}
      <ul class="srcs">${srcs}</ul></article>`;
  }

  function render(){
    document.querySelectorAll(".tabs a").forEach(a=>a.setAttribute("aria-selected",a.dataset.tab===tab?"true":"false"));
    const byTab=DATA.world.filter(it=>tab==="all"||it.tab===tab);
    drawMap(byTab);
    const list=byTab.filter(it=>!region||(REG[it.region]?it.region:"other")===region);
    $("#clearRegion").hidden=!region;
    $("#count").textContent=(region?REG[region].name+"・":"")+`${list.length} 則`;
    $("#cards").innerHTML=list.length?list.map(card).join(""):'<p class="empty">這個分類今天沒有挑到新聞</p>';
  }

  function renderStatic(){
    const d=DATA;
    $("#stamp").innerHTML=`更新：${esc(fmt(d.generated_at))}（台北時間）<br>新聞範圍：過去 ${d.hours} 小時`;
    $("#tw3").innerHTML=d.taiwan3.length?d.taiwan3.map((t,i)=>{const s=(t.sources||[])[0]||{};
      return `<div class="twc"><div class="no">0${i+1}</div><h3>${esc(t.headline)}</h3>${t.summary?`<p>${esc(t.summary)}</p>`:""}
      <ul class="srcs">${(t.sources||[]).map(s=>`<li><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.source)}</a>・${fmt(s.published)}</li>`).join("")}</ul></div>`}).join(""):'<p class="empty">還沒有資料</p>';
    $("#rawCount").textContent=d.raw.length;
    $("#raw").innerHTML=d.raw.map(r=>`<li><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span>${esc(r.source)}・${fmt(r.published)}</span></li>`).join("");
    const names=[...new Set(d.feeds.filter(f=>f.ok&&f.count).map(f=>f.label.replace(/：.*/,"").replace(/ .*/,"")))];
    $("#srcLine").textContent=`資料來源：${names.join("、")} 公開 RSS・說明撰寫：${d.writer==="claude"?"Claude":d.writer||"（未產生）"}`;
    if(!d.world.length) $("#cards").innerHTML='<p class="empty">今天的影響說明還沒產生，可先看下方原始新聞</p>';
  }

  function setTab(){const h=location.hash.slice(1);tab=["all","geo","econ","industry"].includes(h)?h:"all";region=null;render()}
  $("#clearRegion").addEventListener("click",()=>{region=null;render()});
  fetch("data/news.json",{cache:"no-store"}).then(r=>r.json()).then(d=>{DATA=d;renderStatic();window.addEventListener("hashchange",setTab);let t;window.addEventListener("resize",()=>{clearTimeout(t);t=setTimeout(render,200)});setTab()})
    .catch(()=>{$("#stamp").textContent="資料讀取失敗";});
})();
