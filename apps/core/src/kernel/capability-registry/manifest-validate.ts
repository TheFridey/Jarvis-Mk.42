import type { Capability } from '@jarvis/contracts';
const intrusion = /\b(exploit|bruteforce|port-scan|payload|c2|keylog|exfiltrate)\b/i;
export type ManifestValidation = { ok: true } | { ok: false; errors: Array<{ code: string; detail: string }> };
export function validateManifest(value: unknown): ManifestValidation {
  const errors: Array<{ code: string; detail: string }> = [];
  if (!value || typeof value !== 'object') return { ok: false, errors: [{ code: 'MALFORMED', detail: 'manifest must be an object' }] };
  const manifest = value as Capability;
  if (!/^capabilities\.[a-z][a-z0-9_]*$/.test(manifest.id ?? '')) errors.push({ code: 'INVALID_ID', detail: 'invalid id' });
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '')) errors.push({ code: 'INVALID_VERSION', detail: 'invalid version' });
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) errors.push({ code: 'NO_ACTIONS', detail: 'at least one action required' });
  for (const action of manifest.actions ?? []) {
    if (!action.verify || !action.verificationStrategy) errors.push({ code: 'VERIFY_REQUIRED', detail: `${action.name}: verify required` });
    if (action.reversible && action.sideEffects.length && (!action.rollback || !action.rollbackStrategy)) errors.push({ code: 'ROLLBACK_REQUIRED', detail: `${action.name}: rollback required` });
    if (action.riskClass === 'CRITICAL' && !action.confirmationPhrase) errors.push({ code: 'CONFIRMATION_REQUIRED', detail: `${action.name}: confirmation required` });
    if (action.sideEffects.some((effect) => intrusion.test(effect))) errors.push({ code: 'OFFENSIVE_FORBIDDEN', detail: `${action.name}: offensive capability forbidden` });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
