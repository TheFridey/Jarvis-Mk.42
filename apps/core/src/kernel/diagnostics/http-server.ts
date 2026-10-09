/**
 * Loopback diagnostics and authenticated desktop ingress (node:http - no framework).
 *
 * MK.43 DEVIATION from ADR-0001 (NestJS): the NestJS dependency tree could not
 * be installed in this environment. The composition root is a plain module and
 * this endpoint is node:http. See the "MK43 implementation notes". Migrating to
 * NestJS + Fastify is mechanical - the DiagnosticsService is already isolated.
 *
 * Routes:
 *   GET /healthz       -> 200 {status} | 503 when overall OFFLINE
 *   GET /diagnostics   -> full DiagnosticsReport
 *   GET /state         -> SystemStateView
 */
import { createServer, type Server } from 'node:http';
import type { DiagnosticsService } from './diagnostics-service.ts';
import type { StateManager } from '../state/state-manager.ts';
import type { HealthManager } from '../health/health-manager.ts';
import type { DesktopApprovalCommand, DesktopProposalCommand, DesktopCognitionCommand } from '@jarvis/scene';
import type { DesktopGateway } from '../desktop/desktop-gateway.ts';
import type { VoiceGateway } from '../voice/voice-gateway.ts';
import { AgentJobAccessError, ModelGatewayError, type VisionEventCommand, type VoiceEventCommand } from '@jarvis/contracts';
import type { VisionGateway } from '../vision/vision-gateway.ts';
import type { IdentityManager, SessionCredentialManager } from '../identity/index.ts';import type{SessionManager}from'../session/index.ts';import type{NodeStore}from'../nodes/index.ts';import type{IdGen}from'../../runtime/ids.ts';
import { extractTraceContext, withSpan, withTraceContext, structuredLog } from '@jarvis/telemetry';
import { ExperienceProjection, ExperienceStreamServer } from '../experience/index.ts';
import { z } from 'zod';
import type { NodeManager } from '../nodes/node-manager.ts';
import type { BusinessIntelligence } from '../integrations/intelligence.ts';
import type { CompanionService } from '../experience/companion-service.ts';
import type { DeliverySurface } from '../notification/surface-routing.ts';
import type { RtcService } from '../rtc/rtc-service.ts';
import type { DomainService } from '../domains/domain-service.ts';
import type { ObjectiveEngine } from '../objective/objective-engine.ts';
import { DomainAccessError, DomainKinds } from '@jarvis/contracts';

export interface DiagnosticsHttpDeps {
  domains?:DomainService;
  objectives?:ObjectiveEngine;
  rtc?:RtcService;
  surfaceConnected?:()=>void;
  companion?:CompanionService;
  business?: BusinessIntelligence;
  diagnostics: DiagnosticsService;
  state: StateManager;
  health: HealthManager;
  desktop: DesktopGateway;
  voice: VoiceGateway;
  vision: VisionGateway;
  identity:IdentityManager;sessions:SessionManager;credentials:SessionCredentialManager;nodeStore:NodeStore;ids:IdGen;nodeId:string;principalId:string;
  experience:ExperienceProjection;
  nodes:NodeManager;
}

export class DiagnosticsHttp {
  private server: Server | undefined;
  private stream: ExperienceStreamServer | undefined;

  constructor(private readonly deps: DiagnosticsHttpDeps) {}
  deliverNotification(record:import('@jarvis/contracts').NotificationRecord){void this.stream?.deliverNotification(record).catch(()=>undefined);}
  async deliverySurfaces():Promise<DeliverySurface[]>{const result:DeliverySurface[]=[];for(const binding of this.stream?.activeBindings()??[]){const auth=await this.deps.credentials.authenticate('Bearer '+binding.accessToken,{nodeId:binding.nodeId,sessionId:binding.sessionId,scopes:['experience.read']});const node=auth?await this.deps.nodeStore.get(binding.nodeId):null;if(auth&&node&&!['mobile','display'].includes(node.nodeType))result.push({id:node.nodeId,principalId:auth.principalId,kind:'desktop',trust:node.trustTier,available:true,presence:'UNKNOWN'});}return result;}

