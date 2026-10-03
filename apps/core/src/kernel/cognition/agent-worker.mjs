// Fixed, credentialless transport worker. It cannot select endpoints or tools.
// Node permissions are defense in depth, not a hostile-code/network sandbox.
import { createInterface } from 'node:readline';
// Windows injects baseline OS environment entries even with an explicit env.
// Remove them before accepting any job; agent code never needs these values.
for (const key of Object.keys(process.env)) if (key !== 'NODE_ENV') delete process.env[key];
const lines = createInterface({ input: process.stdin });
let binding;
let heartbeat;
let completing = false;
function send(type, payload, flushed) { process.stdout.write(`${JSON.stringify({ ...binding, type, payload })}\n`, flushed); }
lines.on('line', line => {
  if (line.length > 2_000_000) process.exit(2);
  try {
    const message = JSON.parse(line);
    if (!binding) {
      if (message.type !== 'start' || typeof message.jobId !== 'string' || typeof message.nonce !== 'string') process.exit(2);
      binding = { jobId: message.jobId, nonce: message.nonce };
      send('isolation', { environmentKeys:Object.keys(process.env), canWriteFiles:process.permission.has('fs.write'), canSpawnChildren:process.permission.has('child'), canReadWorkspace:process.permission.has('fs.read',process.cwd()) });
      send('model_request');
      heartbeat = setInterval(() => send('heartbeat'), 1000);
    } else {
      if (message.jobId !== binding.jobId || message.nonce !== binding.nonce || message.type !== 'model_result') process.exit(2);
      clearInterval(heartbeat);
      // Windows pipe writes can be asynchronous. Exit only after the result
      // frame is flushed, otherwise the parent observes an empty completion.
      completing = true;
      send('result', message.payload, () => process.exit(0));
      lines.close();
    }
  } catch { process.exit(2); }
});
lines.on('close', () => { clearInterval(heartbeat); if (!completing) process.exit(0); });
process.stdout.on('error', () => process.exit(2));
