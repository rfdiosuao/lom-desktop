import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({cloud:vi.fn()}));
vi.mock('@/features/account/runtime/cloud',()=>({cloud:m.cloud,CloudError:class extends Error {constructor(public code:string){super(code);}}}));
import { discoverWithJev, observeCapabilities } from './jevObservation';
import { discoverCapabilities } from './managementCatalog';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const self:Conv={id:'pa',owner:'pc',title:'pa',updated:0,messages:[{id:'u',type:'user',at:0,text:'PRIVATE HISTORY MUST NOT LEAVE'}],personal:{id:'p',name:'p',directory:'/private'},personalScope:'pa-scope'};
beforeEach(()=>{beginAuthChange();vi.clearAllMocks();S.account={id:'a',name:'',email:''};m.cloud.mockImplementation(async(_method,_path,body)=>({mode:'observe',requested_model:'jev-1.13.0',scores:body.candidates.map((c:{id:string})=>({id:c.id,relevance_probability:c.id.endsWith('answer_without_tools')?0.1:0.8})),latency_ms:10,input_tokens:50,output_tokens:1,execution_changed:false}));});
it('JEV-OBS-01 explicit observation preserves baseline and sends only bounded query and descriptions',async()=>{
 const r=await observeCapabilities(self,{observe:true,query:'文档'},()=>true);
 expect(r.capabilities).toEqual(discoverCapabilities({query:'文档'}).capabilities);
 expect(r.observation).toMatchObject({mode:'observe',execution_changed:false});
 const b=m.cloud.mock.calls[0][2];expect(b.candidates.length).toBeLessThanOrEqual(20);expect(JSON.stringify(b)).not.toContain('PRIVATE HISTORY');expect(JSON.stringify(b)).not.toContain('/private');
 await observeCapabilities(self,{observe:true,query:'文档'},()=>true);expect(m.cloud).toHaveBeenCalledTimes(1);
 beginAuthChange();await observeCapabilities(self,{observe:true,query:'文档'},()=>true);expect(m.cloud).toHaveBeenCalledTimes(2);
});
it('JEV-OBS-01 stop and status paths bypass network, failures preserve discovery without retry',async()=>{
 expect((await observeCapabilities(self,{observe:true,query:'停止任务'},()=>true)).observation).toMatchObject({status:'bypassed'});expect(m.cloud).not.toHaveBeenCalled();
 m.cloud.mockRejectedValue(new Error('upstream-private-detail'));
 const r=await observeCapabilities(self,{observe:true,query:'文档'},()=>true);
 expect(r.observation).toMatchObject({status:'fallback',execution_changed:false});expect(JSON.stringify(r)).not.toContain('upstream-private-detail');expect(m.cloud).toHaveBeenCalledTimes(1);
});
it('JEV-OBS-01 invalid or invented scores fall back, and explicit query is required',async()=>{
 m.cloud.mockResolvedValue({mode:'observe',execution_changed:false,scores:[{id:'invented',relevance_probability:1}]});
 expect((await observeCapabilities(self,{observe:true,query:'文档'},()=>true)).observation).toMatchObject({status:'fallback'});
 await expect(observeCapabilities(self,{observe:true},()=>true)).rejects.toThrow('query');
});
it('JEV-OBS-01 late response after cancellation never returns the old observation',async()=>{
 let current=true;m.cloud.mockImplementation(async()=>{current=false;return {}});
 await expect(observeCapabilities(self,{observe:true,query:'文档'},()=>current)).rejects.toThrow('已停止');
});

it('JEV-OBS-01 concurrent discoveries and failed observations are reused within the same turn', async () => {
 m.cloud.mockRejectedValue(new Error('offline'));
 const results = await Promise.all([1,2].map(() => observeCapabilities(self,{observe:true,query:'文档'},()=>true)));
 expect(results.every(r => 'status' in r.observation && r.observation.status === 'fallback')).toBe(true);
 await observeCapabilities(self,{observe:true,query:'文档'},()=>true);
 expect(m.cloud).toHaveBeenCalledTimes(1);
 await observeCapabilities({...self,turnId:'next'},{observe:true,query:'文档'},()=>true);
 expect(m.cloud).toHaveBeenCalledTimes(2);
});

