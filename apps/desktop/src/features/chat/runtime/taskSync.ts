import { S, update } from '@/state/store';
import { listTasks } from './history';

let generation = 0;

export async function refreshTaskList() {
  const attempt = ++generation;
  const existing = new Set(S.convs.map(c => c.id));
  const tasks = await listTasks();
  if (attempt !== generation) return;
  update(s => {
    const known = new Map(s.convs.filter(c => c.remote).map(c => [c.id, c]));
    const merged = tasks.map(t => {
      const k = known.get(t.id);
      return k ? Object.assign(k, { title: t.title, updated: Math.max(k.updated, t.updated), workspace: t.workspace ?? k.workspace,
        agentBackend: t.agentBackend ?? k.agentBackend }) : t;
    });
    // 打开着的侧边聊天是隐藏的临时会话，不在任务列表里，刷新时保留
    const listed = new Set(merged.map(c => c.id));
    s.convs = [...merged, ...s.convs.filter(c => !listed.has(c.id) &&
      (!c.remote || !existing.has(c.id) || (c.sideOf && c.id === s.sideChat?.conv)))];
    s.tasksLoaded = true;
  });
}
