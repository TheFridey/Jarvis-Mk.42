/**
 * Throwaway PostgreSQL for integration tests, driven by the `docker` CLI (no
 * testcontainers dependency). Strategy per the spec: "compose for dev,
 * throwaway containers for CI".
 *
 *  - If JARVIS_TEST_DB_URL is set, use it (a shared dev stack) and skip Docker.
 *  - Else, if `docker` is available, run a disposable `pgvector/pgvector:pg16`
 *    container, wait for readiness, and tear it down afterwards.
 *  - Else, `isDockerAvailable()` returns false and suites self-skip.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';

const execFile = promisify(execFileCb);

/** Thrown by the host-side connectivity probe loop when the published port never
 *  becomes connectable. A sentinel class so the outer readiness loop can
 *  re-throw it by `instanceof` rather than matching a message string. */
class ProbeUnreachable extends Error {}

export async function isDockerAvailable(): Promise<boolean> {
  if (process.env.JARVIS_TEST_DB_URL) return true;
  if (process.env.JARVIS_NO_DOCKER === '1') return false;
  // `docker ps` needs a live daemon but avoids the version-negotiation route
  // that some Docker Desktop builds return 500 for. Retry before concluding
  // "unavailable": under the load of many sequential ephemeral containers,
  // a single transient CLI stall must not be misread as no Docker, which
  // would silently skip real integration coverage while still reporting green.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await execFile('docker', ['ps', '--quiet'], { timeout: 15_000 });
      return true;
    } catch {
      if (attempt < 3) await delay(1_000);
    }
  }
  return false;
}

export interface EphemeralPg {
  url: string;
  stop(): Promise<void>;
}

const IMAGE = 'pgvector/pgvector:pg16';

export async function startEphemeralPg(): Promise<EphemeralPg> {
  const external = process.env.JARVIS_TEST_DB_URL;
  if (external) {
    return { url: external, stop: async () => undefined };
  }

  const name = `jarvis-it-pg-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await execFile('docker', [
    'run', '-d', '--rm',
    '--name', name,
    // Disposable logical-transaction tests do not certify physical disk crash
    // durability. tmpfs avoids Docker Desktop VHD fsync stalls during initdb;
    // server fsync/commit settings remain unchanged. Container removal loses it.
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
    '-e', 'POSTGRES_USER=jarvis',
    '-e', 'POSTGRES_PASSWORD=jarvis',
    '-e', 'POSTGRES_DB=jarvis',
    '-p', '127.0.0.1::5432',
    IMAGE,
  ]);

  const { stdout: published } = await execFile('docker', ['port', name, '5432/tcp']);
  const port = published.trim().match(/:(\d+)$/)?.[1];
  if (!port) { await execFile('docker', ['rm', '-f', name]).catch(() => undefined); throw new Error('docker did not publish PostgreSQL port'); }
  const url = `postgres://jarvis:jarvis@127.0.0.1:${port}/jarvis`;
  const stop = async () => {
    await execFile('docker', ['rm', '-f', name]).catch(() => undefined);
  };

  // wait for readiness
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFile('docker', ['exec', name, 'pg_isready', '-U', 'jarvis', '-d', 'jarvis']);
      if (/accepting connections/.test(stdout)) {
        // pg_isready says the server is up *inside* the container; now confirm the
        // published port is actually connectable from the host before handing back the url.
        for (let attempt = 1; ; attempt++) {
          const probe = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
          try {
            await probe`select 1`;
            await probe.end({ timeout: 5 });
            return { url, stop };
          } catch {
            await probe.end({ timeout: 5 }).catch(() => undefined);
            if (attempt >= 20 || Date.now() >= deadline) {
              await stop();
              throw new ProbeUnreachable(
                'ephemeral postgres port not connectable from host after readiness',
              );
            }
            await delay(500);
          }
        }
      }
    } catch (err) {
      // If the error is from the probe loop (port not connectable), propagate it.
      if (err instanceof ProbeUnreachable) {
        throw err;
      }
      /* not ready */
    }
    await delay(750);
  }
  await stop();
  throw new Error('ephemeral postgres did not become ready in 60s');
}

/** Kill a container by name (resilience tests that stop a dependency mid-run). */
export async function dockerKill(name: string): Promise<void> {
  await execFile('docker', ['kill', name]).catch(() => undefined);
}
export async function dockerStart(name: string): Promise<void> {
  await execFile('docker', ['start', name]).catch(() => undefined);
}