it('JEV-DISC-01 semantic fallback returns bounded summaries and explicit schema lookup', async () => {
 const r = await discoverWithJev(self,{query:'semantic-unmatched-request'},()=>true);
 expect(r).toMatchObject({routing:'semantic_suggestions',total:0});
 if (!('suggestions' in r)) throw new Error('missing suggestions');
 expect(r.suggestions.length).toBeGreaterThan(0);
 expect(r.suggestions).toHaveLength(5);
 expect(r.observation).not.toHaveProperty('scores');
 expect(r.observation).not.toHaveProperty('local_candidates');
 expect(r.suggestions[0].capability).not.toHaveProperty('input_schema');
 expect(discoverCapabilities(r.suggestions[0].schema_lookup).capability).toHaveProperty('input_schema');
 expect(r.suggestions.some(s => s.id.endsWith('answer_without_tools'))).toBe(false);
 beginAuthChange();m.cloud.mockRejectedValue(new Error('offline'));
 expect(await discoverWithJev(self,{query:'semantic-unmatched-request'},()=>true)).toMatchObject({total:0,observation:{status:'fallback'}});
});
it('JEV-DISC-01 exact and lexical discovery bypass network', async () => {
 await discoverWithJev(self,{id:'session_read'},()=>true);
 await discoverWithJev(self,{query:'session_read'},()=>true);
 await discoverWithJev(self,{},()=>true);
 expect(m.cloud).not.toHaveBeenCalled();
});

function scoresFor(probability: (id: string) => number) {
 m.cloud.mockImplementation(async (_method, _path, body) => ({mode:'observe',execution_changed:false,
  scores:body.candidates.map((c:{id:string})=>({id:c.id,relevance_probability:probability(c.id)}))}));
}
it('JEV-DISC-01 direct answers and ambiguous ties never disclose speculative schemas', async () => {
 for (const [direct, expected] of [[0.95,'direct_answer_suggested'],[0.1,'review_required']] as const) {
  beginAuthChange();scoresFor(id=>id.endsWith('answer_without_tools')?direct:0.1);
  const r=await discoverWithJev(self,{query:'给我讲个猫的笑话'},()=>true);
  expect(r).toMatchObject({routing:expected,suggestions:[]});
  expect(JSON.stringify(r)).not.toContain('input_schema');
 }
});
it('JEV-DISC-01 multiple relevant capabilities remain independently discoverable with bounded suggestions', async () => {
 scoresFor(id=>id.endsWith('feishu_read_doc')||id.endsWith('session_read')?0.95:0.1);
 const r=await discoverWithJev(self,{query:'读取文档和修复任务上下文',limit:2},()=>true);
 if (!('suggestions' in r)) throw new Error('missing suggestions');
 expect(r.suggestions.map(s=>s.id).sort()).toEqual(['lom.personal.feishu_read_doc','lom.personal.session_read']);
 expect(r).toMatchObject({more_candidates:true});
});
it('JEV-DISC-01 malformed direct-answer score falls back and never emits a schema', async () => {
 scoresFor(id=>id.endsWith('answer_without_tools')?NaN:0.9);
 const r=await discoverWithJev(self,{query:'帮我看看之前聊的内容'},()=>true);
 expect(r).toMatchObject({observation:{status:'fallback'}});
 expect(JSON.stringify(r)).not.toContain('input_schema');
});
it('JEV-DISC-01 candidates identify distinct operations and omit private history', async () => {
 await discoverWithJev(self,{query:'读取飞书文档并给我摘要'},()=>true);
 const rows=m.cloud.mock.calls[0][2].candidates;
 expect(rows.length).toBeLessThanOrEqual(20);
 const read=rows.find((c:{id:string})=>c.id.endsWith('feishu_read_doc'));
 const people=discoverCapabilities({id:'feishu_find_people'}).capability!;
 expect(read.description).not.toBe(people.description);
 expect(read.description).toContain('feishu_read_doc');
 expect(JSON.stringify(rows)).not.toContain('PRIVATE HISTORY');
});
