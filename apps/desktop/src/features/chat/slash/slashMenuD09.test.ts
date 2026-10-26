import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({memory:vi.fn(),schedule:vi.fn(),modal:vi.fn()}));
vi.mock('@/app/navigation',()=>({newTask:vi.fn(),openSettings:vi.fn(),gotoPhonePage:m.memory}));
vi.mock('@/features/schedules/actions/schedule',()=>({editSched:m.schedule}));
vi.mock('@/shared/overlays/controller',()=>({openModal:m.modal}));
vi.mock('../actions/conversations',()=>({renameConv:vi.fn(),exportConv:vi.fn()}));
vi.mock('../actions/turtle',()=>({enableTurtle:vi.fn()}));
vi.mock('../runtime/commandSkills',()=>({loadCommandSkills:vi.fn()}));
import { S } from '@/state/store';
import { slashMenu } from './slashMenu';
function command(key:string,label:string) { const x=slashMenu(key,'').find(x=>typeof x!=='string'&&!x.header&&x.label===label);if(!x||typeof x==='string'||x.header)throw new Error('Missing command');return x; }
beforeEach(()=>{vi.clearAllMocks();S.convs=[{id:'phone-chat',owner:'phone-a',phoneSession:'session'}] as typeof S.convs;S.phoneId='phone-b';});
it('D09 手机会话快捷命令使用会话所属手机，不误用侧栏选中设备',()=>{
 command('conv:phone-chat','记忆').onSelect?.();expect(m.memory).toHaveBeenCalledWith('phone-a','phone-memory');
 command('conv:phone-chat','定时任务').onSelect?.();expect(m.schedule).toHaveBeenCalledWith({exec:'phone-a'});
 command('conv:phone-chat','MCP').onSelect?.();expect(m.modal).toHaveBeenCalledWith('mcp');
});
it('D09 电脑记忆不冒用手机能力（打开 Lom 自己的记忆），示例手机不能建立真实定时任务',()=>{
 S.mode='desktop';S.folder='/work';const mem=command('home','记忆');expect(mem.disabled).toBe(false);mem.onSelect?.();
 expect(m.memory).not.toHaveBeenCalled();expect(m.modal).toHaveBeenCalledWith('lomMemory',{workspace:'/work'});
 expect(command('home','定时任务').disabled).toBe(false);
 S.mode='phone';S.agents['phone-b']={real:false} as typeof S.agents[string];expect(command('home','定时任务').disabled).toBe(true);
});
