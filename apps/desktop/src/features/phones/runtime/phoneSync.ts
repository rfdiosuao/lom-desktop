import { linkGuard, observeDevice, recordSynced, restartLink } from './deviceLink';
import { syncPhoneSchedules, resolvePendingPhoneRuns } from './phoneSchedules';
import { loadPhoneCache } from './phoneCache';
import { S, update } from '@/state/store';
import { syncPhoneHistory, watchPhone } from './phoneChat';
import { syncPhoneDocuments } from './phoneDocuments';
import { cloudConfigured } from '@/features/account/runtime/serviceConfig';

/* 连接代次、在线、同步完成由 deviceLink 持有（REFACTOR-01 模块 2）；这里只管同步节奏和退避 */
interface Slot { quick:number; full:number; retry:number; attempts:number; error:string; }
const slots=new Map<string,Slot>(), busy=new Set<string>();
let account:string|undefined, selected='';
const lan=()=>!cloudConfigured()&&S.cloud!=='signed-in';
const slot=(id:string)=>{let s=slots.get(id);if(!s){s={quick:0,full:0,retry:0,attempts:0,error:''};slots.set(id,s);}return s;};
export const phoneSyncError=(id:string)=>slots.get(id)?.error || '';
const online=(id:string)=>(S.cloud==='signed-in'||lan())&&!!S.agents[id]?.real&&S.agents[id].status==='online';
function reset(s:Slot){s.quick=0;s.full=0;s.retry=0;s.attempts=0;s.error='';}
function prepare() {
  const next=S.cloud==='signed-in'?S.account?.id:lan()?'lan':undefined;
  if(account!==next){account=next;slots.clear();selected='';}
  try{loadPhoneCache();}catch(e){slot(S.phoneId).error=e instanceof Error?e.message:'本地缓存读取失败';}
  if(selected!==S.phoneId){selected=S.phoneId;const s=slot(selected);s.quick=0;s.full=0;}
  for(const id of S.phoneOrder){
    const s=slot(id), alive=online(id);
    if(observeDevice(id,alive)&&alive&&S.prefs.reconnect)reset(s);
  }
  for(const id of slots.keys())if(!S.agents[id]?.real&&!busy.has(`${account}:${id}`))slots.delete(id);
}
async function syncDevice(id:string,force=false,reconcile=true):Promise<boolean> {
  const key=`${account}:${id}`, owner=account;
  if(!owner||!online(id)||busy.has(key)||busy.size>=2)return false;
  const s=slot(id);if(!force&&(!S.prefs.reconnect&&s.attempts>0||s.retry>Date.now()))return false;
  const link=linkGuard(id);
  const current=()=>link()&&account===owner&&slots.get(id)===s&&online(id);
  busy.add(key);s.quick=Date.now();
  try {
    const full=force||!s.full||Date.now()-s.full>=(document.hidden?300_000:60_000);
    const changed=await syncPhoneHistory(id,!full);if(!current())return false;
    if(full){
      await syncPhoneDocuments(id);if(!current())return false;
      await syncPhoneSchedules(id);if(!current())return false;
      if(reconcile){await resolvePendingPhoneRuns(id);if(!current())return false;}
      s.full=Date.now();
    }
    s.attempts=0;s.retry=0;s.error='';if(full)recordSynced(id);
    const c=S.convs.find(c=>c.id===S.activeConv&&c.phoneSession&&c.owner===id);
    if(c&&(changed||full))void watchPhone(c);
    return true;
  }catch(e){
    if(current()){s.error=e instanceof Error?e.message:'同步失败';s.attempts++;s.retry=Date.now()+Math.min(300_000,15_000*2**Math.min(s.attempts-1,5));}
    return false;
  }finally{busy.delete(key);update();}
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
/** Explicit recovery probes are read-only: never replay pending task operations here. */
export async function syncPhoneNow(id:string){prepare();return syncDevice(id,true,false);}
export async function resumePhoneSync(){
  if(document.hidden||!S.prefs.reconnect)return;
  prepare();for(const id of S.phoneOrder)if(online(id)){reset(slot(id));restartLink(id);}
  await tickPhoneSync();
}
let timer:ReturnType<typeof setInterval>|undefined;
const onResume=()=>{void resumePhoneSync();};
export function startPhoneSync(){
  if(timer)return;
  let lastTick=Date.now();
  timer=window.setInterval(()=>{
    const now=Date.now(), resumed=!document.hidden&&now-lastTick>10000;lastTick=now;
    void(resumed?resumePhoneSync():tickPhoneSync());
  },2000);
  document.addEventListener('visibilitychange',onResume);
  window.addEventListener('online',onResume);
}
export function stopPhoneSync(){
  if(timer!==undefined)clearInterval(timer);timer=undefined;
  document.removeEventListener('visibilitychange',onResume);window.removeEventListener('online',onResume);
}
