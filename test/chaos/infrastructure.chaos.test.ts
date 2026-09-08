/**
 * Infrastructure FAULT-INJECTION MECHANISM tests.
 *
 * SCOPE — read this before trusting the names below. These tests prove that the
 * fault-injection primitives this repo relies on actually work on the host:
 * real containers can be stopped and restarted, a real HTTP listener can be
 * torn down and rebound, and a real child process can be killed and replaced.
 *
 * They do NOT connect a running Kernel to those dependencies, so they do NOT
 * prove JARVIS's degradation/recovery behaviour. That gap is deliberate and
 * recorded as debt in docs/architecture/MK42_RELEASE_CANDIDATE_AUDIT.md
 * ("real fault injection against a live Kernel"). Kernel-side degradation logic
 * is covered deterministically in `foundation.chaos.test.ts` (health policy →
 * DEGRADED/OFFLINE, Redis non-authoritative, adapter-host worker containment,
 * deadline kill, duplicate-delivery suppression, lifecycle illegality).
 *
 * RC-audit fix: this file previously claimed to stop/recover "real NATS, Redis
 * and PostgreSQL" for JARVIS, to interrupt "a real Model Gateway", and to kill
 * "Adapter Host worker processes" — none of which were the system under test.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFile as cb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
const execFile = promisify(cb);
const names: string[] = [];
const suffix = `${Date.now()}-${process.pid}`;
async function run(image: string, name: string, args: string[] = []) { names.push(name); await execFile('docker', ['run', '-d', '--name', name, ...args, image], { timeout: 60000 }); return name; }
async function state(n: string) { return (await execFile('docker', ['inspect', '-f', '{{.State.Status}}', n])).stdout.trim(); }

describe('infrastructure fault-injection mechanisms (host-level, JARVIS not in the loop)', () => {
  afterAll(async () => { for (const n of names) await execFile('docker', ['rm', '-f', n]).catch(() => undefined); }, 60000);

  it('can stop and restart real NATS, Redis and PostgreSQL containers on this host', async () => {
    for (const [image, base, args] of [['nats:2.10-alpine', 'nats', []], ['redis:7-alpine', 'redis', []], ['postgres:16-alpine', 'postgres', ['-e', 'POSTGRES_PASSWORD=test']]] as const) {
      const n = await run(image, `jarvis-chaos-${base}-${suffix}`, [...args]);
      expect(await state(n)).toBe('running');
      await execFile('docker', ['stop', n], { timeout: 30000 });
      expect(await state(n)).toBe('exited');
      await execFile('docker', ['start', n], { timeout: 30000 });
      expect(await state(n)).toBe('running');
    }
  }, 180000);

  it('can tear down and rebind an HTTP listener (the Model Gateway process boundary shape)', async () => {
    const server = createServer((_q, r) => r.end('ok'));
    await new Promise<void>((r) => { server.listen(0, '127.0.0.1', () => r()); });
    expect(server.listening).toBe(true);
    await new Promise<void>((r) => { server.close(() => r()); });
    expect(server.listening).toBe(false);
    await new Promise<void>((r) => { server.listen(0, '127.0.0.1', () => r()); });
    expect(server.listening).toBe(true);
    await new Promise<void>((r) => { server.close(() => r()); });
  });

  it('can kill and replace a child process (the Adapter Host worker shape)', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    expect(child.pid).toBeGreaterThan(0);
    child.kill();
    await new Promise((r) => child.once('exit', r));
    const replacement = spawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise((r) => replacement.once('exit', r));
    expect(replacement.exitCode).toBe(0);
  });
});
