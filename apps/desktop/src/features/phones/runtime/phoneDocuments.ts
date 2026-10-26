import { savePhoneCache } from './phoneCache';
import { phoneRpc } from './phoneRpc';
import { S, update } from '@/state/store';
import { authAccount, type AuthGuard } from '@/features/account/runtime/authScope';

export interface PhoneDocument { name: string; text: string; revision: string; modified: number; }
const documents = new Map<string, { doc: PhoneDocument; current: AuthGuard }>();
export const phoneDocument = (device: string, name: string) => {
  const entry = documents.get(`${device}:${name}`);
  return entry?.current() ? entry.doc : undefined;
};
export async function syncPhoneDocuments(device: string) {
  const current = authAccount();
  if (!current()) return;
  const index = await phoneRpc<{ items: Omit<PhoneDocument, 'text'>[] }>(device, 'document.list', {});
  if (!current()) return; // The account changed while reading; discard its response.
  for (const item of index.items) {
    if (item.name === 'SOUL.md' && S.soulDirty[device]) continue;
    // Preserve the exact revision the user began editing; a stale editor must conflict on save.
    if (S.modals.some(m => m.id === 'memory') && device === S.phoneId) continue;
    const cached = phoneDocument(device, item.name);
    if (cached?.revision === item.revision) continue;
    const doc = await phoneRpc<PhoneDocument>(device, 'document.read', { name: item.name });
    if (!current()) return; // Never move old-account documents into the new session.
    // Editing may begin while the read is in flight, including on another phone page.
    if (item.name === 'SOUL.md' && S.soulDirty[device]) continue;
    documents.set(`${device}:${doc.name}`, { doc, current });
  }
  update(s => {
    const soul = phoneDocument(device, 'SOUL.md');
    if (soul && !s.soulDirty[device]) { s.souls[device] = soul.text; if (s.agents[device]) s.agents[device].soulConfigured = !!soul.text.trim(); }
    if (!s.modals.some(m => m.id === 'memory') || device !== s.phoneId) s.memories[device] = index.items.filter(x => x.name !== 'SOUL.md')
      .map(x => phoneDocument(device, x.name)).filter((x): x is PhoneDocument => !!x && !!x.text.trim())
      .map(x => ({ id: x.name, text: x.text, src: x.name, at: x.modified }));
  });
  await savePhoneCache();
}
export async function writePhoneDocument(device: string, name: string, text: string) {
  const current = authAccount();
  if (!current()) throw new Error('请先登录后保存手机内容');
  const before = phoneDocument(device, name);
  if (!before) throw new Error('请先加载手机内容，再编辑保存');
  const doc = await phoneRpc<PhoneDocument>(device, 'document.write', { name, text, revision: before.revision });
  if (!current()) throw new Error('登录状态已变化，请重新打开手机内容确认保存结果');
  documents.set(`${device}:${name}`, { doc, current });
  if (name === 'SOUL.md') update(s => {
    // A save acknowledges only the submitted draft, not edits made while waiting.
    if (s.souls[device] === text) { delete s.soulDirty[device]; s.souls[device] = doc.text; }
    if (s.agents[device]) { s.agents[device].soulConfigured = !!doc.text.trim(); s.agents[device].persona = ''; }
  });
  await savePhoneCache(name === 'SOUL.md' ? { [device]: doc.text } : undefined);
}
