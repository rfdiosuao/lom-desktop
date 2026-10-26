import { beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error Tests run in Node; production types remain browser-only.
import { webcrypto } from 'node:crypto';
const m=vi.hoisted(()=>({api:vi.fn(),cloud:vi.fn(),download:vi.fn(),invoke:vi.fn(),rpc:vi.fn(),upload:vi.fn(),reload:vi.fn()}));
vi.mock('@/core/client',()=>({api:m.api}));vi.mock('@/features/account/runtime/cloud',()=>({cloud:m.cloud,cloudSkillArchive:m.download}));
vi.mock('@tauri-apps/api/core',()=>({invoke:m.invoke}));vi.mock('./phoneRpc',()=>({phoneRpc:m.rpc}));
vi.mock('./phoneFiles',()=>({base64:(b:Uint8Array)=>btoa(String.fromCharCode(...b)),uploadPhoneFile:m.upload}));
vi.mock('@/features/chat/runtime/commandSkills',()=>({loadCommandSkills:m.reload}));
import { installMarketSkill, installedSkills, submitSkill } from '@/features/skills/runtime/skillMarket';
import { parseTransport, testMcp, changeMcp, type McpServer } from '@/features/settings/runtime/mcpManager';
import { DeviceTransitions } from './deviceTransitions';
beforeEach(()=>{vi.resetAllMocks();Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});});
it('D09 电脑安装必须验证摘要并刷新核心列表，最后清理临时目录',async()=>{
  const bytes=new TextEncoder().encode('fixture');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  m.download.mockResolvedValue({bytes,sha256});m.invoke.mockResolvedValue('/cache/stage');
  m.api.mockImplementation(async (method, path) => method === 'GET' && path === '/api/skills' ? [{name:'fixture',source:'custom',is_custom:true,location:'/skills/fixture'}] : path === '/api/skills/info' ? {name:'fixture'} : {skill_names:['fixture'],failed:[]});
  expect(await installMarketSkill('skill','pc')).toContain('fixture');
  expect(m.api).toHaveBeenCalledWith('POST','/api/skills/import',{skill_path:'/cache/stage'});
  expect(m.invoke).toHaveBeenLastCalledWith('skill_stage_remove',{request:{path:'/cache/stage'}});expect(m.reload).toHaveBeenCalled();
  expect(m.api).toHaveBeenCalledWith('POST','/api/skills/info',{skill_path:'/skills/fixture'});
  m.download.mockResolvedValue({bytes,sha256:'bad'});m.invoke.mockClear();
  await expect(installMarketSkill('skill','pc')).rejects.toThrow('校验失败');expect(m.invoke).not.toHaveBeenCalled();
});
it.each(['missing', 'unreadable'])('D09 import receipt cannot claim success when local skill is %s', async mode => {
  const bytes=new Uint8Array([1]);const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  m.download.mockResolvedValue({bytes,sha256});m.invoke.mockResolvedValue('/cache/stage');
  m.api.mockImplementation(async (_method, path) => {
    if(path === '/api/skills/import') return {skill_names:['fixture'],failed:[]};
    if(path === '/api/skills') return mode === 'missing' ? [] : [{name:'fixture',source:'custom',is_custom:true,location:'/skills/fixture'}];
    throw new Error('manifest unreadable');
  });
  await expect(installMarketSkill('skill','pc')).rejects.toThrow(/未确认|unreadable/);
  expect(m.invoke).toHaveBeenLastCalledWith('skill_stage_remove',{request:{path:'/cache/stage'}});
});
it('D09 手机安装通过文件传输和真实回执，失败也清理上传包',async()=>{
  const bytes=new Uint8Array([1]);const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  m.download.mockResolvedValue({bytes,sha256});m.upload.mockResolvedValue('transfer');m.rpc.mockRejectedValueOnce(new Error('invalid manifest')).mockResolvedValue({});
  await expect(installMarketSkill('skill','dev_x')).rejects.toThrow('invalid manifest');
  expect(m.rpc).toHaveBeenCalledWith('dev_x','skills.install',{id:'transfer',enabled:''});
  expect(m.rpc).toHaveBeenLastCalledWith('dev_x','file.delete',{id:'transfer'});
});
it('D09 市场失败不回退示例，超大上传拒绝，手机读取实际技能列表',async()=>{
  m.rpc.mockResolvedValue({items:JSON.stringify([{id:'s',name:'real',enabled:'false'}])});
  expect(await installedSkills('dev_x')).toMatchObject([{id:'s',enabled:false}]);
  m.api.mockRejectedValue(new Error('offline'));await expect(installedSkills('pc')).rejects.toThrow('offline');
  await expect(submitSkill(new File(['x'],'bad.txt'),'x','x','其他')).rejects.toThrow('ZIP');expect(m.cloud).not.toHaveBeenCalled();
});
it('D09 MCP 失败回执不算成功，内部手机服务不能修改',async()=>{
  const row:McpServer={id:'id',name:'external',enabled:false,builtin:false,last_test_status:'unknown',transport:{type:'http',url:'https://example.com/mcp'}};
  m.api.mockResolvedValue({success:false,error:'protocol failed'});await expect(testMcp(row)).rejects.toThrow('protocol failed');
  await expect(changeMcp({...row,name:'lom-phone-private'},true)).rejects.toThrow('内部');
  expect(()=>parseTransport('{"type":"stdio","command":"tool","args":[1]}')).toThrow();
  expect(parseTransport('{"type":"stdio","command":"tool","args":["run"]}').command).toBe('tool');
});
it('D09 连接提醒初次静默、重复去重、设置关闭与账号隔离',()=>{
  const tracker=new DeviceTransitions();const row={id:'dev',name:'手机',online:false};
  expect(tracker.observe('a',[row],true)).toEqual([]);
  expect(tracker.observe('a',[{...row,online:true}],true)).toEqual(['手机已上线']);
  expect(tracker.observe('a',[{...row,online:true}],true)).toEqual([]);
  expect(tracker.observe('b',[row],true)).toEqual([]);
  expect(tracker.observe('b',[{...row,online:true}],false)).toEqual([]);
});
