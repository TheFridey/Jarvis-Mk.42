import {expect,it,vi} from 'vitest';
import {ContextCompiler,type ContextCompilerDeps} from './context-compiler.ts';
it('public web scope never reads ambient private state, events or knowledge',async()=>{
  const state=vi.fn(),recent=vi.fn(),recall=vi.fn(),atlas=vi.fn();
  const compiler=new ContextCompiler({state:{view:state},eventStore:{readRecent:recent},knowledge:{activeObjectiveIds:atlas,recall:{recall}},events:{emit:async()=>{}},clock:{epochMs:()=>0,nowIso:()=> '2026-10-06T09:08:53Z'},ids:{ulid:()=> 'context'},availableCapabilities:()=>['capabilities.web']} as unknown as ContextCompilerDeps);
  const result=await compiler.compile({scope:'public-web',principalId:'p1',correlationId:'audit',intent:'Check public site',intentClass:'reason',budgetUnits:4000,maxPrivacyClass:'PUBLIC'});
  expect(result.maxPrivacyClass).toBe('PUBLIC');expect(result.items.map(i=>i.sourceType)).toEqual(['capability_registry']);
  for(const source of [state,recent,recall,atlas])expect(source).not.toHaveBeenCalled();
});
it('does not downgrade required private evidence for a public context',async()=>{
  const compiler=new ContextCompiler({events:{emit:async()=>{}},clock:{epochMs:()=>0,nowIso:()=> '2026-10-06T09:08:53Z'},ids:{ulid:()=> 'context'},availableCapabilities:()=>[],evidence:()=>[{summary:'private',content:{secret:true},privacyClass:'RESTRICTED',provenance:{}}]} as unknown as ContextCompilerDeps);
  await expect(compiler.compile({scope:'public-web',principalId:'p1',evidenceRef:'private',correlationId:'audit',intent:'audit',intentClass:'reason',budgetUnits:4000,maxPrivacyClass:'PUBLIC'})).rejects.toThrow('required evidence exceeds privacy ceiling');
});
