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
import type { VoiceEventCommand } from '@jarvis/contracts';

export interface DiagnosticsHttpDeps {
  diagnostics: DiagnosticsService;
  state: StateManager;
  health: HealthManager;
  desktop: DesktopGateway;
  voice: VoiceGateway;
}

export class DiagnosticsHttp {
  private server: Server | undefined;

  constructor(private readonly deps: DiagnosticsHttpDeps) {}

  listen(port: number, host = '127.0.0.1'): Promise<number> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
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
    const method = req.method ?? 'GET'; const url = req.url ?? '/';
    const origin = req.headers.origin;
    if (origin && this.allowedOrigin(origin)) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin'); res.setHeader('access-control-allow-headers', 'authorization, content-type'); res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body, null, 2);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(json);
    };
    if (method === 'OPTIONS') return send(204, null);

    try {
      const path = url.split('?')[0] ?? '/';
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
        if (!this.deps.desktop.authenticate(req.headers.authorization)) return send(401, { error: 'unauthorised' });
        if (path === '/desktop/snapshot' && method === 'GET') return send(200, await this.deps.desktop.snapshot());
        if (path === '/desktop/proposals' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.submit(await this.body<DesktopProposalCommand>(req)));
        if (path === '/desktop/cognition' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.cognize(await this.body<DesktopCognitionCommand>(req)));
        if (path === '/desktop/approvals' && method === 'POST') return this.sendCommand(send, await this.deps.desktop.decide(await this.body<DesktopApprovalCommand>(req)));
        return send(405, { error: 'method not allowed' });
      }
      if(path==='/voice/events'){if(method!=='POST')return send(405,{error:'method not allowed'});if(!this.deps.voice.authenticate(req.headers.authorization))return send(401,{error:'unauthorised'});const command=await this.body<VoiceEventCommand>(req);if(!this.deps.voice.authorises(command.principalId))return send(403,{error:'principal not authorised for voice token'});return send(200,await this.deps.voice.handle(command))}
      if (method !== 'GET') return send(405, { error: 'method not allowed' });
      return send(404, { error: 'not found', routes: ['/healthz', '/diagnostics', '/state', '/desktop/snapshot', '/desktop/proposals', '/desktop/approvals'] });
    } catch (err) {
      return send(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private sendCommand(send: (code: number, body: unknown) => void, result: { ok: true; value: unknown } | { ok: false; code: 'state_version_conflict' | 'approval_rejected'; currentStateVersion: number }) { return result.ok ? send(200, result.value) : send(result.code === 'state_version_conflict' ? 409 : 403, { error: result.code, currentStateVersion: result.currentStateVersion }); }
  private allowedOrigin(origin: string) { return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'tauri://localhost' || origin === 'http://tauri.localhost'; }
  private async body<T>(req: import('node:http').IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 1_000_000) throw new Error('request body too large'); chunks.push(buffer); } return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}
