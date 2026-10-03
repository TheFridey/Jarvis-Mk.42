import { context, withTraceContext } from '@jarvis/telemetry';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ModelRequest, ModelResponse, AgentManifest } from '@jarvis/contracts';
import type { ModelGatewayPort } from './model-client.ts';

/** Parent mediates a single immutable request; IPC grants no tool/event authority. */
export function runAgentWorker(d: {
  jobId: string; request: ModelRequest; gateway: ModelGatewayPort; signal: AbortSignal;
  onSpawn: (pid: number) => Promise<void>; heartbeat: () => Promise<void>;
  beforeInference: () => Promise<void>;
  onRouting?: (routing: NonNullable<ModelResponse['routing']>) => Promise<void>;
  proposalScope?: AgentManifest['proposalScope'];
  onIsolation?: (boundary:{ environmentKeys:string[]; canWriteFiles:false; canSpawnChildren:false; canReadWorkspace:false }) => void;
}): Promise<ModelResponse> {
  const parentTrace = context.active();
  return new Promise((resolve, reject) => {
    const path = fileURLToPath(new URL('./agent-worker.mjs', import.meta.url));
    const child = spawn(process.execPath, ['--experimental-permission', `--allow-fs-read=${path}`, '--max-old-space-size=64', path], {
      env: { NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const nonce = randomUUID();
    const controller = new AbortController();
    let buffer = '', settled = false, requested = false, isolationChecked = false;
    let outcome: { error?: unknown; response?: ModelResponse };
    let generatedResponse: ModelResponse | undefined;
    let chain = Promise.resolve();
    const finish = (error?: unknown, response?: ModelResponse) => {
      if (settled) return;
      settled = true; controller.abort(); child.kill();
      outcome = { error, response };
      d.signal.removeEventListener('abort', abort);
    };
    const abort = () => finish(new Error('agent worker cancelled or timed out'));
    d.signal.addEventListener('abort', abort, { once: true });
    child.on('error', finish);
    child.stdin.on('error', finish);
    // Never forward stderr (may contain untrusted model content).
    child.stderr.resume();
    child.on('close', () => {
      if (!settled) finish(new Error('agent worker exited without validated completion'));
      if (outcome.error) reject(outcome.error); else resolve(outcome.response!);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > 2_000_000) { finish(new Error('agent worker frame exceeds limit')); return; }
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        chain = chain.then(async () => {
          if (settled) return;
          const message = JSON.parse(line) as { jobId: string; nonce: string; type: string; payload?: ModelResponse };
          if (message.jobId !== d.jobId || message.nonce !== nonce) throw new Error('agent IPC binding mismatch');
          if (message.type === 'isolation' && !isolationChecked && !requested) {
            const boundary = message.payload as unknown as {environmentKeys:string[];canWriteFiles:false;canSpawnChildren:false;canReadWorkspace:false};
            if (!Array.isArray(boundary?.environmentKeys) || boundary.environmentKeys.some(key=>!['NODE_ENV','SYSTEMROOT'].includes(key.toUpperCase())) || boundary.canWriteFiles !== false || boundary.canSpawnChildren !== false || boundary.canReadWorkspace !== false) throw new Error('agent process isolation preflight failed');
            isolationChecked = true; d.onIsolation?.(boundary); return;
          }
          if (message.type === 'heartbeat') { await d.heartbeat(); return; }
          if (message.type === 'model_request' && !requested && isolationChecked) {
            requested = true;
            await d.beforeInference();
            // Do not block heartbeat processing on provider latency.
            void withTraceContext(parentTrace,()=>d.gateway.generate(d.request, controller.signal, d.onRouting)).then(response => {
              generatedResponse = response;
              const frame = JSON.stringify({ jobId: d.jobId, nonce, type: 'model_result', payload: response });
              if (Buffer.byteLength(frame) > 1_000_000) throw new Error('model result exceeds agent transport budget');
              if (!settled) child.stdin.write(`${frame}\n`);
            }).catch(finish);
            return;
          }
          if (message.type === 'result' && requested && message.payload && generatedResponse && JSON.stringify(message.payload) === JSON.stringify(generatedResponse)) { finish(undefined, generatedResponse); return; }
          throw new Error('agent IPC operation not permitted');
        }).catch(finish);
      }
    });
    void (async () => {
      if (d.signal.aborted) { abort(); return; }
      if (!child.pid) throw new Error('agent worker missing pid');
      await d.onSpawn(child.pid);
      if (!settled) child.stdin.write(`${JSON.stringify({ jobId: d.jobId, nonce, type: 'start', payload: { context: d.request.input.context, proposalSchemaVersion:1, proposalScope:d.proposalScope } })}\n`);
    })().catch(finish);
  });
}
