/**
 * JARVIS Kernel entrypoint. `pnpm core:dev` / `pnpm --filter @jarvis/core start`.
 *
 * Expects the dev stack up (`pnpm stack:up`) and migrations applied
 * (`pnpm db:migrate`). Handles SIGINT/SIGTERM for graceful shutdown.
 */
import '../../../scripts/local-env.ts';
import { buildKernel } from './kernel/lifecycle/kernel.ts';
import { loadConfig } from './runtime/config.ts';
import { loadIntegrations } from './kernel/integrations/config.ts';
import { loadWebFetch } from './kernel/integrations/web-config.ts';

const config = loadConfig();
const loadedIntegrations = loadIntegrations(process.env.JARVIS_INTEGRATIONS_CONFIG,config.bootstrapPrincipalId,config.nodeId);
const web = loadWebFetch(config.bootstrapPrincipalId,config.nodeId);
const integrations = {...loadedIntegrations,capabilities:[...loadedIntegrations.capabilities,...web.capabilities],bootstrapGrants:[...loadedIntegrations.bootstrapGrants,...web.bootstrapGrants]};
const selectedCaptureEnabled=process.env.JARVIS_ENABLE_SELECTED_CAPTURE==='1';
if(selectedCaptureEnabled&&process.platform!=='win32')throw new Error('selected-region capture requires the Windows workstation adapter');
const windows=selectedCaptureEnabled?(await import('../../../capabilities/windows/definition.ts')).default:undefined;
const kernel = buildKernel(config, { autoMigrate: true,credentialMaterial:integrations.credentialMaterial,webFetch:web.policy,...(windows?{capabilities:[...integrations.capabilities,{manifest:windows.manifest,moduleUrl:new URL('../../../capabilities/windows/definition.ts',import.meta.url).href}],bootstrapGrants:[...integrations.bootstrapGrants,{id:`selected-capture:${config.bootstrapPrincipalId}:${config.nodeId}`,principalId:config.bootstrapPrincipalId,holder:{kind:'principal' as const,id:config.bootstrapPrincipalId},scopes:['windows.screen.read','windows.screen.capture'],maxRiskWithoutLiveApproval:'AMBIENT' as const,mayProceedWithoutLiveApproval:false,issuedAt:new Date().toISOString(),version:1,resourceConstraints:[],nodeConstraints:[config.nodeId],timeWindows:[]}]}:{capabilities:integrations.capabilities,bootstrapGrants:integrations.bootstrapGrants}) });

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
    `[kernel] operational  mode=${report.mode}  diagnostics=http://${config.diagnosticsHost}:${kernel.diagnosticsPort}/diagnostics\n`,
  );
} catch (err) {
  process.stderr.write(`[kernel] failed to start: ${String(err)}\n`);
  await kernel.stop().catch(() => undefined);
  process.exit(1);
}
