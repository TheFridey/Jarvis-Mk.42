import { withSpan } from '@jarvis/telemetry';
import { z } from 'zod';
import type { CapabilityInvocationProposal, EventActor, InvocationResult } from '@jarvis/contracts';
import type { CapabilityExecutor } from '../executor/executor.ts';

const proposalSchema = z.object({
  proposalId: z.string().min(1), kind: z.literal('capability_invocation'), correlationId: z.string().min(1), confidence: z.number().min(0).max(1),
  provenance: z.object({ method: z.enum(['sensor','model','retrieval','inference','assertion','derivation','system']), producedBy: z.string().min(1), producedOn: z.string().min(1), producedAt: z.string().datetime(), correlationId: z.string().min(1), derivedFromUntrusted: z.boolean(), sourceRefs: z.array(z.string()).optional(), model: z.object({ id: z.string(), version: z.string() }).optional() }),
  invocation: z.object({ capabilityId: z.string().min(1), capabilityVersion: z.string().min(1), action: z.string().min(1), input: z.unknown() }), justification: z.string().min(1),
});

export interface AgencyPrincipal { principalId: string; authenticated: boolean; }
export class AgencyIngress {
  private accepting = true;
  constructor(private readonly executor: CapabilityExecutor,private readonly onVerified?:(proposal:CapabilityInvocationProposal,result:InvocationResult,principalId:string)=>Promise<void>) {}
  stop() { this.accepting = false; }
  /** Cognitive replay may observe an existing effect, never resume approval. */
  async submitOnce(input: unknown, principal: AgencyPrincipal): Promise<InvocationResult> {
    return this.submit(input, principal, { approvalResume:false });
  }
  async submit(input: unknown, principal: AgencyPrincipal, options?: { approvalResume?: boolean }): Promise<InvocationResult> {
    if (!this.accepting) throw new Error('agency ingress unavailable');
    if (!principal.authenticated || !principal.principalId) throw new Error('authenticated principal required');
    const parsed = proposalSchema.safeParse(input); if (!parsed.success) throw new Error('invalid capability proposal');
    const actor: EventActor = { kind: 'principal', id: principal.principalId };
    return withSpan('agency.proposal', {'jarvis.correlation_id':parsed.data.correlationId,'jarvis.causation_id':parsed.data.proposalId}, async()=>{const proposal=parsed.data as CapabilityInvocationProposal;const result=await this.executor.invoke(proposal,actor,options);if(result.outcome==='verified')await this.onVerified?.(proposal,result,principal.principalId);return result;});
  }
}
