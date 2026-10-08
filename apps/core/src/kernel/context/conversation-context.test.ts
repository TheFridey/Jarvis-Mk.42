import {expect,it,vi} from 'vitest';
import {ContextCompiler} from './context-compiler.ts';
it('ordinary cloud chat cannot retrieve ambient private state, events or business knowledge',async()=>{
  const state={view:vi.fn(()=>{throw new Error('private state must not be read');})};
  const eventStore={readRecent:vi.fn(()=>{throw new Error('private events must not be read');})};
  const knowledge={activeObjectiveIds:vi.fn(()=>{throw new Error('private knowledge must not be read');})};
  const compiler=new ContextCompiler({state,eventStore,knowledge,events:{emit:vi.fn(async()=>undefined)},clock:{epochMs:()=>Date.parse('2026-10-08T12:00:00Z'),nowIso:()=> '2026-10-08T12:00:00Z'},ids:{ulid:()=> 'context'},availableCapabilities:()=>['capabilities.web']} as unknown as ConstructorParameters<typeof ContextCompiler>[0]);
  const result=await compiler.compile({scope:'conversation',principalId:'operator',correlationId:'greeting',intent:'Hey Jarvis',intentClass:'reason',budgetUnits:4000,maxPrivacyClass:'PUBLIC'});
  expect(result.maxPrivacyClass).toBe('PUBLIC');
  expect(state.view).not.toHaveBeenCalled();expect(eventStore.readRecent).not.toHaveBeenCalled();expect(knowledge.activeObjectiveIds).not.toHaveBeenCalled();
});
