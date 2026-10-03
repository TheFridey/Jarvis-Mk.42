import { createHash } from 'node:crypto';
import type { AgentId, BusinessReading, CapabilityInvocationProposal, CognitionResponse, InvocationResult, KnowledgeIngestion, NovaBriefing, ScaleSmithsOperatingPicture } from '@jarvis/contracts';
import type { AgencyIngress } from '../agency-ingress/agency-ingress.ts';
import type { ObjectiveEngine } from '../objective/objective-engine.ts';
import type { ContextCompiler } from '../context/context-compiler.ts';
import { areas } from '../../../../../capabilities/scalesmiths/definition.ts';
import { scalePageSchema, type ScalePage } from './transport.ts';

const fields = ['MRR','activeRetainers','activeProjects','pipeline','proposalValue','unpaidInvoices','recentPayments','followUps','meetings','productionIncidents','clientAlerts','recentReviews','seoAnalyticsSignals'];
type Snapshot = { data: unknown; at: string; ref: string; failed?: boolean; sourceRefs?: string[] };
type Checkpoint = { capability: string; action: string; input: unknown; value?: unknown; outcome?: string; ref?: string; fetchedAt?: string };
export class BusinessIntelligence {
  private readonly snapshots = new Map<string, Map<string, Snapshot>>();
  constructor(private readonly d: { agency: AgencyIngress; knowledge: KnowledgeIngestion; objectives: ObjectiveEngine; context: ContextCompiler; nodeId: string; now:()=>string; id:()=>string; specialist?:(input:{agentId:AgentId;principalId:string;objectiveId:string;instruction:string;correlationId:string})=>Promise<CognitionResponse> }) {}
  async coordinate(principalId:string,objectiveId:string,agentId:AgentId,instruction:string,correlationId:string){
    if(!['agents.hermes','agents.scout','agents.prometheus','agents.atlas','agents.mnemosyne'].includes(agentId))throw new Error('Specialist not in Nova grouping');
    const objective=await this.d.objectives.get(objectiveId);if(!objective||objective.principalId!==principalId||!objective.desiredState.nova)throw new Error('Nova objective principal mismatch');
    if(!this.d.specialist)throw new Error('Specialist runtime unavailable');
    return this.d.specialist({principalId,objectiveId,agentId,instruction,correlationId});
  }
  async capture(proposal: CapabilityInvocationProposal, result: InvocationResult, principalId: string) {
    const provider = proposal.invocation.capabilityId.replace('capabilities.','');
    if(!['email','calendar','scalesmiths'].includes(provider) || result.outcome !== 'verified')return;
    const data = (result.output as { data?: unknown })?.data;
    if(data === undefined)return;
    const at = this.d.now(), ref = `invocation:${result.invocationId}`;
    const action = proposal.invocation.action;
    if(provider === 'scalesmiths') {
      const page = scalePageSchema.parse(data);
      for(const entity of page.records) await this.d.knowledge.ingest({
        kind:'extracted_fact', principalId, correlationId:proposal.correlationId, privacyHint:entity.privacy,
        provenance:{method:'retrieval',producedBy:proposal.invocation.capabilityId,producedOn:this.d.nodeId,producedAt:at,correlationId:proposal.correlationId,derivedFromUntrusted:true,sourceRefs:[ref,entity.sourceRef]},
        fact:{subjectRef:`scalesmiths:${entity.entityType}:${entity.id}`,entityType:entity.entityType,attribute:'service_snapshot',value:entity.attributes,epistemicStatus:'retrieved',confidence:entity.confidence,validFrom:entity.observedAt,validTo:entity.validTo??new Date(Date.parse(entity.observedAt)+15*60_000).toISOString(),evidenceRefs:[ref,entity.sourceRef]},
      });
    }
    if(provider === 'calendar' && action === 'events.read') {
      const calendarData=data as {items?:Array<Record<string,unknown>>;id?:string};
      const meetings=calendarData.items??(calendarData.id?[calendarData as Record<string,unknown>]:[]);
      for(const meeting of meetings)if(typeof meeting.id==='string')await this.d.knowledge.ingest({kind:'extracted_fact',principalId,correlationId:proposal.correlationId,privacyHint:'RESTRICTED',provenance:{method:'retrieval',producedBy:proposal.invocation.capabilityId,producedOn:this.d.nodeId,producedAt:at,correlationId:proposal.correlationId,derivedFromUntrusted:true,sourceRefs:[ref]},fact:{subjectRef:`calendar:meeting:${meeting.id}`,entityType:'meeting',attribute:'meeting_snapshot',value:{summary:meeting.summary,start:meeting.start,end:meeting.end,status:meeting.status,attendees:meeting.attendees},epistemicStatus:'retrieved',confidence:1,validFrom:at,validTo:new Date(Date.parse(at)+15*60_000).toISOString(),evidenceRefs:[ref]}});
    }
    if(provider === 'email' && ['read','thread.read'].includes(action)) {
      const mail=data as {messages?:Array<Record<string,unknown>>;id?:string};
      for(const message of mail.messages??(mail.id?[mail as Record<string,unknown>]:[]))if(typeof message.id==='string')await this.d.knowledge.ingest({kind:'extracted_fact',principalId,correlationId:proposal.correlationId,privacyHint:'RESTRICTED',provenance:{method:'retrieval',producedBy:proposal.invocation.capabilityId,producedOn:this.d.nodeId,producedAt:at,correlationId:proposal.correlationId,derivedFromUntrusted:true,sourceRefs:[ref]},fact:{subjectRef:`gmail:contact-history:${message.id}`,entityType:'contact',attribute:'message_metadata',value:{threadId:message.threadId,internalDate:message.internalDate,headers:(message.payload as {headers?:unknown}|undefined)?.headers},epistemicStatus:'retrieved',confidence:1,validFrom:at,validTo:new Date(Date.parse(at)+15*60_000).toISOString(),evidenceRefs:[ref]}});
    }
    const cache = this.snapshots.get(principalId) ?? new Map<string,Snapshot>();
    // Individual/client-filtered pages never replace whole-business totals.
    const input = proposal.invocation.input as Record<string,unknown>;
    if(provider === 'scalesmiths' && (input.id || input.clientId || input.cursor || action.endsWith('.update')))return;
    if(provider === 'calendar' && (action !== 'events.read' || input.eventId || input.pageToken))return;
    if(provider === 'email')return; // mailbox contents never become global business context
    const observedAt=provider==='scalesmiths'?scalePageSchema.parse(data).records.reduce((old,row)=>Date.parse(row.observedAt)<Date.parse(old)?row.observedAt:old,at):at;
    cache.set(`${provider}.${action}`,{data,at:observedAt,ref,sourceRefs:provider==='scalesmiths'?scalePageSchema.parse(data).records.map(row=>row.sourceRef):[]});this.snapshots.set(principalId,cache);
  }
  picture(principalId: string): ScaleSmithsOperatingPicture {
    const readings:Record<string,BusinessReading> = Object.fromEntries(fields.map(name=>[name,{status:'unavailable',sourceRefs:[],privacy:'RESTRICTED'}]));
    const cache = this.snapshots.get(principalId);
    const assign = (name:string,snapshot:Snapshot,value:unknown,complete=true) => { readings[name]={status:snapshot.failed||Date.parse(this.d.now())-Date.parse(snapshot.at)>15*60_000?'stale':complete?'available':'partial',value,observedAt:snapshot.at,sourceRefs:[snapshot.ref,...(snapshot.sourceRefs??[])],privacy:'RESTRICTED'}; };
    const page = (area:string):[Snapshot,ScalePage]|undefined => {const s=cache?.get(`scalesmiths.${area}.read`);return s?[s,scalePageSchema.parse(s.data)]:undefined;};
    const list = (area:string,name:string,predicate:(v:Record<string,unknown>)=>boolean=()=>true) => {const p=page(area);if(p)assign(name,p[0],p[1].records.map(r=>({id:r.id,...r.attributes,sourceRef:r.sourceRef})).filter(predicate),p[1].complete);};
    list('retainers','activeRetainers',v=>v.status==='active');list('projects','activeProjects',v=>v.status==='active');
    list('leads','pipeline',v=>!['won','lost'].includes(String(v.status)));list('invoices','unpaidInvoices',v=>['unpaid','overdue','part_paid'].includes(String(v.status)));list('payments','recentPayments',v=>typeof v.paidAt==='string'&&Number.isFinite(Date.parse(v.paidAt))&&Date.parse(v.paidAt)>=Date.parse(this.d.now())-30*24*60*60_000&&Date.parse(v.paidAt)<=Date.parse(this.d.now()));
    list('leads','followUps',v=>typeof v.nextFollowUpAt==='string'&&Number.isFinite(Date.parse(v.nextFollowUpAt))&&Date.parse(v.nextFollowUpAt)<=Date.parse(this.d.now()));
    const retainers=page('retainers');
    if(retainers?.[1].complete) { const active=retainers[1].records.filter(r=>r.attributes.status==='active'); const totals:Record<string,number>={}; let valid=retainers[1].records.every(r=>['active','inactive','paused','cancelled','expired','pending'].includes(String(r.attributes.status)));
      for(const row of active) {const a=row.attributes;if(a.period!=='month'||typeof a.amountMinor!=='number'||!Number.isSafeInteger(a.amountMinor)||a.amountMinor<0||typeof a.currency!=='string'){valid=false;break;}totals[a.currency]=(totals[a.currency]??0)+a.amountMinor;}
      if(valid)assign('MRR',retainers[0],{amountMinorByCurrency:totals});
    }
    const proposals=page('proposals');if(proposals?.[1].complete){const totals:Record<string,number>={};let valid=proposals[1].records.every(r=>['draft','sent','pending','open','accepted','rejected','expired','withdrawn'].includes(String(r.attributes.status)));for(const row of proposals[1].records){const a=row.attributes;if(!['sent','pending','open'].includes(String(a.status)))continue;if(typeof a.amountMinor!=='number'||!Number.isSafeInteger(a.amountMinor)||a.amountMinor<0||typeof a.currency!=='string'){valid=false;break;}totals[a.currency]=(totals[a.currency]??0)+a.amountMinor;}if(valid)assign('proposalValue',proposals[0],{amountMinorByCurrency:totals});}
    for(const area of areas){const p=page(area);if(p?.[1].signals)for(const [name,value] of Object.entries(p[1].signals))if(fields.includes(name))assign(name,p[0],value,p[1].complete);}
    const meetings=cache?.get('calendar.events.read');if(meetings){const data=meetings.data as {items?:unknown[];nextPageToken?:string};assign('meetings',meetings,data.items??[],!data.nextPageToken);}
    return {principalId,generatedAt:this.d.now(),readings};
  }
  async refresh(principalId:string,correlationId:string) {
    const timeMin=this.d.now(),timeMax=new Date(Date.parse(timeMin)+24*60*60_000).toISOString();
    const reads=[...areas.map(area=>({capability:'scalesmiths',action:`${area}.read`,input:{limit:100}})),{capability:'calendar',action:'events.read',input:{calendarId:'primary',timeMin,timeMax}}];
    const unavailable:string[]=[];
    // Bound concurrent upstream load; each read still has its own Executor authority.
    for(let i=0;i<reads.length;i+=3) {const group=reads.slice(i,i+3);const results=await Promise.allSettled(group.map(read=>this.read(principalId,correlationId,this.d.id(),read)));for(let j=0;j<results.length;j++){const result=results[j]!;if(result.status==='rejected'||result.value.outcome!=='verified'){const read=group[j]!;unavailable.push(read.action);const old=this.snapshots.get(principalId)?.get(`${read.capability}.${read.action}`);if(old)old.failed=true;}}}
    return {picture:this.picture(principalId),unavailable};
  }
  async answer(principalId:string,text:string,correlationId:string):Promise<string|undefined> {
    if(/\bprepare\b.*\bmeeting\b/i.test(text)) {
      const timeMin=this.d.now(),timeMax=new Date(Date.parse(timeMin)+24*60*60_000).toISOString();
      const upcoming=await this.read(principalId,correlationId,this.d.id(),{capability:'calendar',action:'events.read',input:{calendarId:'primary',timeMin,timeMax}});
      if(upcoming.outcome!=='verified')return `Calendar unavailable (${upcoming.outcome}); meeting preparation requires a verified calendar event.`;
      const data=(upcoming.output as {data:{items?:Array<{id:string;summary?:string;attendees?:Array<{email?:string;self?:boolean}>}>;nextPageToken?:string}}).data;
      const id=text.match(/\bmeeting\s+id[:= ]+([a-zA-Z0-9_-]+)/i)?.[1];
      const meetings=data.items??[];
      const selected=id?meetings.find(meeting=>meeting.id===id):!data.nextPageToken&&meetings.length===1?meetings[0]:undefined;
      if(!selected)return `Specify a meeting ID for preparation. Verified upcoming meetings: ${JSON.stringify(meetings.map(meeting=>({id:meeting.id,summary:meeting.summary})))}`;
      const contacts=(selected.attendees??[]).filter(a=>!a.self&&a.email);const contactEmail=contacts.length===1?contacts[0]!.email:undefined;
      const briefing=await this.createMeeting(principalId,{calendarId:'primary',eventId:selected.id,...(contactEmail?{contactEmail}:{}),...(text.match(/\bclient\s+id[:= ]+([a-zA-Z0-9_-]+)/i)?.[1]?{clientId:text.match(/\bclient\s+id[:= ]+([a-zA-Z0-9_-]+)/i)![1]}:{})},correlationId);
      return `Meeting briefing (${briefing.status}), objective ${briefing.objectiveId}. Missing sources: ${briefing.unavailable.join(', ')||'none'}.\n${JSON.stringify(briefing.sections)}`;
    }
    if(/\bchanged with\b/i.test(text)){const clientId=text.match(/\bclient\s+id[:= ]+([a-zA-Z0-9_-]+)/i)?.[1];if(clientId)return JSON.stringify(await this.clientHistory(principalId,clientId,correlationId));return 'Provide the ScaleSmiths client ID to retrieve current client data and relevant recorded history through /desktop/nova/client.';}
    if(!/\b(morning|situation|following up|follow.up|gone cold|meetings|outstanding)\b/i.test(text))return;
    const {picture}=await this.refresh(principalId,correlationId);
    let names=fields;
    if(/follow/i.test(text))names=['followUps'];else if(/meetings/i.test(text))names=['meetings'];else if(/outstanding/i.test(text))names=['unpaidInvoices'];else if(/gone cold/i.test(text)) {
      const pipeline=picture.readings.pipeline!;if(Array.isArray(pipeline.value))pipeline.value=pipeline.value.filter((lead:Record<string,unknown>)=>!['won','lost'].includes(String(lead.status))&&typeof lead.lastContactAt==='string'&&Number.isFinite(Date.parse(lead.lastContactAt))&&Date.parse(this.d.now())-Date.parse(lead.lastContactAt)>=14*24*60*60_000);
      names=['pipeline'];
    }
    return `ScaleSmiths situation as of ${picture.generatedAt}.${/gone cold/i.test(text)?' Cold means no recorded contact for at least 14 days; leads without a contact date cannot be classified.':''}\n`+names.map(name=>{const r=picture.readings[name]!;return `${name}: ${r.status}${r.value===undefined?'':` — ${JSON.stringify(r.value)}`} (${r.sourceRefs.join(', ')||'no source'}).`;}).join('\n');
  }
  async clientHistory(principalId:string,clientId:string,correlationId:string){
    const latest=await this.read(principalId,correlationId,this.d.id(),{capability:'scalesmiths',action:'clients.read',input:{id:clientId,limit:100}});
    const memory=await this.d.context.compile({principalId,correlationId,intent:`What changed with scalesmiths:client:${clientId}? Compare recorded evidence with the current client snapshot; do not infer missing history.`,intentClass:'client_history',focusRefs:[`scalesmiths:client:${clientId}`],budgetUnits:8000,maxPrivacyClass:'RESTRICTED'});
    return {privacy:'RESTRICTED',latest:latest.outcome==='verified'?latest.output:undefined,outcome:latest.outcome,recordedHistory:memory.items,unknowns:memory.unknowns,sourceRefs:[`invocation:${latest.invocationId}`]};
  }
  async createMeeting(principalId:string,input:{calendarId:string;eventId:string;clientId?:string;contactEmail?:string;threadId?:string},correlationId:string) {
    const objective=await this.d.objectives.create({principalId,correlationId,origin:'principal',statement:`Prepare meeting ${input.eventId}`,constraints:['read-only','principal-bound','restricted briefing','missing sources remain unknown'],provenance:{method:'assertion',producedBy:principalId,producedOn:this.d.nodeId,producedAt:this.d.now(),correlationId,derivedFromUntrusted:false},desiredState:{nova:{schemaVersion:1,input,checkpoints:[],privacy:'RESTRICTED'}}});
    await this.d.objectives.transition(objective.id,'active','meeting preparation requested');return this.resumeMeeting(principalId,objective.id);
  }
  async resumeMeeting(principalId:string,objectiveId:string):Promise<NovaBriefing> {
    return this.d.objectives.exclusive(objectiveId,principalId,async()=>{
      let objective=await this.d.objectives.get(objectiveId);if(!objective||objective.principalId!==principalId)throw new Error('Meeting objective unavailable');
      const state=objective.desiredState.nova as {schemaVersion:number;input:{calendarId:string;eventId:string;clientId?:string;contactEmail?:string;threadId?:string};checkpoints:Checkpoint[];briefing?:NovaBriefing};
      if(state?.schemaVersion!==1)throw new Error('Not a Nova objective');if(state.briefing&&objective.status==='achieved')return state.briefing;
      if(!['active','blocked'].includes(objective.status))throw new Error('Objective is not runnable');if(objective.status==='blocked')objective=await this.d.objectives.transition(objectiveId,'active','retry missing sources');
      const input=state.input,timeMin=this.d.now(),timeMax=new Date(Date.parse(timeMin)+30*24*60*60_000).toISOString();
      const requested:Checkpoint[]=[{capability:'calendar',action:'events.read',input:{calendarId:input.calendarId,eventId:input.eventId,timeMin,timeMax}}];
      for(const area of ['clients','projects','tasks','analytics','proposals','invoices','deployments','caseStudies'])if(input.clientId)requested.push({capability:'scalesmiths',action:`${area}.read`,input:{...(area==='clients'?{id:input.clientId}:{clientId:input.clientId}),limit:100}});
      if(input.contactEmail)requested.push({capability:'email',action:'search',input:{query:`from:${input.contactEmail} OR to:${input.contactEmail}`,limit:50}});
      if(input.threadId)requested.push({capability:'email',action:'thread.read',input:{threadId:input.threadId}});
      const checkpoints=state.checkpoints??[];
      const fresh=(checkpoint:Checkpoint)=>checkpoint.outcome==='verified'&&!!checkpoint.fetchedAt&&Date.parse(this.d.now())-Date.parse(checkpoint.fetchedAt)<15*60_000;
      for(const read of requested){if(checkpoints.some(c=>c.action===read.action&&fresh(c)))continue;
        const proposalId=createHash('sha256').update(`${objectiveId}:${read.capability}:${read.action}:${this.d.id()}`).digest('hex');
        try{const result=await this.read(principalId,objective.correlationId,proposalId,read);read.outcome=result.outcome;read.ref=`invocation:${result.invocationId}`;if(result.outcome==='verified'){read.value=result.output;read.fetchedAt=this.d.now();}}catch{read.outcome='failed';}
        const old=checkpoints.findIndex(c=>c.action===read.action);if(old>=0)checkpoints.splice(old,1);checkpoints.push(read);
        await this.d.objectives.update(objectiveId,{desiredState:{...objective.desiredState,nova:{...state,checkpoints}},nextActions:requested.filter(r=>!checkpoints.some(c=>c.action===r.action&&c.outcome==='verified')).map(r=>r.action)});
      }
      // Search provides real thread references. Read a bounded set; never invent a contact/thread join.
      if(input.contactEmail&&!input.threadId){
        const search=(checkpoints.find(c=>c.action==='search'&&c.outcome==='verified')?.value as {data?:{messages?:Array<{threadId?:string}>}}|undefined)?.data;
        const threads=[...new Set((search?.messages??[]).flatMap(message=>message.threadId?[message.threadId]:[]))].slice(0,5);
        for(const threadId of threads){const key=`thread.read:${threadId}`;if(checkpoints.some(c=>c.action===key&&fresh(c)))continue;
          const read:Checkpoint={capability:'email',action:'thread.read',input:{threadId}};try{const result=await this.read(principalId,objective.correlationId,this.d.id(),read);read.outcome=result.outcome;read.ref=`invocation:${result.invocationId}`;if(result.outcome==='verified'){read.value=result.output;read.fetchedAt=this.d.now();}}catch{read.outcome='failed';}read.action=key;
          const old=checkpoints.findIndex(c=>c.action===key);if(old>=0)checkpoints.splice(old,1);checkpoints.push(read);await this.d.objectives.update(objectiveId,{desiredState:{...objective.desiredState,nova:{...state,checkpoints}}});
        }
      }
      const memory=await this.d.context.compile({principalId,correlationId:objective.correlationId,intent:`Prepare meeting ${input.eventId} for ${input.clientId??input.contactEmail??'unknown contact'}`,intentClass:'meeting_preparation',budgetUnits:8000,maxPrivacyClass:'RESTRICTED'});
      const unavailable=checkpoints.filter(c=>c.outcome!=='verified').map(c=>c.action);
      for(const checkpoint of checkpoints){const data=(checkpoint.value as {data?:Record<string,unknown>}|undefined)?.data;if(data?.complete===false||data?.nextPageToken)unavailable.push(`${checkpoint.action}: more pages available`);}
      const client=(checkpoints.find(c=>c.action==='clients.read')?.value as {data?:ScalePage}|undefined)?.data;if(input.clientId&&client&&!client.records.some(row=>row.id===input.clientId))unavailable.push('client not found');
      if(!input.clientId)unavailable.push('client link');if(!input.contactEmail&&!input.threadId)unavailable.push('contact history');if(!checkpoints.some(c=>c.action.startsWith('thread.read')&&c.outcome==='verified'))unavailable.push('email thread');
      const briefing:NovaBriefing={objectiveId,status:unavailable.length?'partial':'complete',generatedAt:this.d.now(),sections:{...Object.fromEntries(checkpoints.filter(c=>c.outcome==='verified').map(c=>[c.action,briefSection(c.value)])),relevantMemory:memory.items},unavailable,privacy:'RESTRICTED',sourceRefs:checkpoints.flatMap(c=>c.ref?[c.ref]:[])};
      await this.d.objectives.update(objectiveId,{desiredState:{...objective.desiredState,nova:{...state,checkpoints,briefing}},nextActions:unavailable});
      await this.d.objectives.transition(objectiveId,unavailable.length?'blocked':'achieved',unavailable.length?'briefing has missing sources':'briefing assembled from verified sources');return briefing;
    });
  }
  private read(principalId:string,correlationId:string,proposalId:string,read:Pick<Checkpoint,'capability'|'action'|'input'>) {
    return this.d.agency.submitOnce({proposalId,kind:'capability_invocation',correlationId,confidence:1,provenance:{method:'system',producedBy:'nova',producedOn:this.d.nodeId,producedAt:this.d.now(),correlationId,derivedFromUntrusted:false},invocation:{capabilityId:`capabilities.${read.capability}`,capabilityVersion:'2.0.0',action:read.action,input:read.input},justification:`Nova read-only evidence gathering: ${read.action}`},{principalId,authenticated:true});
  }
}
function briefSection(value:unknown):unknown {
  const data=(value as {data?:Record<string,unknown>}|undefined)?.data;if(!data)return value;
  if(Array.isArray(data.messages))return data.messages.map((message:Record<string,unknown>)=>({id:message.id,threadId:message.threadId,date:message.internalDate,snippet:message.snippet,headers:(message.payload as {headers?:unknown}|undefined)?.headers}));
  if(Array.isArray(data.records))return {records:data.records,complete:data.complete};
  return data;
}
