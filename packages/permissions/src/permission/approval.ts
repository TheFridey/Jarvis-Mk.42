import type { ApprovalRequest } from '@jarvis/contracts';
export type ApprovalEvent =
  | { kind: 'reject' | 'expire'; at: string }
  | { kind: 'authorise'; by: string; at: string; sessionId?: string; authTrustLevel?: string }
  | { kind: 'confirm'; phraseHash: string; at: string; sessionId?: string; authTrustLevel?: string };
export interface ApprovalState extends ApprovalRequest { sessionId?: string; authorisationKinds?: Array<'operator' | 'confirmation'>; }
export function approvalReducer(state: ApprovalState, event: ApprovalEvent): ApprovalState {
  if (state.state !== 'pending') return state;
  if (event.kind === 'reject' || event.kind === 'expire') return { ...state, state: event.kind === 'reject' ? 'rejected' : 'expired', decidedAt: event.at };
  if (!('authTrustLevel' in event)) return state;
  if (state.requiredAuthorisations > 1 && (event.authTrustLevel !== 'verified' || event.sessionId !== state.sessionId)) return state;
  const kind = event.kind === 'authorise' ? 'operator' : 'confirmation';
  const kinds = [...new Set([...(state.authorisationKinds ?? []), kind])] as Array<'operator' | 'confirmation'>;
  const approved = kinds.length >= state.requiredAuthorisations;
  return { ...state, authorisationKinds: kinds, receivedAuthorisations: kinds.length, state: approved ? 'approved' : 'pending', decidedAt: approved ? event.at : undefined,
    confirmationPhraseHash: event.kind === 'confirm' ? event.phraseHash : state.confirmationPhraseHash };
}
