import {describe,expect,it} from 'vitest';
import {resolveReference} from './reference-resolver.ts';import type {SemanticScene,ReferenceContext} from './types.ts';import {resolveAirTouch} from './gesture-resolver.ts';
const now='2026-10-02T12:00:00Z';
const object={id:'a',kind:'research' as const,title:'Error',semanticRole:'error',monitorId:'primary',position:{x:10,y:10},size:{width:100,height:100},zIndex:1,state:'expanded' as const,pinned:false,dismissible:true,resourceRefs:['file:widget.ts'],updatedAt:now,data:{}};
const scene:SemanticScene={id:'s',principalId:'p',version:1,presentation:'WORKING',monitors:[],objects:[object],updatedAt:now};
const context:ReferenceContext={utterance:'what is wrong with that?',selectedIds:[],recentIds:[],now,pointing:{kind:'point',point:{x:50,y:50},monitorId:'primary',confidence:.85,observedAt:now}};
describe('referent safety',()=>{
 it('asks on overlapping objects even when one has a higher z index',()=>{expect(resolveReference({...scene,objects:[object,{...object,id:'b',zIndex:100}]},context).requiresClarification).toBe(true);});
 it('does not guess from stale pointing, stale focus, invalid clock or a disconnected target monitor',()=>{for(const change of [{pointing:{...context.pointing!,observedAt:'2026-10-02T11:00:00Z'}},{pointing:{...context.pointing!,monitorId:'other'}},{pointing:undefined,focusedId:'a',focusObservedAt:'invalid'},{now:'invalid'}])expect(resolveReference(scene,{...context,...change}).requiresClarification).toBe(true);});
 it('requires stronger evidence for world-affecting targets and refuses unknown selection',()=>{expect(resolveReference(scene,context).objectIds).toEqual(['a']);expect(resolveReference(scene,{...context,worldAffecting:true}).requiresClarification).toBe(true);expect(resolveReference(scene,{...context,pointing:undefined,selectedIds:['unknown'],focusObservedAt:now}).requiresClarification).toBe(true);});
 it('does not move on pinch release or magnetically acquire another monitor',()=>{const target={objectId:'a',centre:{x:50,y:50},radius:100,zIndex:1,monitorId:'primary'};const frame={phase:'pinch-end' as const,point:{x:50,y:50},confidence:.95,monitorId:'primary',observedAt:now};expect(resolveAirTouch(frame,[target]).action).toBeUndefined();expect(resolveAirTouch({...frame,phase:'pinch-start',monitorId:'other'},[target]).targetId).toBeUndefined();});
});
