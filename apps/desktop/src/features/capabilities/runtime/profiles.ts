import { authRevision } from '@/features/account/runtime/authScope';
import { S, update } from '@/state/store';
import { readJson, writeJson, cacheWriteError } from '@/features/account/runtime/localCache';

export interface Profile { name: string; rules: string }
interface Saved { current: Profile | null; previous?: Profile | null }
const owner = () => S.cloud === 'signed-in' && S.account?.id ? S.account.id : 'local';
export const profileGuard = () => { const current = authRevision(), scope = owner(); return () => current() && owner() === scope; };
const key = (target: string) => `lom.agent-profile.v1:${owner()}:${target}`;
const valid = (p: unknown): p is Profile => !!p && typeof (p as Profile).name === 'string' && typeof (p as Profile).rules === 'string' && (p as Profile).rules.length <= 12000;
export function readProfile(target: string): Saved {
  const r = readJson<Saved>(key(target), x => {
    const v = x as Saved;
    return v && (v.current === null || valid(v.current)) && (v.previous === undefined || v.previous === null || valid(v.previous)) ? v : undefined;
  });
  if (r.status === 'missing') return { current: null };
  if (r.status !== 'ok') throw new Error('智能体配置无法读取，请检查本机存储；原配置已保留');
  return r.value;
}
export function saveProfile(target: string, profile: Profile | null, expected: string) {
  if (profile && (!valid(profile) || !profile.name.trim() || !profile.rules.trim())) throw new Error('请填写名称与工作规则（最多 12000 字符）');
  const before = readProfile(target);
  if (JSON.stringify(before) !== expected) throw new Error('配置已变化，请重新预览');
  const result = writeJson(key(target), { current: profile, previous: before.current });
  if (result !== 'ok') throw new Error(cacheWriteError(result));
  update();
}
export function profileRules(target: string) {
  const p = readProfile(target).current;
  return p ? `专业工作配置：${p.name}\n${p.rules}\n这些规则不改变已授予的工具、权限或审批要求。` : '';
}
export { PROFILE_TEMPLATES } from './profileTemplates';
