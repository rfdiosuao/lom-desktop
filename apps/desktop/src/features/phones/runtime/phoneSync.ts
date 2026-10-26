import { syncPhoneSchedules, resolvePendingPhoneRuns } from './phoneSchedules';
import { loadPhoneCache } from './phoneCache';
import { S, update } from '@/state/store';
import { syncPhoneHistory, watchPhone } from './phoneChat';
import { syncPhoneDocuments } from './phoneDocuments';

interface Slot { quick:number; full:number; retry:number; attempts:number; error:string; }
const slots=new Map<string,Slot>(), busy=new Set<string>();
let account:string|undefined, selected='';
const slot=(id:string)=>{let s=slots.get(id);if(!s){s={quick:0,full:0,retry:0,attempts:0,error:''};slots.set(id,s);}return s;};
export const phoneSyncError=(id:string)=>slots.get(id)?.error || '';
const online=(id:string)=>S.cloud==='signed-in'&&!!S.agents[id]?.real&&S.agents[id].status==='online';
function prepare() {
  const next=S.cloud==='signed-in'?S.account?.id:undefined;
  if(account!==next){account=next;slots.clear();selected='';}
  try{loadPhoneCache();}catch(e){slot(S.phoneId).error=e instanceof Error?e.message:'本地缓存读取失败';}
  if(selected!==S.phoneId){selected=S.phoneId;const s=slot(selected);s.quick=0;s.full=0;}
  for(const id of slots.keys())if(!S.agents[id]?.real&&!busy.has(`${account}:${id}`))slots.delete(id);
}
async function syncDevice(id:string,force=false) {
  const key=`${account}:${id}`, owner=account;
  if(!owner||!online(id)||busy.has(key)||busy.size>=2)return;
  const s=slot(id);if(!force&&(!S.prefs.reconnect&&s.attempts>0||s.retry>Date.now()))return;
  busy.add(key);s.quick=Date.now();
  try {
    const full=force||!s.full||Date.now()-s.full>=(document.hidden?300_000:60_000);
    const changed=await syncPhoneHistory(id,!full);
    if(full){await syncPhoneDocuments(id);await syncPhoneSchedules(id);await resolvePendingPhoneRuns(id);s.full=Date.now();}
    s.attempts=0;s.retry=0;s.error='';
    if(account===owner){const c=S.convs.find(c=>c.id===S.activeConv&&c.phoneSession&&c.owner===id);if(c&&(changed||full))void watchPhone(c);}
  }catch(e){s.error=e instanceof Error?e.message:'同步失败';s.attempts++;s.retry=Date.now()+Math.min(300_000,15_000*2**Math.min(s.attempts-1,5));}
  finally{busy.delete(key);update();}
}
/** All online phones get a fair turn. Selected:15s; others:60s; hidden:120s. Two in flight at most. */
export async function tickPhoneSync() {
  prepare();if(!account)return;
  const now=Date.now();
  const due=S.phoneOrder.filter(id=>{
    const s=slot(id),interval=document.hidden?120_000:id===S.phoneId?15_000:60_000;
    return online(id)&&(!!S.prefs.reconnect||s.attempts===0)&&!busy.has(`${account}:${id}`)&&now>=s.retry&&(!s.quick||now-s.quick>=interval);
  }).sort((a,b)=>Number(b===S.phoneId)-Number(a===S.phoneId)||slot(a).quick-slot(b).quick);
  await Promise.all(due.slice(0,Math.max(0,2-busy.size)).map(id=>syncDevice(id)));
}
export async function syncActivePhone(force=false){prepare();await syncDevice(S.phoneId,force);}
let timer:ReturnType<typeof setInterval>|undefined;
export function startPhoneSync(){
  if(timer)return;
  timer=window.setInterval(()=>void tickPhoneSync(),2000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void tickPhoneSync();});
}