  listen(port: number, host = '127.0.0.1'): Promise<number> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.stream = new ExperienceStreamServer({ projection:this.deps.experience,surfaceConnected:this.deps.surfaceConnected, authenticate:async(binding,scopes)=>this.deps.credentials.authenticate(`Bearer ${binding.accessToken}`,{nodeId:binding.nodeId,sessionId:binding.sessionId,scopes}), allowedOrigin:(origin)=>this.allowedOrigin(origin), reportError:()=>{void structuredLog({component:'experience-stream',node:this.deps.nodeId,event:'stream.failed',severity:'ERROR'});} });
    this.stream.attach(this.server);
    return new Promise((resolve) => {
      this.server!.listen(port, host, () => {
        const addr = this.server!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  }

  private async handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) headers[key] = Array.isArray(value) ? value.join(',') : value;
    const parent = extractTraceContext(headers);
    return withTraceContext(parent, () => withSpan('kernel.interaction', {
      'http.request.method': req.method ?? 'GET',
      'url.path': (req.url ?? '/').split('?')[0] ?? '/',
    }, () => this.handleInner(req, res)));
  }

  private async handleInner(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const method = req.method ?? 'GET'; const url = req.url ?? '/';
    const origin = req.headers.origin;
    if (origin && this.allowedOrigin(origin)) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin'); res.setHeader('access-control-allow-headers', 'authorization, content-type, x-jarvis-node-id, x-jarvis-session-id'); res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body, null, 2);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(json);
    };
    if (method === 'OPTIONS') return send(204, null);

    try {
      const path = url.split('?')[0] ?? '/';
      if(path==='/rtc/join'||path==='/rtc/leave'){
        if(method!=='POST')return send(405,{error:'method not allowed'});
        const auth=await this.authorise(req,['voice.write'],'strong');const node=auth?await this.deps.nodeStore.get(auth.nodeId):null;
        if(!auth?.sessionId||!node||!['kernel-local','owned-secure'].includes(node.trustTier)||['mobile','display'].includes(node.nodeType))return send(403,{error:'trusted RTC surface required'});
        if(!this.deps.rtc)return send(503,{error:'RTC unavailable'});
        const binding={principalId:auth.principalId,nodeId:auth.nodeId,sessionId:auth.sessionId,accessToken:(req.headers.authorization??'').replace(/^Bearer /,'')};
        if(path==='/rtc/leave'){await this.deps.rtc.leave(binding);return send(200,{closed:true});}
        const input=z.object({speechMode:z.enum(['local','cloud']).default('local')}).strict().safeParse(await this.body<unknown>(req));if(!input.success)return send(400,{error:'invalid RTC request'});
        return send(201,await this.deps.rtc.join(binding,input.data.speechMode));
      }
      if(path==='/nodes/enrollments'||path==='/nodes/revoke'){
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return send(403,{error:'loopback operator required'});
        if(method!=='POST')return send(405,{error:'method not allowed'});
        const auth=await this.authorise(req,['nodes.manage'],'strong');
        const node=auth?await this.deps.nodeStore.get(auth.nodeId):null;
        if(!auth||node?.trustTier!=='kernel-local'||auth.principalId!==this.deps.principalId)return send(403,{error:'local operator required'});
        if(path==='/nodes/enrollments'){
          const input=z.object({trustCeiling:z.enum(['guest','owned-mobile','owned-secure']),ttlMs:z.number().int().min(1).max(300000).default(300000)}).strict().parse(await this.body<unknown>(req));
          return send(201,{token:await this.deps.nodes.createEnrollment(auth.principalId,input.trustCeiling,input.ttlMs)});
        }
        const input=z.object({nodeId:z.string().regex(/^[A-Za-z0-9._:-]{3,128}$/)}).strict().parse(await this.body<unknown>(req));
        const target=await this.deps.nodeStore.get(input.nodeId);if(!target||target.trustTier==='kernel-local')return send(403,{error:'invalid remote node'});
        await this.deps.nodes.revoke(input.nodeId);return send(200,{nodeId:input.nodeId,status:'revoked'});
      }
      if(path==='/auth/session'){if(method!=='POST')return send(405,{error:'method not allowed'});const body=await this.body<{credential:string;nodeId:string;scopes:string[];surface?:string}>(req);const node=await this.deps.nodeStore.get(body.nodeId);if(!node||['revoked','isolated','disconnected'].includes(node.status))return send(403,{error:'node not admitted'});const auth=await this.deps.identity.authenticate({method:'bootstrap',credential:body.credential,nodeId:body.nodeId,claimedPrincipalId:this.deps.principalId});if(!auth.ok)return send(401,{error:auth.code});if(node.trustTier!=='owned-secure'&&node.trustTier!=='kernel-local')return send(403,{error:'trusted workstation required'});if(node.nodeType==='mobile'||node.nodeType==='display')return send(403,{error:'use restricted node ingress'});const allowed=['desktop.read','desktop.write','voice.write','vision.write','vision.read','experience.read','nodes.manage'];if(!Array.isArray(body.scopes)||body.scopes.some(s=>!allowed.includes(s)))return send(403,{error:'scope not issuable'});let session=await this.deps.sessions.open({type:body.surface==='voice'?'rtc':'user_interaction',principalId:auth.context.principalId,nodeId:body.nodeId,correlationId:this.deps.ids.ulid(),contextRef:body.surface??'desktop'});const active=await this.deps.sessions.transition({sessionId:session.id,to:'active',reason:'authenticated',expectedVersion:session.version});if(!active.ok)return send(500,{error:'session activation failed'});session=active.session;const issued=await this.deps.credentials.issue({identityId:auth.context.identityId,principalId:auth.context.principalId,sessionId:session.id,nodeId:body.nodeId,scopes:body.scopes,authStrength:'strong'});return send(201,{accessToken:issued.accessToken,credential:issued.credential})}
      if(path==='/auth/rotate'){if(method!=='POST')return send(405,{error:'method not allowed'});const binding=this.binding(req);if(!binding.sessionId)return send(401,{error:'session required'});const next=await this.deps.credentials.rotate(req.headers.authorization??'',{nodeId:binding.nodeId,sessionId:binding.sessionId,scopes:[]});return next?send(200,{accessToken:next.accessToken,credential:next.credential}):send(401,{error:'unauthorised'})}
      if(path==='/auth/logout'){if(method!=='POST')return send(405,{error:'method not allowed'});const binding=this.binding(req);const auth=await this.deps.credentials.authenticate(req.headers.authorization,{...binding,scopes:[]});if(!auth?.sessionId)return send(401,{error:'unauthorised'});const session=await this.deps.sessions.get(auth.sessionId);if(!session)return send(401,{error:'session unavailable'});const ended=await this.deps.sessions.transition({sessionId:session.id,to:'ended',reason:'logout',expectedVersion:-1});if(ended.ok)this.stream?.disconnectSession(session.id);return ended.ok?send(204,null):send(409,{error:ended.code})}
      if (path === '/healthz') {
        if (method !== 'GET') return send(405, { error: 'method not allowed' });
        const report = this.deps.health.report();
        return send(report.overall === 'OFFLINE' ? 503 : 200, {
          status: report.overall,
          criticalIssues: report.criticalIssues,
        });
      }
      if (path === '/diagnostics') {
        if (method !== 'GET') return send(405, { error: 'method not allowed' });
        return send(200, await this.deps.diagnostics.report());
      }
      if (path === '/state') {
        if (method !== 'GET') return send(405, { error: 'method not allowed' });
        return send(200, await this.deps.state.view());
      }
      if(path==='/domains'||path.startsWith('/domains/')){
        const auth=await this.authorise(req,[method==='GET'?'desktop.read':'desktop.write'],method==='GET'?undefined:'strong');
        if(!auth)return send(401,{error:'unauthorised'});
        const node=await this.deps.nodeStore.get(auth.nodeId);
        if(!node||node.principalId!==auth.principalId||!['owned-secure','kernel-local'].includes(node.trustTier)||['mobile','display'].includes(node.nodeType))return send(403,{error:'trusted personal workstation required'});
        const domains=this.deps.domains;if(!domains)return send(503,{error:'domains unavailable'});
        if(path==='/domains'&&method==='GET')return send(200,{domains:await domains.list(auth.principalId),selection:await domains.selected(auth.principalId,auth.nodeId)});
        if(path==='/domains'&&method==='POST'){const input=z.object({kind:z.enum(DomainKinds),name:z.string().min(1).max(200)}).strict().parse(await this.body<unknown>(req));return send(201,await domains.create(auth.principalId,input));}
        if(path==='/domains/select'&&method==='POST'){const input=z.object({domainId:z.string().min(1).max(200),expectedVersion:z.number().int().nonnegative()}).strict().parse(await this.body<unknown>(req));return send(200,await domains.switch(auth.principalId,auth.nodeId,input.domainId,input.expectedVersion));}
        if(path==='/domains/fusion'&&method==='POST'){const input=z.object({sourceDomainId:z.string().min(1).max(200),targetDomainId:z.string().min(1).max(200),purpose:z.enum(['general','research','coding','financial','system']),expiresAt:z.string().datetime()}).strict().parse(await this.body<unknown>(req));return send(201,{id:await domains.fusionGrant(auth.principalId,input)});}
        if(path==='/domains/fusion/revoke'&&method==='POST'){const input=z.object({id:z.string().min(1).max(200)}).strict().parse(await this.body<unknown>(req));await domains.revokeFusionGrant(auth.principalId,input.id);return send(200,{revoked:true});}
        if(path==='/domains/objectives'&&method==='GET'){if(!this.deps.objectives)return send(503,{error:'objectives unavailable'});return send(200,await domains.run(auth.principalId,{nodeId:auth.nodeId},this.deps.ids.ulid(),()=>this.deps.objectives!.list(auth.principalId)));}
        if(path==='/domains/objectives'&&method==='POST'){if(!this.deps.objectives)return send(503,{error:'objectives unavailable'});const input=z.object({statement:z.string().min(1).max(4000),domainId:z.string().min(1).max(200).optional(),domainSelectionVersion:z.number().int().nonnegative().optional()}).strict().parse(await this.body<unknown>(req));const correlationId=this.deps.ids.ulid();return send(201,await domains.run(auth.principalId,{...input,nodeId:auth.nodeId},correlationId,()=>this.deps.objectives!.create({principalId:auth.principalId,statement:input.statement,origin:'principal',correlationId,provenance:{method:'assertion',producedBy:auth.principalId,producedOn:auth.nodeId,producedAt:new Date().toISOString(),correlationId,derivedFromUntrusted:false}})));}
        return send(405,{error:'method not allowed'});
      }
      if (path.startsWith('/desktop/')) {
        const scope=path==='/desktop/snapshot'||path==='/desktop/nova/picture'||path==='/desktop/conversations'?'desktop.read':'desktop.write';const auth=await this.authorise(req,[scope],path==='/desktop/approvals'?'strong':undefined);if(!auth) return send(401, { error: 'unauthorised' });
        if(path==='/desktop/wall'&&method==='POST'){const input=z.object({displayNodeId:z.string().min(3).max(128),objectId:z.string().min(1).max(200),expectedSceneVersion:z.number().int().nonnegative()}).strict().parse(await this.body<unknown>(req));if(!this.deps.companion)return send(503,{error:'companion unavailable'});return send(200,await this.deps.companion.present({principalId:auth.principalId},input));}
        if(path==='/desktop/conversations'&&method==='GET'){if(!this.deps.companion)return send(503,{error:'companion unavailable'});return send(200,this.deps.domains?await this.deps.domains.run(auth.principalId,{nodeId:auth.nodeId},this.deps.ids.ulid(),()=>this.deps.companion!.turns(auth.principalId)):await this.deps.companion.turns(auth.principalId));}
        if(path==='/desktop/displays'&&method==='GET'){if(!this.deps.companion)return send(503,{error:'companion unavailable'});return send(200,await this.deps.companion.displays(auth.principalId));}
        if(path==='/desktop/perception'&&method==='POST'){const parsed=z.object({focusedId:z.string().min(1).max(200).optional(),selectedIds:z.array(z.string().min(1).max(200)).max(32)}).strict().safeParse(await this.body<unknown>(req));if(!parsed.success)return send(400,{error:'invalid scene observation'});await this.deps.desktop.observeSelection(auth.principalId,auth.nodeId,parsed.data);return send(200,{accepted:true});}
          if (path === '/desktop/snapshot' && method === 'GET') {const picture=await this.deps.desktop.snapshot();return picture.principalId===auth.principalId?send(200,picture):send(403,{error:'principal mismatch'});}
          if (path.startsWith('/desktop/nova/')) {
            if(!this.deps.business)return send(503,{error:'business integration unavailable'});
            if(path==='/desktop/nova/picture'&&method==='GET')return send(200,this.deps.business.picture(auth.principalId));
            if(path==='/desktop/nova/refresh'&&method==='POST'){const result=await this.deps.business.refresh(auth.principalId,this.deps.ids.ulid());this.deps.experience.invalidate(['objectives']);return send(200,result);}
            if(path==='/desktop/nova/meeting'&&method==='POST'){
              const parsed=z.object({calendarId:z.string().min(1).max(300).default('primary'),eventId:z.string().min(1).max(300),clientId:z.string().min(1).max(200).optional(),contactEmail:z.string().email().optional(),threadId:z.string().regex(/^[a-zA-Z0-9_-]+$/).optional()}).strict().safeParse(await this.body<unknown>(req));
              if(!parsed.success)return send(400,{error:'invalid meeting request'});
              return send(200,await this.deps.business.createMeeting(auth.principalId,parsed.data,this.deps.ids.ulid()));
            }
            if(path==='/desktop/nova/resume'&&method==='POST'){
              const parsed=z.object({objectiveId:z.string().min(1).max(200)}).strict().safeParse(await this.body<unknown>(req));if(!parsed.success)return send(400,{error:'invalid objective request'});
              return send(200,await this.deps.business.resumeMeeting(auth.principalId,parsed.data.objectiveId));
            }
            if(path==='/desktop/nova/client'&&method==='POST'){
              const parsed=z.object({clientId:z.string().min(1).max(200)}).strict().safeParse(await this.body<unknown>(req));if(!parsed.success)return send(400,{error:'invalid client request'});
              return send(200,await this.deps.business.clientHistory(auth.principalId,parsed.data.clientId,this.deps.ids.ulid()));
            }
            if(path==='/desktop/nova/specialists'&&method==='POST'){
              const parsed=z.object({objectiveId:z.string().min(1).max(200),agentId:z.enum(['agents.hermes','agents.scout','agents.prometheus','agents.atlas','agents.mnemosyne']),instruction:z.string().min(1).max(10000)}).strict().safeParse(await this.body<unknown>(req));if(!parsed.success)return send(400,{error:'invalid specialist request'});
              return send(200,await this.deps.business.coordinate(auth.principalId,parsed.data.objectiveId,parsed.data.agentId,parsed.data.instruction,this.deps.ids.ulid()));
            }
          }
        if (path === '/desktop/proposals' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.submit(await this.body<DesktopProposalCommand>(req)));
        if (path === '/desktop/cognition' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.cognize(await this.body<DesktopCognitionCommand>(req),auth.nodeId));
        if (path === '/desktop/agents/cancel' && method === 'POST') {
          const parsed = z.object({ commandId:z.string().min(1).max(200), expectedStateVersion:z.number().int().nonnegative(), jobId:z.string().min(1).max(200) }).strict().safeParse(await this.body<unknown>(req));
          if (!parsed.success) return send(400, { error:'invalid agent cancellation command' });
          return this.sendCommand(send, await this.deps.desktop.cancelAgentJob(parsed.data, auth.principalId));
        }
        if (path === '/desktop/approvals' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.decide(await this.body<DesktopApprovalCommand>(req), { authTrustLevel: auth.trust === 'verified' ? 'verified' : 'trusted' }));
        return send(405, { error: 'method not allowed' });
      }
      if(path==='/voice/events'){if(method!=='POST')return send(405,{error:'method not allowed'});const auth=await this.authorise(req,['voice.write']);if(!auth)return send(401,{error:'unauthorised'});const command=await this.body<VoiceEventCommand>(req);if(auth.principalId!==command.principalId||auth.nodeId!==command.nodeId)return send(403,{error:'credential binding mismatch'});const result=await this.deps.voice.handle(command);this.deps.experience.invalidate(['telemetry','system','scene']);return send(200,result)}
      if(path==='/vision/events'){if(method!=='POST')return send(405,{error:'method not allowed'});const auth=await this.authorise(req,['vision.write']);if(!auth)return send(401,{error:'unauthorised'});const command=await this.body<VisionEventCommand>(req);if(auth.principalId!==command.principalId||auth.nodeId!==command.nodeId)return send(403,{error:'credential binding mismatch'});return send(200,await this.deps.vision.handle(command))}
      if(path==='/vision/stream'){if(method!=='GET')return send(405,{error:'method not allowed'});if(!await this.authorise(req,['vision.read']))return send(401,{error:'unauthorised'});res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-cache','connection':'keep-alive'});const unsubscribe=this.deps.vision.subscribe(frame=>res.write(`${JSON.stringify(frame)}\n`));const heartbeat=setInterval(()=>res.write('\n'),15000);req.once('close',()=>{clearInterval(heartbeat);unsubscribe()});return}
      if (method !== 'GET') return send(405, { error: 'method not allowed' });
      return send(404, { error: 'not found', routes: ['/healthz', '/diagnostics', '/state', '/desktop/snapshot', '/desktop/proposals', '/desktop/approvals'] });
    } catch (err) {
      if (err instanceof z.ZodError) return send(400,{error:'invalid_request'});
      if (err instanceof DomainAccessError) return send(403,{error:err.code});
      if (err instanceof AgentJobAccessError) return send(403, { error:err.code });
      if (err instanceof ModelGatewayError) {
        const unavailable=['NO_ROUTE','UNAVAILABLE','TIMEOUT','RATE_LIMITED','AUTHENTICATION','PROVIDER_ERROR'].includes(err.code);
        return send(unavailable?503:err.code==='CANCELLED'?409:422,{
          code:err.code,
          error:unavailable?'Model inference is unavailable; no permitted provider completed this request. Kernel state and permission checks remain available while storage is healthy.':`Model request could not complete (${err.code}).`,
        });
      }
      void structuredLog({component:'diagnostics',node:this.deps.nodeId,event:'request.failed',severity:'ERROR'});
      return send(500, { error: 'internal_error' });
    }
  }

  private sendCommand(send: (code: number, body: unknown) => void, result: { ok: true; value: unknown } | { ok: false; code: 'state_version_conflict' | 'approval_rejected'; currentStateVersion: number }) { return result.ok ? send(200, result.value) : send(result.code === 'state_version_conflict' ? 409 : 403, { error: result.code, currentStateVersion: result.currentStateVersion }); }
  private allowedOrigin(origin: string) { return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'tauri://localhost' || origin === 'http://tauri.localhost'; }
  private binding(req:import('node:http').IncomingMessage){return{nodeId:String(req.headers['x-jarvis-node-id']??''),sessionId:String(req.headers['x-jarvis-session-id']??'')||undefined}}
  private authorise(req:import('node:http').IncomingMessage,scopes:string[],minimumStrength?:'strong'){return this.deps.credentials.authenticate(req.headers.authorization,{...this.binding(req),scopes,...(minimumStrength?{minimumStrength,recentWithinMs:5*60_000}:{})})}
  private async body<T>(req: import('node:http').IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 1_000_000) throw new Error('request body too large'); chunks.push(buffer); } return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; }

  async close(): Promise<void> {
    await this.stream?.close(); this.stream = undefined;
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}
