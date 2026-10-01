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
import type { VisionEventCommand, VoiceEventCommand } from '@jarvis/contracts';
import type { VisionGateway } from '../vision/vision-gateway.ts';
import type { IdentityManager, SessionCredentialManager } from '../identity/index.ts';import type{SessionManager}from'../session/index.ts';import type{NodeStore}from'../nodes/index.ts';import type{IdGen}from'../../runtime/ids.ts';
import { extractTraceContext, withSpan, withTraceContext } from '@jarvis/telemetry';
import { ExperienceProjection, ExperienceStreamServer } from '../experience/index.ts';

export interface DiagnosticsHttpDeps {
  diagnostics: DiagnosticsService;
  state: StateManager;
  health: HealthManager;
  desktop: DesktopGateway;
  voice: VoiceGateway;
  vision: VisionGateway;
  identity:IdentityManager;sessions:SessionManager;credentials:SessionCredentialManager;nodeStore:NodeStore;ids:IdGen;nodeId:string;principalId:string;
  experience:ExperienceProjection;
}

export class DiagnosticsHttp {
  private server: Server | undefined;
  private stream: ExperienceStreamServer | undefined;

  constructor(private readonly deps: DiagnosticsHttpDeps) {}

  listen(port: number, host = '127.0.0.1'): Promise<number> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.stream = new ExperienceStreamServer({ projection:this.deps.experience, authenticate:async(binding,scopes)=>this.deps.credentials.authenticate(`Bearer ${binding.accessToken}`,{nodeId:binding.nodeId,sessionId:binding.sessionId,scopes}), allowedOrigin:(origin)=>this.allowedOrigin(origin), reportError:(error)=>console.error('experience-stream:',error) });
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
      if(path==='/auth/session'){if(method!=='POST')return send(405,{error:'method not allowed'});const body=await this.body<{credential:string;nodeId:string;scopes:string[];surface?:string}>(req);const node=await this.deps.nodeStore.get(body.nodeId);if(!node||['revoked','isolated','disconnected'].includes(node.status))return send(403,{error:'node not admitted'});const auth=await this.deps.identity.authenticate({method:'bootstrap',credential:body.credential,nodeId:body.nodeId,claimedPrincipalId:this.deps.principalId});if(!auth.ok)return send(401,{error:auth.code});const allowed=['desktop.read','desktop.write','voice.write','vision.write','vision.read','experience.read'];if(!Array.isArray(body.scopes)||body.scopes.some(s=>!allowed.includes(s)))return send(403,{error:'scope not issuable'});let session=await this.deps.sessions.open({type:body.surface==='voice'?'rtc':'user_interaction',principalId:auth.context.principalId,nodeId:body.nodeId,correlationId:this.deps.ids.ulid(),contextRef:body.surface??'desktop'});const active=await this.deps.sessions.transition({sessionId:session.id,to:'active',reason:'authenticated',expectedVersion:session.version});if(!active.ok)return send(500,{error:'session activation failed'});session=active.session;const issued=await this.deps.credentials.issue({identityId:auth.context.identityId,principalId:auth.context.principalId,sessionId:session.id,nodeId:body.nodeId,scopes:body.scopes,authStrength:'strong'});return send(201,{accessToken:issued.accessToken,credential:issued.credential})}
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
      if (path.startsWith('/desktop/')) {
        const scope=path==='/desktop/snapshot'?'desktop.read':'desktop.write';const auth=await this.authorise(req,[scope],path==='/desktop/approvals'?'strong':undefined);if(!auth) return send(401, { error: 'unauthorised' });
        if (path === '/desktop/snapshot' && method === 'GET') return send(200, await this.deps.desktop.snapshot());
        if (path === '/desktop/proposals' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.submit(await this.body<DesktopProposalCommand>(req)));
        if (path === '/desktop/cognition' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.cognize(await this.body<DesktopCognitionCommand>(req)));
        if (path === '/desktop/approvals' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.decide(await this.body<DesktopApprovalCommand>(req), { authTrustLevel: auth.trust === 'verified' ? 'verified' : 'trusted' }));
        return send(405, { error: 'method not allowed' });
      }
      if(path==='/voice/events'){if(method!=='POST')return send(405,{error:'method not allowed'});const auth=await this.authorise(req,['voice.write']);if(!auth)return send(401,{error:'unauthorised'});const command=await this.body<VoiceEventCommand>(req);if(auth.principalId!==command.principalId||auth.nodeId!==command.nodeId)return send(403,{error:'credential binding mismatch'});return send(200,await this.deps.voice.handle(command))}
      if(path==='/vision/events'){if(method!=='POST')return send(405,{error:'method not allowed'});const auth=await this.authorise(req,['vision.write']);if(!auth)return send(401,{error:'unauthorised'});const command=await this.body<VisionEventCommand>(req);if(auth.principalId!==command.principalId||auth.nodeId!==command.nodeId)return send(403,{error:'credential binding mismatch'});return send(200,await this.deps.vision.handle(command))}
      if(path==='/vision/stream'){if(method!=='GET')return send(405,{error:'method not allowed'});if(!await this.authorise(req,['vision.read']))return send(401,{error:'unauthorised'});res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-cache','connection':'keep-alive'});const unsubscribe=this.deps.vision.subscribe(frame=>res.write(`${JSON.stringify(frame)}\n`));const heartbeat=setInterval(()=>res.write('\n'),15000);req.once('close',()=>{clearInterval(heartbeat);unsubscribe()});return}
      if (method !== 'GET') return send(405, { error: 'method not allowed' });
      return send(404, { error: 'not found', routes: ['/healthz', '/diagnostics', '/state', '/desktop/snapshot', '/desktop/proposals', '/desktop/approvals'] });
    } catch (err) {
      return send(500, { error: err instanceof Error ? err.message : String(err) });
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
