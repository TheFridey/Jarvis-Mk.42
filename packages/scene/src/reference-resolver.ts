import type {ReferenceContext,ResolvedReference,SemanticScene} from './types.ts';
export function resolveReference(scene:SemanticScene,context:ReferenceContext):ResolvedReference {
 const now=Date.parse(context.now),threshold=context.worldAffecting? .9:.75;
 const fresh=(at:string|undefined,limit=3000)=>Number.isFinite(now)&&at!==undefined&&Number.isFinite(Date.parse(at))&&now-Date.parse(at)>=-250&&now-Date.parse(at)<=limit;
 const valid=(confidence:number)=>Number.isFinite(confidence)&&confidence>=threshold&&confidence<=1;
 const objects=scene.objects.filter(o=>(!o.staleAfter||Date.parse(o.staleAfter)>now)&&fresh(o.updatedAt,30000));
 const candidates=new Map<string,{confidence:number;reason:string}>();
 const add=(id:string|undefined,confidence:number,reason:string)=>{if(id&&valid(confidence)){const prior=candidates.get(id);if(!prior||confidence>prior.confidence)candidates.set(id,{confidence,reason});}};
 const words=context.utterance.toLowerCase(),deictic=/\b(this|that|it|these|those)\b/.test(words);
 if(/\b(these|those)\b/.test(words)&&context.selectedIds.length&&fresh(context.focusObservedAt)){
  const ids=context.selectedIds.filter(id=>objects.some(o=>o.id===id));if(ids.length===context.selectedIds.length&&!context.worldAffecting)return{objectIds:ids,confidence:.96,reason:'explicit current selection',requiresClarification:false};
 }
 if(deictic){
  for(const[source,reference]of [['Air Touch',context.pointing],['cursor',context.cursor]] as const){
   if(!reference?.point||!fresh(reference.observedAt)||!valid(reference.confidence))continue;
   const p=reference.point,hits=objects.filter(o=>o.monitorId===reference.monitorId&&contains(o.position.x,o.position.y,o.size.width,o.size.height,p));
   // Occlusion/overlap is ambiguous; z-order alone is not user intent.
   for(const hit of hits)add(hit.id,reference.confidence,`${source} hit`);
   const region=context.screenRegion;if(region?.resourceRef&&fresh(region.observedAt)&&region.bounds&&region.monitorId===reference.monitorId&&contains(region.bounds.x,region.bounds.y,region.bounds.width,region.bounds.height,p))add(region.resourceRef,Math.min(reference.confidence,region.confidence),'pointed selected region');
   const app=context.activeApplication;if(app?.bounds&&fresh(app.observedAt)&&app.monitorId===reference.monitorId&&contains(app.bounds.x,app.bounds.y,app.bounds.width,app.bounds.height,p)&&!region?.resourceRef)add(app.resourceRef,Math.min(reference.confidence,app.confidence),'pointed active application');
  }
  if(fresh(context.focusObservedAt)){for(const id of [context.focusedId,context.hoveredId,...context.selectedIds])if(objects.some(o=>o.id===id))add(id,.94,'current interaction focus');}
  const region=context.screenRegion;if(region?.resourceRef&&fresh(region.observedAt))add(region.resourceRef,region.confidence,'explicit selected region');
  if(context.physicalObjectRef&&context.pointing&&fresh(context.pointing.observedAt))add(context.physicalObjectRef,context.pointing.confidence,'selected physical observation');
  if(fresh(context.recentObservedAt,8000)&&context.recentIds.length===1&&objects.some(o=>o.id===context.recentIds[0]))add(context.recentIds[0],.78,'recent object');
 }else{
  for(const o of objects)if(o.title.trim().length>2&&words.includes(o.title.toLowerCase()))add(o.id,.95,'explicit semantic label');
 }
 if(candidates.size!==1)return{objectIds:[],confidence:0,reason:candidates.size?'conflicting referents':'no fresh confident referent',requiresClarification:true};
 const[id,candidate]=[...candidates][0]!;return{objectIds:[id],confidence:candidate.confidence,reason:candidate.reason,requiresClarification:false};
}
const contains=(x:number,y:number,width:number,height:number,p:{x:number;y:number})=>p.x>=x&&p.x<=x+width&&p.y>=y&&p.y<=y+height;
