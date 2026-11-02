import { startSupervision } from '@/features/phones/runtime/collaborationSettings';
import { startPhoneSync } from '@/features/phones/runtime/phoneSync';
import { startFeishuRelay } from '@/features/personal/runtime/feishuRelay';
import { syncSchedules } from '@/features/schedules/runtime/schedules';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { S, update } from '@/state/store';
import { CoreError, getEndpoint, setEndpoint } from '@/core/client';
import { startDevicesTimer, syncDevices } from '@/features/phones/runtime/devices';
import { syncCoreAccount, startPointsTimer } from '@/features/account/runtime/cloud';
import { connectEvents } from '@/core/events';
import { handleCoreEvent } from '@/features/chat/runtime/stream';
import { refreshProviders } from '@/features/settings/runtime/providerSync';
import { refreshTaskList } from '@/features/chat/runtime/taskSync';
import { recoverLoadedTasks, retryDeferredRecovery } from '@/features/chat/runtime/recovery';
import { quietError } from '@/shared/overlays/controller';
import type { Endpoint } from '@/core/types';
import { refreshWorkspace } from '@/features/workspace/runtime/workspace';
import { emitActivityReconnect } from '@/features/teams/activity/activityEvents';

/* ===== 启动：找到 lom-core → 拉取模型服务与任务 → 订阅实时事件 ===== */

async function resolveEndpoint(): Promise<Endpoint> {
  if (isTauri()) return invoke<Endpoint>('core_endpoint');
  /* 浏览器开发模式：tools/dev/run-core.sh 启动核心并写入 .env.development.local */
  const env = import.meta.env;
  return {
    url: env.VITE_LOM_CORE_URL || 'http://127.0.0.1:25808',
    token: env.VITE_LOM_CORE_TOKEN || '',
    defaultFolder: env.VITE_LOM_DEFAULT_FOLDER || '',
    homeDir: env.VITE_LOM_HOME || '',
  };
}

let started = false;

export async function startCore() {
  if (started) return;
  started = true;
  try {
    const ep = await resolveEndpoint();
    setEndpoint(ep);
    update(s => {
      s.homeDir = ep.homeDir;
      if (!s.folder && ep.defaultFolder) s.folder = ep.defaultFolder;
      if (ep.defaultFolder && !s.recentFolders.includes(ep.defaultFolder)) s.recentFolders.push(ep.defaultFolder);
    });
    await Promise.all([refreshProviders(), refreshTaskList()]);
    update(s => { s.conn = 'ready'; s.connError = ''; });
    void syncSchedules();
    void refreshWorkspace();
    void syncCoreAccount().then(syncDevices).catch((e: unknown) => quietError('sync.account_failed', e));
    startPointsTimer();
    startDevicesTimer();
    startPhoneSync();
    startSupervision();
    startFeishuRelay();
  } catch (e) {
    const msg = e instanceof CoreError ? `${e.message}（${e.code}）` : e instanceof Error ? e.message : String(e);
    update(s => { s.conn = 'offline'; s.connError = msg; });
    started = false;
    return;
  }
  connectEvents({
    onEvent: event => {
      handleCoreEvent(event);
      if (event.name === 'turn.completed') retryDeferredRecovery(event.data?.conversation_id);
    },
    onOpen: reconnected => {
      update(s => { s.conn = 'ready'; s.connError = ''; });
      if (reconnected) {
        void refreshTaskList().then(recoverLoadedTasks).catch(e => quietError('sync.tasks_failed', e));
        void syncCoreAccount().then(syncDevices).catch((e: unknown) => quietError('sync.account_failed', e));
        void syncSchedules();
        // D33：断线期间的团队事件不会重放，看板重新拉第一页
        emitActivityReconnect();
      }
    },
    onDown: reason => update(s => { s.conn = 'offline'; s.connError = reason; }),
  });
}

export const coreReady = () => S.conn === 'ready' && !!getEndpoint();
