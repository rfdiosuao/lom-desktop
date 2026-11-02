export interface SkillSourceData { status: string; repository: string; license: string; commit: string; checked_at: number; summary_status: string }
import { invoke } from '@tauri-apps/api/core';
import { api } from '@/core/client';
import { cloud, cloudSkillArchive } from '@/features/account/runtime/cloud';
import { authAccount } from '@/features/account/runtime/authScope';
import { phoneRpc } from '@/features/phones/runtime/phoneRpc';
import { base64, uploadPhoneFile } from '@/features/phones/runtime/phoneFiles';
import { S, update } from '@/state/store';
import { loadCommandSkills, type CommandSkill } from '@/features/chat/runtime/commandSkills';
import { isInternalSkill } from './upstreamSkills';
import type { PhoneSkill, PhoneSkills, SkillAction, SkillPackage, SkillStage } from '@/core/remoteWire';
export const CATEGORIES = ['写作','设计','开发','运营','效率','数据','其他'];
/** price：安装要付的积分（0 = 免费）；owned：免费、自己上传的或已经买过 */
export interface MarketSkill { source?: SkillSourceData; id: string; name: string; summary: string; category: string; version: number; downloads: number; author?: string; sha256?: string; price?: number; owned?: boolean; official?: boolean; }
export interface SkillDetail extends MarketSkill { readme: string | null; files: {path:string;size:number}[]; }
export interface MineSkill { id:string; name:string; category:string; removed:boolean; removed_reason:string; versions:{id:string;status:string;version:number;label:string;reject_reason:string}[]; }
export interface InstalledSkill { id:string; name:string; description:string; version?:string; enabled?:boolean; removable:boolean; location?:string; }
export const listMarket = (q='', category='') => cloud<MarketSkill[]>('GET', `/v1/skills?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
export const marketDetail = (id:string) => cloud<SkillDetail>('GET', `/v1/skills/${encodeURIComponent(id)}`);
/** 用积分购买技能（买过的不重复扣）；返回扣了多少点，并更新积分显示 */
export async function purchaseSkill(id: string) {
  // 请求期间切换账号：这次购买属于旧账号，迟到的响应不能写到新账号的积分显示里，调用方后面的通知和安装也要跟着停下。
  const signedIn = S.cloud === 'signed-in' && !!S.account?.id, isCurrent = authAccount();
  const switched = () => new Error('账号已切换，这次技能购买的结果没有应用到当前账号');
  let r: { owned: boolean; charged: number; points: { total: number; free: number; paid: number; period: string; daily?: number } };
  // 失败也一样：开始时已登录、结束时账号变了，就不把旧账号的错误显示给新账号；本来就没登录时保留真实错误
  try { r = await cloud<typeof r>('POST', `/v1/skills/${encodeURIComponent(id)}/purchase`, {}); }
  catch (e) { throw signedIn && !isCurrent() ? switched() : e; }
  if (!isCurrent()) throw switched();
  update(s => { s.points = r.points; });
  return r.charged;
}
export const priceLabel = (k: { price?: number; owned?: boolean }) => (k.owned ? (k.price ? '已拥有' : '免费') : `${k.price ?? 0} 积分`);
export const mineSkills = () => cloud<MineSkill[]>('GET', '/v1/skills/mine');
export const reportSkill = (id:string, reason:string, note:string) => cloud('POST', `/v1/skills/${encodeURIComponent(id)}/report`, {reason,note});
export async function submitSkill(file: File, name:string, summary:string, category:string, id?:string) {
  if (!file.size || file.size>10*1024*1024 || !file.name.toLowerCase().endsWith('.zip')) throw new Error('请选择 10 MB 以内的 ZIP 技能包');
  return cloud<{status:string;version:number}>('POST', id ? `/v1/skills/${encodeURIComponent(id)}/versions` : '/v1/skills',
    {name,summary,category,archive:base64(new Uint8Array(await file.arrayBuffer()))});
}
export async function installedSkills(device:string):Promise<InstalledSkill[]> {
  if (device==='pc') {
    const rows=await api<{name:string;description:string;is_custom:boolean;source:CommandSkill['source'];location:string}[]>('GET','/api/skills');
    return rows.filter(x=>!isInternalSkill(x)).map(x=>({...x,id:x.name,removable:x.is_custom}));
  }
  const r=await phoneRpc<PhoneSkills>(device,'skills.list',{});
  return (JSON.parse(r.items) as PhoneSkill[]).map(x=>({...x,enabled:x.enabled==='true',removable:true}));
}
export async function installedDetail(device:string, row:InstalledSkill):Promise<string> {
  if (device==='pc') { const r=await api<{name:string;description:string}>('POST','/api/skills/info',{skill_path:row.location}); return `# ${r.name}\n\n${r.description}`; }
  const request:SkillAction={id:row.id,enabled:''};
  return (await phoneRpc<PhoneSkill>(device,'skills.read',request)).body;
}
export async function removeSkill(device:string,id:string) {
  if(device==='pc') { await api('DELETE',`/api/skills/${encodeURIComponent(id)}`); await loadCommandSkills(); }
  else { const request:SkillAction={id,enabled:''}; await phoneRpc(device,'skills.delete',request); }
}
export async function togglePhoneSkill(device:string,id:string,enabled:boolean) {
  const request:SkillAction={id,enabled:String(enabled)}; await phoneRpc(device,'skills.toggle',request);
}
export async function verifyPackage(bytes:Uint8Array, expected:string) {
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==expected) throw new Error('技能包完整性校验失败，未安装');
}
async function cleanStage(clean:()=>Promise<unknown>, installed:string) {
  try{await clean();}catch(e){throw new Error(`${installed ? `${installed}；但暂存包清理失败` : '安装失败且暂存包未清理'}：${e instanceof Error?e.message:String(e)}`);}
}
async function verifyInstalledSkills(names: string[]) {
  const rows = await installedSkills('pc');
  for (const name of names) {
    const row = rows.find(s => s.name === name && s.removable && s.location);
    if (!row) throw new Error(`skill.install_unconfirmed：本机未确认安装「${name}」，请刷新已安装列表后重试`);
    const info = await api<{name:string}>('POST', '/api/skills/info', {skill_path:row.location});
    if (info.name !== name) throw new Error(`skill.install_unconfirmed：本机技能「${name}」读取结果不一致`);
  }
}
export async function installMarketSkill(id:string,device:string,expectedSha?:string):Promise<string> {
  const account=S.account?.id;
  const {bytes,sha256}=await cloudSkillArchive(id,expectedSha); await verifyPackage(bytes,sha256);
  if(S.account?.id!==account) throw new Error('账号已切换');
  if(device==='pc') {
    const request:SkillPackage={archive:base64(bytes),sha256};
    const path=await invoke<string>('skill_stage',{request}); let receipt='';
    try {
      const r=await api<{skill_names:string[];failed:{code:string}[]}>('POST','/api/skills/import',{skill_path:path});
      if(r.failed?.length || !r.skill_names?.length) throw new Error(`导入未全部完成：${r.failed?.map(x=>x.code).join('、') || '核心未返回技能'}`);
      await verifyInstalledSkills(r.skill_names);
      receipt=`已安装到当前电脑：${r.skill_names.join('、')}。请新建聊天后使用，已有聊天的技能列表不会自动更新。其他电脑需要分别安装。`; await loadCommandSkills(); return receipt;
    } finally { const request:SkillStage={path}; await cleanStage(()=>invoke('skill_stage_remove',{request}),receipt); }
  }
  const file=new File([bytes as Uint8Array<ArrayBuffer>],'skill.zip',{type:'application/zip'});
  const transfer=await uploadPhoneFile(device,{file,name:file.name}); let receipt='';
  try {
    const request:SkillAction={id:transfer,enabled:''};
    const row=await phoneRpc<PhoneSkill>(device,'skills.install',request); receipt=`手机已安装：${row.name}`; return receipt;
  } finally { await cleanStage(()=>phoneRpc(device,'file.delete',{id:transfer}),receipt); }
}
