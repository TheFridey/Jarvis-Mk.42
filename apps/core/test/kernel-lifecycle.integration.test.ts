import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventNames } from '@jarvis/contracts';
import { isDockerAvailable } from '@jarvis/testkit';
import { setupIt, truncateAll, type ItContext } from './it-harness.ts';
import { AgentJobStore } from '../src/kernel/cognition/agent-job-store.ts';

const dockerOk = await isDockerAvailable();

describe.skipIf(!dockerOk)('kernel lifecycle (integration)', () => {
  let ctx: ItContext;

  beforeAll(async () => {
    ctx = await setupIt();
  }, 240_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('cold starts to operational: DORMANT -> AMBIENT, diagnostics ok, bootstrap identity present', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await k.start();

    expect(await k.mode.current()).toBe('AMBIENT');

    const report = await k.diagnostics.report();
    expect(report.ok).toBe(true);
    expect(report.mode).toBe('AMBIENT');
    expect(report.health.overall).not.toBe('OFFLINE');
    expect(report.events.deadLettered).toBe(0);
    expect(report.dependencies.find((d) => d.name === 'model-gateway')?.placeholder).toBe(false);
    expect(report.objectives.placeholder).toBe(false);

    // operational event on the log
    const events = await k.eventStore.readFrom('0', 200);
    expect(events.some((e) => e.type === EventNames.KernelOperational)).toBe(true);
    expect(events.some((e) => e.type === EventNames.ModeChanged)).toBe(true);
    expect(events.some((e) => e.type === EventNames.IdentityAuthenticated || e.type === EventNames.StateMutated)).toBe(true);

    await k.stop();
  });

  it('survives a restart: a second Kernel against the same PG recovers state + mode', async () => {
    await truncateAll(ctx.pg);
    const k1 = ctx.makeKernel();
    await k1.start();
    // do some authoritative work
    await k1.state.mutate({
      key: 'active_workspace',
      value: { workspaceId: 'persisted-across-restart' },
      expectedVersion: -1,
      correlationId: k1.ids.ulid(),
      actor: { kind: 'principal', id: 'principal-operator' },
      reason: 'work',
    });
    const svBefore = (await k1.state.view()).stateVersion;
    await k1.stop(); // takes a final snapshot

    const k2 = ctx.makeKernel();
    await k2.start();
    const view = await k2.state.view();
    expect(view.slices.active_workspace.value).toEqual({ workspaceId: 'persisted-across-restart' });
    expect(view.stateVersion).toBeGreaterThanOrEqual(svBefore);
    expect(await k2.mode.current()).toBe('AMBIENT');
    await k2.stop();
  });

  it('enters DEGRADED mode when a critical subsystem reports unhealthy, and recovers', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await k.start();
    expect(await k.mode.current()).toBe('AMBIENT');

    await k.health.heartbeat({ subsystem: 'event-fabric', status: 'DEGRADED', message: 'simulated' });
    expect(await k.mode.current()).toBe('DEGRADED');

    ctx.clock.advance(10); // clear dwell hysteresis (harness minDwellMs=1)
    await k.health.heartbeat({ subsystem: 'event-fabric', status: 'HEALTHY', message: 'recovered' });
    expect(k.health.criticalDepsHealthy()).toBe(true);
    expect(await k.mode.current()).toBe('AMBIENT');

    await k.stop();
  });

  it('the diagnostics report answers "I am operational" with real numbers', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await k.start();
    // generate some events
    for (let i = 0; i < 3; i++) {
      await k.state.mutate({
        key: 'selected_object',
        value: { ref: `r${i}` },
        expectedVersion: -1,
        correlationId: k.ids.ulid(),
        actor: { kind: 'principal', id: 'principal-operator' },
        reason: 'n',
      });
    }
    const report = await k.diagnostics.report();
    expect(report.events.totalAppended).toBeGreaterThan(3);
    expect(report.state.stateVersion).toBeGreaterThan(3);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.identity.version).toBe('0.43.0');
    await k.stop();
  });

  it('does not degrade mode for a non-critical outage',async()=>{await truncateAll(ctx.pg);const k=ctx.makeKernel();await k.start();await k.health.heartbeat({subsystem:'redis',status:'OFFLINE',message:'optional cache unavailable'});expect(k.health.report().overall).toBe('DEGRADED');expect(k.health.criticalDepsHealthy()).toBe(true);expect(await k.mode.current()).toBe('AMBIENT');await k.stop()});

  it('remains DEGRADED while any critical dependency is unhealthy',async()=>{await truncateAll(ctx.pg);const k=ctx.makeKernel();await k.start();await k.health.heartbeat({subsystem:'event-fabric',status:'DEGRADED',message:'fabric down'});await k.health.heartbeat({subsystem:'agency',status:'DEGRADED',message:'agency down'});ctx.clock.advance(10);await k.health.heartbeat({subsystem:'event-fabric',status:'HEALTHY',message:'fabric recovered'});expect(k.health.criticalDepsHealthy()).toBe(false);expect(await k.mode.current()).toBe('DEGRADED');await k.health.heartbeat({subsystem:'agency',status:'HEALTHY',message:'agency recovered'});expect(await k.mode.current()).toBe('AMBIENT');await k.stop()});

  it('respects dwell during rapid flapping and converges after a later healthy heartbeat',async()=>{await truncateAll(ctx.pg);const k=ctx.makeKernel();await k.start();await k.health.heartbeat({subsystem:'event-fabric',status:'DEGRADED',message:'down'});await k.health.heartbeat({subsystem:'event-fabric',status:'HEALTHY',message:'too soon'});expect(await k.mode.current()).toBe('DEGRADED');ctx.clock.advance(10);await k.health.heartbeat({subsystem:'event-fabric',status:'HEALTHY',message:'stable'});expect(await k.mode.current()).toBe('AMBIENT');await k.stop()});

  it('serialises concurrent critical and outbox health updates to the final critical state',async()=>{await truncateAll(ctx.pg);const k=ctx.makeKernel();await k.start();await Promise.all([k.health.heartbeat({subsystem:'event-fabric',status:'DEGRADED',message:'manual fault'}),k.outboxRelay.tick()]);ctx.clock.advance(10);await k.health.heartbeat({subsystem:'event-fabric',status:'HEALTHY',message:'confirmed recovery'});expect(k.health.report().overall).toBe(k.health.overall);expect(k.health.criticalDepsHealthy()).toBe(true);expect(await k.mode.current()).toBe('AMBIENT');await k.stop()});

  it('serves an authenticated desktop snapshot and rejects stale commands', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel({ noHttp: false });
    await k.start();
    const base = `http://${k.config.diagnosticsHost}:${k.diagnosticsPort}`;
    expect((await fetch(`${base}/desktop/snapshot`)).status).toBe(401);
    const exchange=await fetch(`${base}/auth/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:k.config.bootstrapCredential,nodeId:k.config.nodeId,scopes:['desktop.read','desktop.write'],surface:'desktop'})});expect(exchange.status).toBe(201);const issued=await exchange.json() as {accessToken:string;credential:{sessionId:string}};
    const headers = { authorization: `Bearer ${issued.accessToken}`, 'content-type': 'application/json','x-jarvis-node-id':k.config.nodeId,'x-jarvis-session-id':issued.credential.sessionId };
    const snapshotResponse = await fetch(`${base}/desktop/snapshot`, { headers });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = await snapshotResponse.json() as { schemaVersion: number; principalId: string; stateVersion: number; diagnostics: { mode: string }; scene: { presentation: string; version: number } };
    expect(snapshot).toMatchObject({ schemaVersion: 2, operatingPictureVersion: 1, principalId: 'principal-operator', diagnostics: { mode: 'AMBIENT' } });
    expect(snapshot.scene.version).toBe(snapshot.stateVersion);
    const stale = await fetch(`${base}/desktop/proposals`, { method: 'POST', headers, body: JSON.stringify({ commandId: 'stale', expectedStateVersion: snapshot.stateVersion - 1, proposal: {} }) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'state_version_conflict', currentStateVersion: snapshot.stateVersion });
    const jobs=new AgentJobStore(ctx.pg.sql,k.events);
    await jobs.enqueue({jobId:'http-cancel',agentId:'agents.oracle',principalId:'principal-operator',correlationId:'http-cancel-correlation',task:'reason',hash:'http-cancel',wallMs:120000,contextUnits:100,costLimit:1});
    const command={commandId:'cancel-command',expectedStateVersion:snapshot.stateVersion,jobId:'http-cancel'};
    expect((await fetch(`${base}/desktop/agents/cancel`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)})).status).toBe(401);
    const readExchange=await fetch(`${base}/auth/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:k.config.bootstrapCredential,nodeId:k.config.nodeId,scopes:['desktop.read'],surface:'desktop'})});
    expect(readExchange.status).toBe(201);const readIssued=await readExchange.json() as{accessToken:string;credential:{sessionId:string}};
    const readHeaders={...headers,authorization:`Bearer ${readIssued.accessToken}`,'x-jarvis-session-id':readIssued.credential.sessionId};
    expect((await fetch(`${base}/desktop/agents/cancel`,{method:'POST',headers:readHeaders,body:JSON.stringify(command)})).status).toBe(401);
    expect((await fetch(`${base}/desktop/agents/cancel`,{method:'POST',headers,body:JSON.stringify({...command,principalId:'other'})})).status).toBe(400);
    expect((await jobs.get('http-cancel'))?.state).toBe('QUEUED');
    const cancelled=await fetch(`${base}/desktop/agents/cancel`,{method:'POST',headers,body:JSON.stringify(command)});
    expect(cancelled.status).toBe(200);expect(await cancelled.json()).toEqual({jobId:'http-cancel',cancelled:true});
    expect((await jobs.get('http-cancel'))?.state).toBe('CANCELLED');
    expect((await fetch(`${base}/desktop/agents/cancel`,{method:'POST',headers,body:JSON.stringify({...command,jobId:'unknown-job'})})).status).toBe(403);
    expect((await fetch(`${base}/auth/logout`,{method:'POST',headers})).status).toBe(204);
    expect((await fetch(`${base}/desktop/agents/cancel`,{method:'POST',headers,body:JSON.stringify(command)})).status).toBe(401);
    await k.stop();
  });
});
