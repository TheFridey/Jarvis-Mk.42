/**
 * JARVIS Kernel entrypoint. `pnpm core:dev` / `pnpm --filter @jarvis/core start`.
 *
 * Expects the dev stack up (`pnpm stack:up`) and migrations applied
 * (`pnpm db:migrate`). Handles SIGINT/SIGTERM for graceful shutdown.
 */
import { buildKernel } from './kernel/lifecycle/kernel.ts';
import { loadConfig } from './runtime/config.ts';

const config = loadConfig();
const kernel = buildKernel(config, { autoMigrate: true });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stderr.write(`\n[kernel] ${signal} received, shutting down...\n`);
  try {
    await kernel.stop();
    process.stderr.write('[kernel] stopped cleanly\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[kernel] shutdown error: ${String(err)}\n`);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[kernel] unhandledRejection: ${String(reason)}\n`);
});

try {
  await kernel.start();
  const report = await kernel.diagnostics.report();
  process.stderr.write(
    `[kernel] operational  mode=${report.mode}  diagnostics=http://localhost:${kernel.diagnosticsPort}/diagnostics\n`,
  );
} catch (err) {
  process.stderr.write(`[kernel] failed to start: ${String(err)}\n`);
  await kernel.stop().catch(() => undefined);
  process.exit(1);
}
