import { desktopRoute } from '../cognition/desktop-route.ts';
import { isPublicWebRequest } from '../cognition/public-web-request.ts';
import { cloudConversationEnabled, isCloudChatInput, needsPrivateContext } from '../cognition/conversation-scope.ts';
import { createHash } from 'node:crypto';
import type { CompanionPicture, CompanionTurn, RegisteredNode, CognitionRequest, CognitionResponse } from '@jarvis/contracts';
import type { DesktopKernelSnapshot, DesktopCognitionCommand } from '@jarvis/scene';
import type { Sql } from '@jarvis/persistence';
import { KeyedMutex } from '../../runtime/mutex.ts';

interface TurnRow { turn_id:string;conversation_id:string;principal_id:string;source_node_id:string;input:string;command_hash:string;cognition_input:string|null;response:CognitionResponse|null;answer:string|null;status:CompanionTurn['status'];created_at:string;privacy_class?:string; }
export function nextMeetingTime(p:DesktopKernelSnapshot):string|null{
  const reading=p.scalesmiths?.readings.meetings;if(reading?.status!=='available'||!Array.isArray(reading.value))return null;
  const now=Date.parse(p.generatedAt);const times=reading.value.flatMap((item:unknown)=>{if(!item||typeof item!=='object')return [];const meeting=item as {status?:string;start?:{dateTime?:string;date?:string}};if(meeting.status==='cancelled')return [];const time=meeting.start?.dateTime??meeting.start?.date;const at=typeof time==='string'?Date.parse(time):NaN;return Number.isFinite(at)&&at>=now?[at]:[];});return times.length?new Date(Math.min(...times)).toISOString():null;
}
export function companionPicture(p:DesktopKernelSnapshot,node:RegisteredNode):CompanionPicture {
  if(p.principalId!==node.principalId)throw new Error('companion principal mismatch');
  return {schemaVersion:1,surface:node.nodeType==='mobile'?'mobile':'wall',generatedAt:p.generatedAt,stateVersion:p.stateVersion,sceneVersion:p.sceneVersion,
    mode:p.systemMode,interaction:p.interactionState,work:p.workState,health:p.systemHealth.overall,
    objective:p.activeObjective?.statement.slice(0,500)??null,alerts:p.notifications.slice(-5),
    workflows:p.activeCapabilities.slice(0,5).map(a=>({id:a.invocationId,action:a.action,state:a.state})),
    agents:(p.agentJobs??[]).filter(j=>['QUEUED','LEASED','RUNNING','WAITING','BLOCKED'].includes(j.state)).slice(0,12).map(j=>({id:j.agentId,state:j.activityConfirmed?j.activityStage??j.state:j.state==='RUNNING'?'UNCONFIRMED':j.state,parentId:j.parentJobId??null})),
    // Business values, meeting titles/attendees, approvals, raw state and credentials are private.
    business:Object.entries(p.scalesmiths?.readings??{}).map(([name,r])=>({name,status:r.status})),
    nextMeeting:nextMeetingTime(p)};
}
export class CompanionService {
  private gate=new KeyedMutex();
  private snapshotPending?:Promise<DesktopKernelSnapshot>;
  private snapshot(){return this.snapshotPending??=this.d.snapshot().finally(()=>{this.snapshotPending=undefined;});}
  constructor(private d:{sql:Sql;snapshot:()=>Promise<DesktopKernelSnapshot>;cognize:(r:CognitionRequest)=>Promise<CognitionResponse>;now:()=>string;id:()=>string;invalidate:()=>void}){}
  async displays(principalId:string){const rows=await this.d.sql<{node_id:string}[]>`select node_id from nodes.registry where principal_id=${principalId} and node_type='display' and trust_tier in ('owned-mobile','owned-secure') and status='connected' order by node_id limit 16`;return rows.map(row=>({id:row.node_id}));}
  async picture(node:RegisteredNode):Promise<CompanionPicture>{
    const snapshot=await this.snapshot();const picture=companionPicture(snapshot,node);
    if(node.nodeType==='mobile'){
      picture.conversations=await this.turns(node.principalId);
      picture.sceneChoices=snapshot.scene.objects.map(o=>({id:o.id,title:o.title}));
      const displays=await this.d.sql<{node_id:string}[]>`select node_id from nodes.registry where principal_id=${node.principalId} and node_type='display' and trust_tier in ('owned-mobile','owned-secure') and status='connected' order by node_id limit 16`;
      picture.displays=displays.map(n=>({id:n.node_id}));
    }
    if(node.nodeType==='display'){
      const [selection]=await this.d.sql<{object_id:string;expires_at:string}[]>`select object_id,expires_at from experience.wall_presentations where node_id=${node.nodeId} and principal_id=${node.principalId} and expires_at>${this.d.now()}`;
      const object=selection?snapshot.scene.objects.find(o=>o.id===selection.object_id):undefined;
      if(object)picture.presented={objectId:object.id,title:object.title.slice(0,200),summary:object.kind==='jarvis-core'?`${snapshot.systemMode} · ${snapshot.workState}`:object.kind==='objective'?snapshot.activeObjective?.statement.slice(0,500)??'Objective status unavailable':object.kind==='infrastructure'?`System health: ${snapshot.systemHealth.overall}`:'Review the selected resource on a trusted personal surface',resourceRefs:object.resourceRefs.slice(0,8).map(ref=>ref.slice(0,200)),expiresAt:new Date(selection!.expires_at).toISOString()};
    }
    return picture;
  }
  async turns(principalId:string):Promise<CompanionTurn[]>{
    const rows=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where principal_id=${principalId} order by created_at desc,turn_id desc limit 20`;
    const selected:CompanionTurn[]=[];let bytes=0;
    for(const r of rows){const turn:CompanionTurn={id:r.turn_id,conversationId:r.conversation_id,input:r.input.slice(0,2000),answer:r.answer?.slice(0,4000)??null,status:r.status,sourceNodeId:r.source_node_id,createdAt:new Date(r.created_at).toISOString()};const size=Buffer.byteLength(JSON.stringify(turn));if(bytes+size>20000)break;bytes+=size;selected.push(turn);}
    return selected.reverse();
  }
  async deliverContinuation(response:CognitionResponse,parentJobId:string):Promise<CognitionResponse>{
    const [parent]=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where turn_id=${parentJobId} and principal_id=${response.principalId}`;
    if(!parent)return response;
    const delivered={...response,conversationId:parent.conversation_id};
    const hash=createHash('sha256').update(JSON.stringify([response.requestId,parentJobId])).digest('hex');
    await this.d.sql`insert into experience.conversation_turns(turn_id,conversation_id,principal_id,source_node_id,input,command_hash,answer,response,status,created_at,finished_at) values(${response.requestId},${parent.conversation_id},${response.principalId},${parent.source_node_id},${'Follow-up: '+parent.input},${hash},${response.answer??null},${JSON.stringify(delivered)},'completed',${response.createdAt},${response.result.finishedAt??this.d.now()}) on conflict(turn_id) do nothing`;
    this.d.invalidate();return delivered;
  }
  async converse(node:Pick<RegisteredNode,'nodeId'|'principalId'>,command:DesktopCognitionCommand,conversationId?:string,mobile=false){
    if(!mobile)command={...command,...desktopRoute(command.input,command)};
    const turnId=mobile?'mobile:'+createHash('sha256').update(node.nodeId+'|'+command.commandId).digest('hex'):command.commandId;
    const commandHash=createHash('sha256').update(JSON.stringify([command.input,mobile?'agents.oracle':command.agentId??'agents.oracle',mobile?'reason':command.task??'reason',mobile?'local':command.locality??'prefer-local',mobile, mobile?[]:command.preferredModels??[]])).digest('hex');
    return this.gate.run(turnId,async()=>{
      const [old]=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where turn_id=${turnId}`;
      if(old&&(old.principal_id!==node.principalId||old.source_node_id!==node.nodeId||old.command_hash!==commandHash||(conversationId&&old.conversation_id!==conversationId)))throw new Error('conversation command conflict');
      if(!old){
        const picture=await this.snapshot();if(picture.principalId!==node.principalId||picture.stateVersion!==command.expectedStateVersion)throw new Error('state version conflict');
        if(conversationId){const [owned]=await this.d.sql<{principal_id:string}[]>`select principal_id from experience.conversation_turns where conversation_id=${conversationId} limit 1`;if(!owned||owned.principal_id!==node.principalId)throw new Error('conversation not found');}
        await this.d.sql`insert into experience.conversation_turns(turn_id,conversation_id,principal_id,source_node_id,input,command_hash,status,created_at) values(${turnId},${conversationId??this.d.id()},${node.principalId},${node.nodeId},${command.input},${commandHash},'running',${this.d.now()})`;
      }
      if(old?.status==='completed')return {turnId,conversationId:old.conversation_id,answer:old.answer,...(old.response?{result:old.response}:{})};
      const [turn]=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where turn_id=${turnId}`;
      const history=await this.d.sql<TurnRow[]>`select t.*,r.privacy_class from experience.conversation_turns t left join cognition.runs r on r.request_id=t.turn_id and r.principal_id=t.principal_id where t.conversation_id=${turn!.conversation_id} and t.principal_id=${node.principalId} and t.turn_id<>${turnId} and t.status='completed' order by t.created_at desc limit 6`;
      // A recovered input may already contain private history from an older attempt.
      const publicWeb=!mobile&&(!turn!.cognition_input||turn!.cognition_input===command.input)&&isPublicWebRequest(command.input);
      const chatCloud=!mobile&&cloudConversationEnabled()&&!publicWeb&&!needsPrivateContext(command.input)&&(!turn!.cognition_input||isCloudChatInput(turn!.cognition_input,turn!.input??command.input));
      const safeHistory=chatCloud?history.filter(row=>['PUBLIC','INTERNAL'].includes(row.privacy_class??'')):history;
      const input=turn!.cognition_input??(chatCloud?JSON.stringify({conversationScope:'cloud-chat-v1',conversation:safeHistory.reverse().map(r=>({user:r.input,assistant:r.answer})),omittedPrivateHistory:safeHistory.length!==history.length,user:command.input}):history.length&&!publicWeb?JSON.stringify({conversation:history.reverse().map(r=>({user:r.input,assistant:r.answer})),user:command.input}):command.input);
      if(!turn!.cognition_input)await this.d.sql`update experience.conversation_turns set cognition_input=${input} where turn_id=${turnId}`;
      this.d.invalidate();
      try{
        // Remote text is analysis-only: it cannot inherit a local agent's execution authority.
        const response=await this.d.cognize({requestId:turnId,principalId:node.principalId,correlationId:turnId,input,currentTurnInput:turn!.input??command.input,agentId:mobile?'agents.oracle':command.agentId??'agents.oracle',task:mobile?'reason':command.task??'reason',...(!mobile&&command.preferredModels?{preferredModels:command.preferredModels}:{}),locality:command.locality??'prefer-local',...((mobile||(conversationId&&!publicWeb&&!chatCloud))?{locality:'local',cloudAllowed:false}:{}),...(publicWeb?{contextScope:'public-web' as const}:chatCloud?{contextScope:'conversation' as const,cloudAllowed:true}:{}),...(mobile?{analysisOnly:true}:{})});
        const result={...response,conversationId:turn!.conversation_id};
        await this.d.sql`update experience.conversation_turns set answer=${result.answer??null},response=${JSON.stringify(result)},status='completed',finished_at=${this.d.now()} where turn_id=${turnId}`;
        this.d.invalidate();return {turnId,conversationId:turn!.conversation_id,answer:result.answer??null,result};
      }catch(error){await this.d.sql`update experience.conversation_turns set status='failed',finished_at=${this.d.now()} where turn_id=${turnId}`;this.d.invalidate();throw error;}
    });
  }
  async present(node:Pick<RegisteredNode,'principalId'>,input:{displayNodeId:string;objectId:string;expectedSceneVersion:number}){
    const snapshot=await this.snapshot();if(snapshot.principalId!==node.principalId||snapshot.sceneVersion!==input.expectedSceneVersion)throw new Error('scene version conflict');
    const object=snapshot.scene.objects.find(o=>o.id===input.objectId);if(!object)throw new Error('scene resource not found');
    const expiresAt=new Date(Date.parse(this.d.now())+60000).toISOString();
    const changed=await this.d.sql`insert into experience.wall_presentations(node_id,principal_id,object_id,scene_version,expires_at) select node_id,${node.principalId},${object.id},${snapshot.sceneVersion},${expiresAt} from nodes.registry where node_id=${input.displayNodeId} and principal_id=${node.principalId} and node_type='display' and trust_tier in ('owned-mobile','owned-secure') and status='connected' on conflict(node_id) do update set object_id=excluded.object_id,scene_version=excluded.scene_version,expires_at=excluded.expires_at returning node_id`;
    if(!changed.length)throw new Error('display unavailable');this.d.invalidate();return {objectId:object.id,expiresAt};
  }
}
