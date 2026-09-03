import type { CredentialHandle } from '@jarvis/contracts';
import type { CapabilityModule } from './define.ts';

export async function runAction(module: CapabilityModule, name: string, input: unknown, opts: { credential: CredentialHandle; mode: 'dry-run' | 'full' }) {
  const action = module.actions[name];
  if (!action) throw new Error(`unknown action: ${name}`);
  const parsed = action.input.parse(input);
  const controller = new AbortController();
  const ctx = { input: parsed, mode: opts.mode, credential: opts.credential, abortSignal: controller.signal,
    log: () => undefined, http: async () => { throw new Error('testkit http not configured'); } };
  const output = await action.execute(ctx, parsed as never);
  const verify = await action.verify(ctx, parsed as never, output as never);
  return { output, verify, rollback: action.rollback ? () => action.rollback!(ctx, parsed as never, undefined) : undefined };
}
