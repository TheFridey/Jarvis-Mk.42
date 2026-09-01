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

const execFile = promisify(execFileCb);

export async function isDockerAvailable(): Promise<boolean> {
  if (process.env.JARVIS_TEST_DB_URL) return true;
  if (process.env.JARVIS_NO_DOCKER === '1') return false;
  try {
    // `docker ps` needs a live daemon but avoids the version-negotiation route
    // that some Docker Desktop builds return 500 for.
    await execFile('docker', ['ps', '--quiet'], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
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
  const port = 20000 + Math.floor(Math.random() * 20000);

  await execFile('docker', [
    'run', '-d', '--rm',
    '--name', name,
    '-e', 'POSTGRES_USER=jarvis',
    '-e', 'POSTGRES_PASSWORD=jarvis',
    '-e', 'POSTGRES_DB=jarvis',
    '-p', `${port}:5432`,
    IMAGE,
  ]);

  const url = `postgres://jarvis:jarvis@localhost:${port}/jarvis`;
  const stop = async () => {
    await execFile('docker', ['rm', '-f', name]).catch(() => undefined);
  };

  // wait for readiness
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFile('docker', ['exec', name, 'pg_isready', '-U', 'jarvis', '-d', 'jarvis']);
      if (/accepting connections/.test(stdout)) {
        await delay(500);
        return { url, stop };
      }
    } catch {
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
