import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { AdapterJob, WorkerReply } from './ipc.ts';
const runtime = fileURLToPath(new URL('./worker-runtime.ts', import.meta.url));
export class AdapterHost {
  constructor(private readonly runtimePath=runtime){}
  async run(job: AdapterJob): Promise<{ output: unknown; log: Array<{ level: string; msg: string; fields?: Record<string, unknown> }>; workerPid: number }> {
    if (job.executionEnvironment === 'worker+container') throw new Error('container runner required');
    return new Promise((resolve, reject) => {
      const ipcSecret=randomBytes(32).toString('hex');const nonce=randomBytes(24).toString('base64url');const issuedAt=Date.now();const boundJob={...job,nonce,issuedAt};
      const child = spawn(process.execPath, ['--import', 'tsx', this.runtimePath], { env: { NODE_ENV: process.env.NODE_ENV ?? 'production', JARVIS_WORKER_IPC_SECRET:ipcSecret }, cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill(); reject(new Error('adapter timeout')); }, job.timeoutMs);
      let output = ''; child.stdout.on('data', (data) => { output += String(data); }); child.stderr.on('data', () => undefined);
      child.on('error', reject); child.on('close', () => { clearTimeout(timer); try { const reply = JSON.parse(output) as WorkerReply;const b=reply.binding;if(!b||b.invocationId!==job.invocationId||b.capabilityId!==job.capabilityId||b.action!==job.action||b.nonce!==nonce||b.issuedAt!==issuedAt||Date.now()-b.issuedAt>job.timeoutMs+1000)throw new Error('unbound or stale worker response');const expected=createHmac('sha256',ipcSecret).update(`${b.invocationId}\0${b.capabilityId}\0${b.action}\0${b.nonce}\0${b.issuedAt}`).digest();const actual=Buffer.from(b.mac,'hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('spoofed worker response');if (!reply.ok) reject(new Error(reply.error)); else resolve({ output: reply.output, log: reply.logs, workerPid: child.pid ?? -1 }); } catch (error) { reject(error); } });
      child.stdin.end(JSON.stringify(boundJob));
    });
  }
}
