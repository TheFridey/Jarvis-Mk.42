import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { buildKernel, type KernelHandle } from '../src/kernel/lifecycle/kernel.ts';
import { loadConfig } from '../src/runtime/config.ts';

const execFile = promisify(callback);
const prefix = `jarvis-audit-mark42-${Date.now()}-${process.pid}`;
const names: string[] = [];
let pg: PgHandle | undefined, kernel: KernelHandle | undefined;
async function port() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('bind failed'); await new Promise<void>(resolve => server.close(() => resolve())); return address.port; }
async function docker(...args: string[]) { return execFile('docker', args, { timeout: 60000 }); }
beforeAll(async () => {
  if (process.env.JARVIS_TEST_DB_URL) throw new Error('Fault injection requires isolated containers; external DB refused');
  const pgPort = await port(), redisPort = await port();
  names.push(`${prefix}-pg`, `${prefix}-redis`);
  await docker('run', '-d', '--name', names[0]!, '-p', `127.0.0.1:${pgPort}:5432`, '-e', 'POSTGRES_USER=jarvis', '-e', 'POSTGRES_PASSWORD=jarvis', '-e', 'POSTGRES_DB=jarvis', 'pgvector/pgvector:pg16');
  await docker('run', '-d', '--name', names[1]!, '-p', `127.0.0.1:${redisPort}:6379`, 'redis:7-alpine');
  pg = createPg({ url: `postgres://jarvis:jarvis@127.0.0.1:${pgPort}/jarvis`, statementTimeoutMs: 30000 });
  await vi.waitFor(async () => expect(await pg!.ping()).toBe(true), { timeout: 180000, interval: 500 });
  await runMigrations(pg.sql);
  kernel = buildKernel(loadConfig({ dbUrl: `postgres://jarvis:jarvis@127.0.0.1:${pgPort}/jarvis`, redisUrl: `redis://127.0.0.1:${redisPort}`, natsEnabled: false, telemetryDisabled: true, diagnosticsPort: 0, modeMinDwellMs: 1 }), { pg, noHttp: false });
  await kernel.start();
  await kernel.state.mutate({ key: 'active_workspace', value: { workspaceId: 'survives-isolated-outage' }, expectedVersion: -1, correlationId: 'fault-proof', actor: { kind: 'principal', id: kernel.config.bootstrapPrincipalId }, reason: 'Qualification evidence' });
}, 300000);
afterAll(async () => { for (const name of names) await docker('start', name).catch(() => undefined); await kernel?.stop().catch(() => undefined); await pg?.close().catch(() => undefined); for (const name of names) await docker('rm', '-f', name).catch(() => undefined); }, 120000);

it('loses real Redis beneath a running Kernel without losing PostgreSQL authority, then reconnects', async () => {
  expect(await kernel!.ephemeral.ping()).toBe(true);
  await docker('stop', names[1]!);
  await vi.waitFor(() => expect(kernel!.health.report().subsystems.find(s => s.subsystem === 'redis')?.status).toBe('OFFLINE'), { timeout: 45000, interval: 250 });
  expect((await kernel!.state.view()).slices.active_workspace?.value).toEqual({ workspaceId: 'survives-isolated-outage' });
  const picture = await fetch(`http://127.0.0.1:${kernel!.diagnosticsPort}/diagnostics`).then(r => r.json());
  expect(picture.dependencies.find((d: { name: string }) => d.name === 'redis').status).toBe('OFFLINE');
  await docker('start', names[1]!);
  await vi.waitFor(async () => expect(await kernel!.ephemeral.ping()).toBe(true), { timeout: 30000, interval: 250 });
  await vi.waitFor(() => expect(kernel!.health.report().subsystems.find(s => s.subsystem === 'redis')?.status).toBe('HEALTHY'), { timeout: 45000, interval: 250 });
}, 120000);

it('reports real PostgreSQL loss, refuses a durable mutation and recovers the same authoritative state', async () => {
  await docker('stop', names[0]!);
  await vi.waitFor(() => expect(kernel!.health.report().subsystems.find(s => s.subsystem === 'postgres')?.status).toBe('OFFLINE'), { timeout: 60000, interval: 500 });
  expect(kernel!.health.report().criticalIssues.some(issue => issue.startsWith('postgres: OFFLINE'))).toBe(true);
  expect(await kernel!.state.mutate({ key: 'active_workspace', value: { workspaceId: 'must-not-commit' }, expectedVersion: -1, correlationId: 'refused-during-outage', actor: { kind: 'principal', id: kernel!.config.bootstrapPrincipalId }, reason: 'Must fail closed' })).toMatchObject({ok:false});
  await docker('start', names[0]!);
  await vi.waitFor(async () => expect(await pg!.ping()).toBe(true), { timeout: 60000, interval: 250 });
  await vi.waitFor(() => expect(kernel!.health.report().subsystems.find(s => s.subsystem === 'postgres')?.status).toBe('HEALTHY'), { timeout: 60000, interval: 500 });
  expect((await kernel!.state.view()).slices.active_workspace?.value).toEqual({ workspaceId: 'survives-isolated-outage' });
  // PostgreSQL accepting queries is only the first recovery milestone. The
  // real outbox relay must drain and restore critical event-fabric health.
  await vi.waitFor(async () => {
    expect(kernel!.health.criticalDepsHealthy()).toBe(true);
    expect(await kernel!.mode.current()).toBe('AMBIENT');
  }, { timeout: 45000, interval: 250 });
}, 180000);
