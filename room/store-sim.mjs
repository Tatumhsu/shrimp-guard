export const SAVE_VERSION = 2;
export const SAVE_KEY = 'mini-mart-save';
export const RULES = Object.freeze({restockCost:15, restockCount:6, capacity:36, price:25,
  maxCustomers:4, visitorsPerDay:12, arrivalMs:6500, patienceMs:30000, dailyGrant:10});
const phases = ['enter','shop','queue','leave'];
const integer = (v,max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v>=0 && v<=max;
const clone = s => ({...s,customers:s.customers.map(c=>({...c}))});
const customer = id => ({id,phase:'enter',time:0,wait:0,paid:false});
export function freshState(){return {day:1,cash:120,stock:12,paused:false,sales:0,earned:0,spent:0,
  missed:0,arrivals:2,spawnIn:RULES.arrivalMs,nextId:3,customers:[customer(1),customer(2)]};}
function validated(raw){
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return null;
  const keys=['day','cash','stock','sales','earned','spent','missed','arrivals','spawnIn','nextId'];
  if(keys.some(k=>!integer(raw[k])) || raw.day<1 || raw.nextId<1 || typeof raw.paused!=='boolean')return null;
  if(raw.stock>RULES.capacity || raw.arrivals>RULES.visitorsPerDay || raw.spawnIn>RULES.arrivalMs || raw.sales>raw.arrivals || raw.missed>raw.arrivals || raw.earned!==raw.sales*RULES.price)return null;
  if(!Array.isArray(raw.customers)||raw.customers.length>RULES.maxCustomers)return null;
  const ids=new Set(),customers=[];
  for(const c of raw.customers){
    if(!c||!integer(c.id)||c.id<1||c.id>=raw.nextId||ids.has(c.id)||!phases.includes(c.phase)||!integer(c.time,30000)||!integer(c.wait,RULES.patienceMs)||typeof c.paid!=='boolean'||(c.paid&&c.phase!=='leave'))return null;
    ids.add(c.id);customers.push({id:c.id,phase:c.phase,time:c.time,wait:c.wait,paid:c.paid});
  }
  if(customers.length>raw.arrivals)return null;
  return {...Object.fromEntries(keys.map(k=>[k,raw[k]])),paused:raw.paused,customers};
}
export function createStore(initial){
  let state=validated(initial) || freshState();
  const getState=()=>({...clone(state),queue:state.customers.filter(c=>c.phase==='queue').length});
  const result=(ok,code,message,extra={})=>({ok,code,message,state:getState(),...extra});
  const blocked=()=>state.paused ? result(false,'PAUSED','營業已暫停') : null;
  const spawn=()=>{state.customers.push(customer(state.nextId++));state.arrivals++;};
  return {getState,
    tick(ms){
      if(state.paused)return result(false,'PAUSED','營業已暫停');
      if(!integer(ms,1000))return result(false,'INVALID_TICK','無效時間');
      const events=[];
      for(const c of state.customers){
        c.time+=ms;
        if(c.phase==='enter'&&c.time>=1400){c.phase='shop';c.time=0;}
        else if(c.phase==='shop'&&c.time>=1800){c.phase='queue';c.time=0;events.push('queued');}
        else if(c.phase==='queue'){c.wait+=ms;if(c.wait>=RULES.patienceMs){c.wait=RULES.patienceMs;c.phase='leave';c.time=0;state.missed++;events.push('impatient');}}
      }
      state.customers=state.customers.filter(c=>!(c.phase==='leave'&&c.time>=1800));
      state.spawnIn=Math.max(0,state.spawnIn-ms);
      if(!state.spawnIn&&state.arrivals<RULES.visitorsPerDay&&state.customers.length<RULES.maxCustomers&&state.nextId<Number.MAX_SAFE_INTEGER){spawn();state.spawnIn=RULES.arrivalMs;events.push('arrived');}
      return result(true,'TICK','', {events});
    },
    togglePause(){state.paused=!state.paused;return result(true,state.paused?'PAUSED':'RESUMED',state.paused?'營業暫停，顧客也會等你':'恢復營業');},
    restock(){
      const b=blocked();if(b)return b;
      if(state.cash<RULES.restockCost)return result(false,'INSUFFICIENT_CASH','現金不足 15 元，請先為顧客結帳');
      if(state.stock+RULES.restockCount>RULES.capacity)return result(false,'SHELF_FULL','貨架最多 36 件，賣掉一些再補貨');
      if(!integer(state.spent+RULES.restockCost))return result(false,'LIMIT','帳目已達上限');
      state.cash-=RULES.restockCost;state.spent+=RULES.restockCost;state.stock+=RULES.restockCount;
      return result(true,'RESTOCKED','補貨 +6 · 支出 15 元');
    },
    checkout(){
      const b=blocked();if(b)return b;
      const waiting=state.customers.filter(c=>c.phase==='queue');
      if(!waiting.length)return result(false,'NO_QUEUE','顧客正在選購，稍等一下');
      if(!state.stock)return result(false,'OUT_OF_STOCK','缺貨了！顧客仍在等，請先補貨');
      const count=Math.min(waiting.length,state.stock),income=count*RULES.price;
      if(!integer(state.cash+income)||!integer(state.earned+income))return result(false,'LIMIT','帳目已達上限');
      for(const c of waiting.slice(0,count)){c.phase='leave';c.time=0;c.paid=true;}
      state.stock-=count;state.cash+=income;state.sales+=count;state.earned+=income;
      return result(true,'CHECKOUT',`售出 ${count} 件 · 收入 +${income} 元`,{count,income});
    },
    endDay(){
      const b=blocked();if(b)return b;
      if(!integer(state.day+1)||!integer(state.cash+RULES.dailyGrant))return result(false,'LIMIT','帳目已達上限');
      const summary={day:state.day,sales:state.sales,earned:state.earned,spent:state.spent,
        profit:state.earned-state.spent,missed:state.missed+state.customers.filter(c=>c.phase!=='leave').length};
      state={...freshState(),day:state.day+1,cash:state.cash+RULES.dailyGrant,stock:Math.max(4,state.stock)};
      return result(true,'DAY_ENDED',`第 ${summary.day} 天結算：售出 ${summary.sales} 件，收入 ${summary.earned}，補貨 ${summary.spent}。開店補助 +10 元。`,{summary});
    },
    save(adapter,key=SAVE_KEY){try{adapter.setItem(key,JSON.stringify({version:SAVE_VERSION,state:clone(state)}));return result(true,'SAVED','進度已儲存在此裝置');}catch{return result(false,'SAVE_FAILED','無法儲存：目前進度只保留在本頁');}},
    load(adapter,key=SAVE_KEY){
      let raw;try{raw=adapter.getItem(key);}catch{return result(false,'LOAD_FAILED','無法讀取存檔：目前只在本頁遊玩');}
      if(raw==null){state=freshState();return result(true,'NEW_GAME','歡迎開店');}
      try{const data=JSON.parse(raw),candidate=data.version===SAVE_VERSION?validated(data.state):null;
        if(!candidate)throw Error('invalid');state=candidate;return result(true,'LOADED','已讀取進度');
      }catch{state=freshState();return result(false,'LOAD_FALLBACK','存檔格式不符或損毀，已安全開始新遊戲');}
    },
    reset(adapter,key=SAVE_KEY){try{adapter.removeItem(key);}catch{return result(false,'RESET_FAILED','無法清除裝置存檔，原有進度仍保留');}state=freshState();return result(true,'RESET','已重新開始');}
  };
}
