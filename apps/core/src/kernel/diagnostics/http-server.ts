/**
 * Minimal read-only diagnostics HTTP surface (node:http - no framework).
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

export interface DiagnosticsHttpDeps {
  diagnostics: DiagnosticsService;
  state: StateManager;
  health: HealthManager;
}

export class DiagnosticsHttp {
  private server: Server | undefined;

  constructor(private readonly deps: DiagnosticsHttpDeps) {}

  listen(port: number): Promise<number> {
    this.server = createServer((req, res) => {
      void this.handle(req.method ?? 'GET', req.url ?? '/', res);
    });
    return new Promise((resolve) => {
      this.server!.listen(port, () => {
        const addr = this.server!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  }

  private async handle(
    method: string,
    url: string,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body, null, 2);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(json);
    };
    if (method !== 'GET') return send(405, { error: 'method not allowed' });

    try {
      const path = url.split('?')[0];
      if (path === '/healthz') {
        const report = this.deps.health.report();
        return send(report.overall === 'OFFLINE' ? 503 : 200, {
          status: report.overall,
          criticalIssues: report.criticalIssues,
        });
      }
      if (path === '/diagnostics') {
        return send(200, await this.deps.diagnostics.report());
      }
      if (path === '/state') {
        return send(200, await this.deps.state.view());
      }
      return send(404, { error: 'not found', routes: ['/healthz', '/diagnostics', '/state'] });
    } catch (err) {
      return send(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}
