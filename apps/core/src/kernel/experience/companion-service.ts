import { categoryHintFor, memoryContextLines, recallDiagnostics, rememberRequest, selectMemories } from './personal-memory.ts';
import type { PersonalMemoryStore } from './personal-memory-store.ts';
import type { DomainService } from '../domains/domain-service.ts';
import { currentDomainScope, domainFor, domainReadSql } from '../domains/scope.ts';
import { desktopRoute } from '../cognition/desktop-route.ts';
import { isPublicWebRequest } from '../cognition/public-web-request.ts';
import { createHash } from 'node:crypto';
import type { CompanionPicture, CompanionTurn, RegisteredNode, CognitionRequest, CognitionResponse } from '@jarvis/contracts';
import type { DesktopKernelSnapshot, DesktopCognitionCommand } from '@jarvis/scene';
import type { Sql } from '@jarvis/persistence';
import { KeyedMutex } from '../../runtime/mutex.ts';
import { CONVERSATION_POLICY_VERSION, classificationForTurn, evaluateConversationGrant, isCloudCeiling, type ConversationGrant, type ConversationTurn } from './conversation-privacy.ts';

interface TurnRow { privacy_class?:string|null;privacy_regime?:string; domain_id:string; turn_id:string;conversation_id:string;principal_id:string;source_node_id:string;input:string;command_hash:string;cognition_input:string|null;response:CognitionResponse|null;answer:string|null;status:CompanionTurn['status'];created_at:string; }
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
  constructor(private d:{domains?:DomainService;sql:Sql;snapshot:()=>Promise<DesktopKernelSnapshot>;cognize:(r:CognitionRequest)=>Promise<CognitionResponse>;now:()=>string;id:()=>string;invalidate:()=>void;memory?:PersonalMemoryStore}){}
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
    const rows=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where ${domainReadSql(this.d.sql,'conversation_turns')} and principal_id=${principalId} and domain_id=${domainFor(principalId)} order by created_at desc,turn_id desc limit 20`;
    const selected:CompanionTurn[]=[];let bytes=0;
    for(const r of rows){const turn:CompanionTurn={id:r.turn_id,domainId:r.domain_id,conversationId:r.conversation_id,input:r.input.slice(0,2000),answer:r.answer?.slice(0,4000)??null,status:r.status,sourceNodeId:r.source_node_id,createdAt:new Date(r.created_at).toISOString()};const size=Buffer.byteLength(JSON.stringify(turn));if(bytes+size>20000)break;bytes+=size;selected.push(turn);}
    return selected.reverse();
  }
  async deliverContinuation(response:CognitionResponse,parentJobId:string):Promise<CognitionResponse>{
    const [parent]=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where domain_id=${domainFor(response.principalId)} and turn_id=${parentJobId} and principal_id=${response.principalId}`;
    if(!parent)return response;
    const delivered={...response,conversationId:parent.conversation_id};
    const hash=createHash('sha256').update(JSON.stringify([response.requestId,parentJobId])).digest('hex');
    await this.d.sql`insert into experience.conversation_turns(turn_id,conversation_id,principal_id,source_node_id,input,command_hash,answer,response,status,created_at,finished_at,domain_id) values(${response.requestId},${parent.conversation_id},${response.principalId},${parent.source_node_id},${'Follow-up: '+parent.input},${hash},${response.answer??null},${JSON.stringify(delivered)},'completed',${response.createdAt},${response.result.finishedAt??this.d.now()},${parent.domain_id}) on conflict(turn_id) do nothing`;
    this.d.invalidate();return delivered;
  }
  async converse(node:Pick<RegisteredNode,'nodeId'|'principalId'>,command:DesktopCognitionCommand,conversationId?:string,mobile=false){if(!mobile)command={...command,...desktopRoute(command.input,command)};return this.d.domains?this.d.domains.run(node.principalId,{...command,nodeId:node.nodeId,domainPurpose:command.task==='code'?'coding':isPublicWebRequest(command.input)?'research':command.domainPurpose},mobile?'mobile:'+createHash('sha256').update(node.nodeId+'|'+command.commandId).digest('hex'):command.commandId,()=>this.converseInner(node,command,conversationId,mobile)):this.converseInner(node,command,conversationId,mobile);}
  private async converseInner(node:Pick<RegisteredNode,'nodeId'|'principalId'>,command:DesktopCognitionCommand,conversationId?:string,mobile=false){
    if(!mobile)command={...command,...desktopRoute(command.input,command)};
    const turnId=mobile?'mobile:'+createHash('sha256').update(node.nodeId+'|'+command.commandId).digest('hex'):command.commandId;
    const commandHash=createHash('sha256').update(JSON.stringify([command.input,mobile?'agents.oracle':command.agentId??'agents.oracle',mobile?'reason':command.task??'reason',mobile?'local':command.locality??'prefer-local',mobile, mobile?[]:command.preferredModels??[],domainFor(node.principalId),currentDomainScope()?.purpose??'general',command.sourceDomainIds??[],command.fusionGrantIds??[]])).digest('hex');
    return this.gate.run(turnId,async()=>{
      const [old]=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where turn_id=${turnId}`;
      if(old&&(old.domain_id!==domainFor(node.principalId)||old.principal_id!==node.principalId||old.source_node_id!==node.nodeId||old.command_hash!==commandHash||(conversationId&&old.conversation_id!==conversationId)))throw new Error('conversation command conflict');
      if(!old){
        const picture=await this.snapshot();if(picture.principalId!==node.principalId||picture.stateVersion!==command.expectedStateVersion)throw new Error('state version conflict');
        if(conversationId){const [owned]=await this.d.sql<{principal_id:string;domain_id:string}[]>`select principal_id,domain_id from experience.conversation_turns where conversation_id=${conversationId} limit 1`;
        if(!owned){
          // A brand-new id is only acceptable when an explicit grant already exists for
          // it: that is how an authorised cloud conversation begins. Otherwise the id is
          // simply not this principal's conversation.
          const [fresh]=await this.d.sql<{grant_id:string}[]>`select grant_id from experience.conversation_grants where conversation_id=${conversationId} and principal_id=${node.principalId} and revoked_at is null limit 1`;
          if(!fresh)throw new Error('conversation not found');
        } else if(owned.principal_id!==node.principalId||owned.domain_id!==domainFor(node.principalId))throw new Error('conversation not found');}
        await this.d.sql`insert into experience.conversation_turns(turn_id,conversation_id,principal_id,source_node_id,input,command_hash,status,created_at,domain_id) values(${turnId},${conversationId??this.d.id()},${node.principalId},${node.nodeId},${command.input},${commandHash},'running',${this.d.now()},${domainFor(node.principalId)})`;
      }
      if(old?.status==='completed')return {turnId,conversationId:old.conversation_id,answer:old.answer,...(old.response?{result:old.response}:{})};
      const [turn]=await this.d.sql<TurnRow[]>`select * from experience.conversation_turns where turn_id=${turnId}`;
      // Every completed turn of this conversation, oldest first, with the classification
      // and regime it was produced under. The policy needs the whole conversation: one
      // sensitive turn blocks cloud for the rest of it.
      const priorTurns=await this.d.sql<TurnRow[]>`select turn_id,conversation_id,principal_id,input,answer,status,privacy_class,privacy_regime,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at from experience.conversation_turns where conversation_id=${turn!.conversation_id} and principal_id=${node.principalId} and turn_id<>${turnId} and status='completed' order by created_at asc`;
      // A recovered input may already contain private history from an older attempt.
      const publicWeb=!mobile&&(!turn!.cognition_input||turn!.cognition_input===command.input)&&isPublicWebRequest(command.input);
      const decision=publicWeb||mobile?undefined:await this.grantDecision(node.principalId,turn!.conversation_id,turnId);
      const allowed=new Set(decision?.allow?decision.contextTurns.map(entry=>entry.createdAt):[]);
      // Cloud turns carry only the turns written under the grant; a private (or ungranted)
      // conversation keeps the existing local behaviour of the last six turns.
      const history=(decision?.allow?priorTurns.filter(r=>allowed.has(r.created_at)):priorTurns).slice(-6);
      // Approved memory, filtered for where this turn will actually run. Relevance decides:
      // a greeting retrieves nothing, and a private record never reaches a cloud turn.
      const memoryRecords = this.d.memory ? await this.d.memory.loadForSelection(node.principalId) : [];
      const memoryFor = (locality: 'local' | 'cloud'): string => {
        if (!memoryRecords.length) return '';
        const { selected } = selectMemories({ records: memoryRecords, query: command.input, principalId: node.principalId, locality, categories: categoryHintFor(command.input) });
        if (!selected.length) return '';
        return ['', '', 'Approved context about the owner (use only where relevant; never recite it):', ...memoryContextLines(selected)].join(String.fromCharCode(10));
      };
      const memoryLocal = memoryFor('local');
      const memoryCloud = memoryFor('cloud');
      const input=turn!.cognition_input??(history.length&&!publicWeb?JSON.stringify({conversation:history.map(r=>({user:r.input,assistant:r.answer})),user:command.input}):command.input);
      if(!turn!.cognition_input)await this.d.sql`update experience.conversation_turns set cognition_input=${input} where turn_id=${turnId}`;
      this.d.invalidate();
      try{
        // Remote text is analysis-only: it cannot inherit a local agent's execution authority.
        // Revalidate at the dispatch boundary: a grant that is still valid does not mean a
      // particular memory is still eligible. Re-select from fresh rows so a revocation, deletion
      // or supersession that landed during compilation cannot be transmitted.
      const memoryVerified = await (async (): Promise<string> => {
        if (!this.d.memory) return decision?.allow ? memoryCloud : memoryLocal;
        const fresh = await this.d.memory.loadForSelection(node.principalId);
        const { selected } = selectMemories({ records: fresh, query: command.input, principalId: node.principalId, locality: decision?.allow ? 'cloud' : 'local', categories: categoryHintFor(command.input) });
        if (process.env.JARVIS_MEMORY_TRACE === '1') {
          // Counts only — never a statement. Enough to tell a principal mismatch from an empty
          // table from an irrelevance decision, which is the difference this defect hid behind.
          const diag = recallDiagnostics({ records: fresh, query: command.input, principalId: node.principalId, locality: decision?.allow ? 'cloud' : 'local' });
          process.stderr.write(JSON.stringify({ component: 'memory_recall', correlationId: turnId, principalId: node.principalId, locality: decision?.allow ? 'cloud' : 'local', ...diag }) + String.fromCharCode(10));
        }
        if (!selected.length) return '';
        return ['', '', 'Approved context about the owner (use only where relevant; never recite it):', ...memoryContextLines(selected)].join(String.fromCharCode(10));
      })();
      // An explicit "remember this" creates a pending candidate — never an approval, and never a
      // claim of storage the Kernel did not make.
      const recall = rememberRequest(command.input);
      if (recall && this.d.memory) {
        await this.d.memory.propose({ id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, principalId: node.principalId, category: 'preference', subject: 'Owner stated preference', statement: recall, source: 'conversation-request', confidence: 0.9, privacyClass: 'SENSITIVE', cloudEligible: false });
      }
      const response=await this.d.cognize({requestId:turnId,domainId:domainFor(node.principalId),domainPurpose:currentDomainScope()?.purpose,sourceDomainIds:command.sourceDomainIds,fusionGrantIds:command.fusionGrantIds,principalId:node.principalId,correlationId:turnId,input:input+memoryVerified,agentId:mobile?'agents.oracle':command.agentId??'agents.oracle',task:mobile?'reason':command.task??'reason',...(!mobile&&command.preferredModels?{preferredModels:command.preferredModels}:{}),...(decision?.allow?{locality:'cloud-ok' as const,cloudAllowed:true,requiredProvider:decision.provider,preferredModels:[decision.model],contextCeiling:decision.ceiling,authorisation:{grantId:decision.grantId,conversationId:turn!.conversation_id,provider:decision.provider}}:(mobile||(conversationId&&!publicWeb))?{locality:'local' as const,cloudAllowed:false}:{locality:command.locality??'prefer-local'}),...(publicWeb?{contextScope:'public-web' as const}:{}),...(mobile?{analysisOnly:true}:{})});
        const result={...response,conversationId:turn!.conversation_id};
        await this.d.sql`update experience.conversation_turns set answer=${result.answer??null},response=${JSON.stringify(result)},privacy_class=${classificationForTurn(result.privacyClass)},privacy_regime=${decision?.allow?'CLOUD_PERMITTED':'PRIVATE'},status='completed',finished_at=${this.d.now()} where turn_id=${turnId}`;
        this.d.invalidate();return {turnId,conversationId:turn!.conversation_id,answer:result.answer??null,result};
      }catch(error){await this.d.sql`update experience.conversation_turns set status='failed',finished_at=${this.d.now()} where turn_id=${turnId}`;this.d.invalidate();throw error;}
    });
  }
  /** The live grant for a conversation, if any. Revoked rows are excluded by the query. */
  private async liveGrant(conversationId:string,principalId:string):Promise<ConversationGrant|undefined>{
    const [row]=await this.d.sql<{grant_id:string;conversation_id:string;principal_id:string;provider:string;model:string;purpose:'conversation';ceiling:'PUBLIC'|'INTERNAL'|'SENSITIVE'|'RESTRICTED';policy_version:number;created_at:string;expires_at:string|null;revoked_at:string|null}[]>`
      select grant_id,conversation_id,principal_id,provider,model,purpose,ceiling,policy_version,
             to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
             case when expires_at is null then null else to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as expires_at,
             case when revoked_at is null then null else to_char(revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as revoked_at
        from experience.conversation_grants
       where conversation_id=${conversationId} and principal_id=${principalId} and revoked_at is null
       order by created_at desc limit 1`;
    if(!row)return undefined;
    return {grantId:row.grant_id,conversationId:row.conversation_id,principalId:row.principal_id,provider:row.provider,model:row.model,purpose:'conversation',ceiling:row.ceiling,policyVersion:row.policy_version,createdAt:row.created_at,expiresAt:row.expires_at,revokedAt:row.revoked_at};
  }

  /** Everything the policy needs about one conversation, evaluated now. */
  private async grantDecision(principalId:string,conversationId:string,currentTurnId?:string){
    // Only *completed* turns, and never the turn asking the question. The current turn is
    // inserted with status 'running' and no classification before this decision is made, so
    // including it made every first cloud turn refuse itself as "unclassified history".
    const rows=await this.d.sql<{conversation_id:string;principal_id:string;created_at:string;privacy_class:'PUBLIC'|'INTERNAL'|'SENSITIVE'|'RESTRICTED'|null;privacy_regime:'PRIVATE'|'CLOUD_PERMITTED'}[]>`
      select conversation_id,principal_id,privacy_class,privacy_regime,
             to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        from experience.conversation_turns
       where conversation_id=${conversationId} and principal_id=${principalId}
         and status='completed'
         and (${currentTurnId ?? null}::text is null or turn_id<>${currentTurnId ?? null})
       order by created_at asc`;
    const turns:ConversationTurn[]=rows.map(row=>({conversationId:row.conversation_id,principalId:row.principal_id,createdAt:row.created_at,privacyClass:row.privacy_class,regime:row.privacy_regime}));
    const grant=await this.liveGrant(conversationId,principalId);
    return evaluateConversationGrant({conversationId,principalId,grant,turns,now:Date.parse(this.d.now())});
  }

  /**
   * Operator action: authorise one conversation to use one named provider.
   * The Kernel is the source of truth; the UI only asks. A grant can never raise what
   * cloud routing permits, and a second authorisation replaces the first.
   */
  async grantCloud(node:Pick<RegisteredNode,'principalId'|'nodeId'>,input:{conversationId:string;provider:string;model:string;ceiling?:string;expiresInMs?:number}){
    if(!input.conversationId||!input.provider||!input.model)throw new Error('conversationId, provider and model are required');
    const ceiling=classificationForTurn(input.ceiling??'INTERNAL');
    if(!isCloudCeiling(ceiling))throw new Error(`a ${ceiling} ceiling cannot be authorised for cloud inference`);
    const expiresAt=typeof input.expiresInMs==='number'&&Number.isFinite(input.expiresInMs)&&input.expiresInMs>0?new Date(Date.parse(this.d.now())+input.expiresInMs).toISOString():null;
    await this.d.sql`update experience.conversation_grants set revoked_at=${this.d.now()},revoked_by=${node.nodeId} where conversation_id=${input.conversationId} and principal_id=${node.principalId} and revoked_at is null`;
    const grantId=this.d.id();
    await this.d.sql`insert into experience.conversation_grants(grant_id,conversation_id,principal_id,provider,model,purpose,ceiling,policy_version,created_at,expires_at) values(${grantId},${input.conversationId},${node.principalId},${input.provider},${input.model},'conversation',${ceiling},${CONVERSATION_POLICY_VERSION},${this.d.now()},${expiresAt})`;
    this.d.invalidate();
    return {grantId,conversationId:input.conversationId,provider:input.provider,model:input.model,ceiling,expiresAt};
  }

  /** Revocation is effective for the next dispatch; it cannot recall what was sent. */
  async revokeCloud(node:Pick<RegisteredNode,'principalId'|'nodeId'>,input:{conversationId:string}){
    const rows=await this.d.sql<{grant_id:string}[]>`update experience.conversation_grants set revoked_at=${this.d.now()},revoked_by=${node.nodeId} where conversation_id=${input.conversationId} and principal_id=${node.principalId} and revoked_at is null returning grant_id`;
    this.d.invalidate();
    return {revoked:rows.length};
  }

  /** The conversation's current privacy position, including why cloud is refused. */
  async privacyState(node:Pick<RegisteredNode,'principalId'>,input:{conversationId:string}){
    const grant=await this.liveGrant(input.conversationId,node.principalId);
    const decision=await this.grantDecision(node.principalId,input.conversationId);
    return {conversationId:input.conversationId,regime:decision.allow?'CLOUD_PERMITTED' as const:'PRIVATE' as const,decision,grant:grant??null};
  }

  async present(node:Pick<RegisteredNode,'principalId'>,input:{displayNodeId:string;objectId:string;expectedSceneVersion:number}){
    const snapshot=await this.snapshot();if(snapshot.principalId!==node.principalId||snapshot.sceneVersion!==input.expectedSceneVersion)throw new Error('scene version conflict');
    const object=snapshot.scene.objects.find(o=>o.id===input.objectId);if(!object)throw new Error('scene resource not found');
    const expiresAt=new Date(Date.parse(this.d.now())+60000).toISOString();
    const changed=await this.d.sql`insert into experience.wall_presentations(node_id,principal_id,object_id,scene_version,expires_at) select node_id,${node.principalId},${object.id},${snapshot.sceneVersion},${expiresAt} from nodes.registry where node_id=${input.displayNodeId} and principal_id=${node.principalId} and node_type='display' and trust_tier in ('owned-mobile','owned-secure') and status='connected' on conflict(node_id) do update set object_id=excluded.object_id,scene_version=excluded.scene_version,expires_at=excluded.expires_at returning node_id`;
    if(!changed.length)throw new Error('display unavailable');this.d.invalidate();return {objectId:object.id,expiresAt};
  }
}
