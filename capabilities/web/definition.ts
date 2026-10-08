import { z } from 'zod';
import { defineCapability } from '@jarvis/capability-sdk';
/** Network I/O, SSRF guards and HTML extraction belong to the Kernel web egress; the worker only relays. */
export const fetchInput = z.object({
  url: z.string().min(1).max(2048).regex(/^https?:\/\//, 'http(s) URL required'),
  maxChars: z.number().int().min(500).max(12000).optional(),
}).strict();
export const fetchOutput = z.object({
  url: z.string(), finalUrl: z.string(), status: z.number().int(), contentType: z.string(),
  title: z.string().max(300), description: z.string().max(600), text: z.string().max(12000),
  links: z.array(z.object({ url: z.string().max(2048), text: z.string().max(120) }).strict()).max(25),
  truncated: z.boolean(), bytes: z.number().int().nonnegative(), contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  redirects: z.array(z.string()).max(5), fetchedAt: z.string().datetime(), trust: z.literal('untrusted'),
}).strict();
export type WebFetchInput = z.infer<typeof fetchInput>;
export type WebFetchOutput = z.infer<typeof fetchOutput>;
export default defineCapability({
  id: 'capabilities.web', version: '1.1.0', provider: 'web', credentialKind: 'none',
  description: 'Read-only GET of one public http(s) page; returns sanitised text as untrusted evidence. Kernel grants control standing or per-request approval.',
  executionEnvironment: 'worker', auditPolicy: { hashInput: true, recordOutput: 'summary' }, privacyRequirements: { maxContentPrivacyClass: 'PUBLIC' },
  resourceKeySelector: 'url',
  actions: {
    fetch: {
      input: fetchInput, output: fetchOutput, risk: 'LOW', reversible: false, idempotent: true,
      requiredScopes: ['web.fetch'], approvalPolicy: 'default', timeoutMs: 20000,
      verificationStrategy: { kind: 'world-read', adapterRef: 'fetch' }, declaredEgress: ['public-internet:http,https'],
      sideEffects: [],
      async execute(ctx, input) { const parsed = fetchInput.parse(input); return fetchOutput.parse(await ctx.http({ method: 'GET', url: parsed.url })); },
      async verify() { return { verified: false, checks: [{ name: 'executor-readback', ok: false, detail: 'Executor owns verification' }] }; },
    },
  },
});
