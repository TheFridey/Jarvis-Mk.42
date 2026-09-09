/**
 * Throwaway NATS JetStream for integration tests, driven by the `docker` CLI —
 * the sibling of `pg-container.ts`.
 *
 * Port strategy differs from Postgres on purpose. `startEphemeralPg` uses
 * `-p 127.0.0.1::5432` and lets Docker allocate, which is collision-free. That
 * is wrong here: the JetStream suites stop and restart the container to test
 * reconnection, and Docker allocates an unspecified host port at *start* time,
 * so a restarted container can come back on a different port. The cached URL —
 * and, worse, the `NatsEventBus` reconnect target inside the Kernel under test —
 * would then point at nothing, which is not the failure the test is trying to
 * observe.
 *
 * So the host port is explicit, and the collision risk that creates is handled
 * by retrying rather than by hoping: pick a free port, try to run, and on a bind
 * failure pick another. Picking a port in-process and passing it to `docker run`
 * is inherently racy — another container can be given it in the window between
 * probe and bind — but a retry loop converges, whereas a single attempt turns
 * that race into a red suite (observed under `JARVIS_IT_WORKERS=2`).
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { connect as netConnect, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const execFile = promisify(execFileCb);

const IMAGE = 'nats:2.10-alpine';

export interface EphemeralNats {
  /** `nats://127.0.0.1:<port>` — stable across stop/start. */
  url: string;
  name: string;
  stop(): Promise<void>;
  start(): Promise<void>;
  remove(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * Probe until nats-server is genuinely serving, not merely reachable.
 *
 * A TCP connect is not sufficient: Docker's userland port proxy binds the host
 * port as soon as the container starts and accepts connections before
 * nats-server is listening inside, so a plain connect returns a false ready and
 * the caller's first real client call fails with CONNECTION_REFUSED (observed).
 * nats-server greets every accepted connection with an `INFO {...}` line, so
 * waiting for that line is a true protocol-level readiness check — and it keeps
 * this package free of a dependency on the `nats` client.
 */
async function waitForPort(port: number, name: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never attempted';
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (value: boolean, why?: string) => {
        if (settled) return;
        settled = true;
        if (why) lastError = why;
        client.destroy();
        resolve(value);
      };
      const client = netConnect({ host: '127.0.0.1', port });
      client.setTimeout(2_000);
      client.on('data', (chunk: Buffer) => {
        const greeting = chunk.toString('utf8');
        done(greeting.startsWith('INFO'), greeting.startsWith('INFO') ? undefined : `unexpected greeting: ${greeting.slice(0, 40)}`);
      });
      client.on('error', (err: Error) => done(false, err.message));
      client.on('timeout', () => done(false, 'no INFO greeting within 2s'));
      client.on('close', () => done(false, 'closed before greeting'));
    });
    if (ok) return;
    await delay(250);
  }
  const logs = await execFile('docker', ['logs', '--tail', '20', name]).catch(() => ({ stdout: '', stderr: '<no logs>' }));
  throw new Error(`ephemeral NATS ${name} did not become ready on :${port} (last error: ${lastError})\n${logs.stdout}${logs.stderr}`);
}

export async function startEphemeralNats(prefix = 'jarvis-it-nats'): Promise<EphemeralNats> {
  const name = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  let port = 0;

  let lastError: unknown;
  for (let attempt = 1; attempt <= 8; attempt++) {
    port = await freePort();
    try {
      await execFile('docker', [
        'run', '-d',
        '--name', name,
        '-p', `127.0.0.1:${port}:4222`,
        IMAGE, '-js', '-sd', '/data',
      ]);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      // A failed `docker run` can still leave a created container holding the
      // name; clear it before retrying on a different port.
      await execFile('docker', ['rm', '-f', name]).catch(() => undefined);
      await delay(250);
    }
  }
  if (lastError) throw new Error(`could not start ephemeral NATS after 8 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);

  const url = `nats://127.0.0.1:${port}`;
  const handle: EphemeralNats = {
    url,
    name,
    async start() {
      await execFile('docker', ['start', name]);
      await waitForPort(port, name);
    },
    async stop() {
      await execFile('docker', ['stop', name], { timeout: 60_000 });
    },
    async remove() {
      await execFile('docker', ['rm', '-f', name]).catch(() => undefined);
    },
  };
  await waitForPort(port, name);
  return handle;
}
