import { invoke, isTauri } from '@tauri-apps/api/core';
import { S } from '@/state/store';

/* 任务在后台完成时提示。桌面使用系统音频，浏览器使用 Web Audio；设置里可关闭。 */

let ctx: AudioContext | null = null;

export async function chime() {
  if (isTauri()) { await invoke('completion_sound'); return; }
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const now = ctx.currentTime;
  [[880, 0], [1318.5, 0.14]].forEach(([freq, at]) => {
    const osc = ctx!.createOscillator(), gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.32);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.34);
  });
}

/** 一个任务（电脑或手机）这一轮结束时调用 */
export function taskFinished(convId: string) {
  if (!S.prefs.sound) return;
  const watching = document.hasFocus() && !document.hidden && S.route.name === 'chat' && S.activeConv === convId;
  if (watching) return;
  void chime().catch(e => console.warn('sound.play_failed', e instanceof Error ? e.message : e));
}
