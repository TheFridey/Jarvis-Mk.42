import {randomUUID} from 'node:crypto';
import type {ContextItemKind,ScreenContext,VisionEventCommand,CapabilityInvocationProposal,InvocationResult} from '@jarvis/contracts';
import {resolveReference,type SemanticScene,type ResolvedReference} from '@jarvis/scene';
export interface PerceptionItem {kind:ContextItemKind;content:unknown;privacyClass:'SENSITIVE'|'RESTRICTED';observedAt:string;confidence?:number}
export interface ReferentFocus {objectId:string;confidence:number;observedAt:string;expiresAt:string;bounds?:{x:number;y:number;width:number;height:number};monitorId?:string}
interface SelectedObservation {id:string;principalId:string;nodeId:string;region:{x:number;y:number;width:number;height:number};text:string;imageRef:string;observedAt:string;imageSha256:string}
/** Process-local, bounded derived context. Pixels are never accepted here. */
export class PerceptionContext {
 private screens=new Map<string,ScreenContext>();private points=new Map<string,Extract<VisionEventCommand['signal'],{type:'air-touch'}>['frame']>();
 private selections=new Map<string,SelectedObservation>();private resolutions=new Map<string,{principalId:string;nodeId:string;items:PerceptionItem[];at:number;focus:ReferentFocus}>();
 private sceneProvider?:(principalId:string)=>Promise<SemanticScene>;
 private sceneObservations=new Map<string,{focusedId?:string;selectedIds:string[];observedAt:string}>();
 constructor(private now=()=>Date.now()){}
 setSceneProvider(provider:(principalId:string)=>Promise<SemanticScene>){this.sceneProvider=provider;}
 observeScene(principalId:string,nodeId:string,observation:{focusedId?:string;selectedIds:string[]}){const key=this.key(principalId,nodeId);if(this.sceneObservations.size>=64&&!this.sceneObservations.has(key))this.sceneObservations.delete(this.sceneObservations.keys().next().value!);this.sceneObservations.set(key,{...structuredClone(observation),observedAt:new Date(this.now()).toISOString()});}
 private key(principalId:string,nodeId:string){return JSON.stringify([principalId,nodeId]);}
 observe(command:VisionEventCommand){
  const key=this.key(command.principalId,command.nodeId),signal=command.signal;
  if(this.screens.size>=64&&!this.screens.has(key))this.screens.delete(this.screens.keys().next().value!);
  if(signal.type==='screen-context'){const previous=this.screens.get(key);if(signal.context.source==='browser'&&previous?.source==='windows'&&this.fresh(previous.observedAt))return;this.screens.set(key,structuredClone(signal.context));}
  if(signal.type==='air-touch'){if(signal.frame.phase==='lost')this.points.delete(key);else{if(this.points.size>=64&&!this.points.has(key))this.points.delete(this.points.keys().next().value!);this.points.set(key,structuredClone(signal.frame));}}
  if(signal.type==='camera.lost')this.points.delete(key);
 }
 async capture(proposal:CapabilityInvocationProposal,result:InvocationResult,principalId:string,nodeId:string){
  if(proposal.invocation.capabilityId!=='capabilities.windows'||proposal.invocation.action!=='capture_region'||result.outcome!=='verified')return;
  if(!proposal.invocation.input||typeof proposal.invocation.input!=='object')return;
  const input=proposal.invocation.input as Record<string,unknown>,output=result.output as Record<string,unknown>|undefined;
  if(input.extractText!==true||!output||typeof output.selectedText!=='string'||output.selectedText.length>16000||typeof output.imageSha256!=='string'||!/^[a-f0-9]{64}$/.test(output.imageSha256))return;
  const region={x:Number(input.x),y:Number(input.y),width:Number(input.width),height:Number(input.height)};
  if(!Object.values(region).every(Number.isFinite)||region.width<=0||region.height<=0)return;
  const key=this.key(principalId,nodeId);if(this.selections.size>=64&&!this.selections.has(key))this.selections.delete(this.selections.keys().next().value!);
  this.selections.set(key,{id:`screen:selection:${result.invocationId}`,principalId,nodeId,region,text:output.selectedText.slice(0,8000),imageRef:`local-object://capture/${result.invocationId}`,imageSha256:output.imageSha256,observedAt:new Date(this.now()).toISOString()});
 }
 private fresh(at:string,limit=3000){const age=this.now()-Date.parse(at);return Number.isFinite(age)&&age>=-250&&age<=limit;}
 async resolve(utterance:string,principalId:string,nodeId:string):Promise<{resolution:ResolvedReference;perceptionRef?:string;clarification?:string}>{
  const key=this.key(principalId,nodeId),screen=this.screens.get(key),selection=this.selections.get(key),point=this.points.get(key);
  const scene=await this.sceneProvider?.(principalId)??{id:'empty',principalId,version:0,presentation:'DORMANT' as const,monitors:[],objects:[],updatedAt:new Date(this.now()).toISOString()};
  const current=screen&&this.fresh(screen.observedAt)?screen:undefined;
  const selected=selection&&this.fresh(selection.observedAt,120000)?selection:undefined;
  const active=current?.activeWindow,monitor=current?.monitors.find(m=>m.id===current.activeMonitorId)??current?.monitors.find(m=>m.primary);
  const cursorMonitor=current?.monitors.find(m=>current.cursor&&current.cursor.x>=m.x&&current.cursor.x<m.x+m.width&&current.cursor.y>=m.y&&current.cursor.y<m.y+m.height);
  const sceneObservation=this.sceneObservations.get(key)??current?.scene;
  const actualPoint=point&&this.fresh(point.observedAt)?point:undefined;
  const worldAffecting=/\b(fix|repair|delete|remove|execute|run|install|change|move)\b/i.test(utterance);
  const selectionMonitor=current?.monitors.find(m=>selected&&selected.region.x>=m.x&&selected.region.x<m.x+m.width);
  const resolution=resolveReference(scene,{utterance,selectedIds:sceneObservation?.selectedIds??[],focusedId:sceneObservation?.focusedId,focusObservedAt:sceneObservation?.observedAt,recentIds:[],worldAffecting,now:new Date(this.now()).toISOString(),
   ...(actualPoint?.point?{pointing:{kind:'point' as const,monitorId:actualPoint.monitorId,point:actualPoint.point,confidence:actualPoint.confidence,observedAt:actualPoint.observedAt}}:{}),
   ...(current?.cursor&&cursorMonitor?{cursor:{kind:'point' as const,monitorId:cursorMonitor.id,point:current.cursor,confidence:.8,observedAt:current.observedAt}}:{}),
   ...(active&&monitor?{activeApplication:{resourceRef:`window:${active.windowId??active.application}`,observedAt:current!.observedAt,confidence:.95,bounds:active.bounds,monitorId:monitor.id}}:{}),
   ...(selected?{screenRegion:{monitorId:selectionMonitor?.id??actualPoint?.monitorId??'primary',resourceRef:selected.id,application:active?.application,confidence:.98,observedAt:new Date(this.now()).toISOString(),bounds:selected.region}}:{})});
  if(resolution.requiresClarification)return{resolution,clarification:'Which object or selected screen region do you mean? Point at it again or explicitly select it.'};
  if(worldAffecting&&selected&&resolution.objectIds.includes(selected.id))return{resolution,clarification:'I can analyse the selected error, but a screenshot is not a repair target. Name the file or bind the active repository before a separate repair proposal.'};
  const target=resolution.objectIds[0]!,items:PerceptionItem[]=[{kind:'conversation_turn',content:{utterance},privacyClass:'SENSITIVE',observedAt:new Date(this.now()).toISOString()}];
  items.push({kind:'selected_object',content:{sceneId:scene.id,sceneVersion:scene.version,focusedId:sceneObservation?.focusedId,selectedIds:sceneObservation?.selectedIds??[],resolvedTargetId:target},privacyClass:'SENSITIVE',observedAt:new Date(this.now()).toISOString(),confidence:resolution.confidence});
  if(current){items.push({kind:'active_application',content:{monitors:current.monitors,activeWindow:current.activeWindow,cursor:current.cursor},privacyClass:'SENSITIVE',observedAt:current.observedAt});if(current.workspace)items.push({kind:'active_workspace',content:current.workspace,privacyClass:'SENSITIVE',observedAt:current.observedAt});}
  const object=scene.objects.find(o=>o.id===target);if(object)items.push({kind:'selected_object',content:{id:object.id,title:object.title,kind:object.kind,resourceRefs:object.resourceRefs},privacyClass:'SENSITIVE',observedAt:object.updatedAt,confidence:resolution.confidence});
  if(actualPoint)items.push({kind:'gesture_target',content:{targetId:target,point:actualPoint.point,monitorId:actualPoint.monitorId},privacyClass:'SENSITIVE',observedAt:actualPoint.observedAt,confidence:actualPoint.confidence});
  if(selected&&target===selected.id){if(!selected.text.trim())return{resolution,clarification:'The selected capture has no readable text. Select a clearer error region or provide the error text; I will not guess.'};items.push({kind:'selected_object',content:{id:selected.id,region:selected.region,imageRef:selected.imageRef,imageSha256:selected.imageSha256,text:selected.text},privacyClass:'RESTRICTED',observedAt:selected.observedAt,confidence:resolution.confidence});}
  else if(target.startsWith('window:'))return{resolution,clarification:'I resolved the application, but I have not read its pixels. Select the error region and approve capture_region with local text extraction before analysis.'};
  const ref=randomUUID(),focus:ReferentFocus={objectId:target,confidence:resolution.confidence,observedAt:new Date(this.now()).toISOString(),expiresAt:new Date(this.now()+2500).toISOString(),...(object?{bounds:{...object.position,...object.size},monitorId:object.monitorId}:selected?{bounds:selected.region,monitorId:selectionMonitor?.id}:{} )};
  for(const[id,value]of this.resolutions)if(this.now()-value.at>15000)this.resolutions.delete(id);if(this.resolutions.size>=64)this.resolutions.delete(this.resolutions.keys().next().value!);
  this.resolutions.set(ref,{principalId,nodeId,items,at:this.now(),focus});return{resolution,perceptionRef:ref};
 }
 items(ref:string,principalId:string){const value=this.resolutions.get(ref);if(!value||value.principalId!==principalId||this.now()-value.at>15000)throw new Error('perception context expired or not owned');return structuredClone(value.items);}
 focus(principalId:string){const values=[...this.resolutions.values()].filter(v=>v.principalId===principalId&&Date.parse(v.focus.expiresAt)>this.now());const focus=values.at(-1)?.focus;return focus?structuredClone(focus):undefined;}
}

