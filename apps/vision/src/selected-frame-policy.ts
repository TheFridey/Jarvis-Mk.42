import type { SelectedFrameDecision, SelectedFrameRequest } from '@jarvis/contracts';
export function evaluateSelectedFrame(request: SelectedFrameRequest, approvalRef?: string): SelectedFrameDecision {
  if (!request.imageRef.startsWith('local-object://')) return { allowed: false, requiresApproval: false, reason: 'frame must be a local object-store reference' };
  if (request.privacyClass === 'RESTRICTED') return { allowed: false, requiresApproval: false, reason: 'restricted frames cannot be sent to cloud vision' };
  if (!approvalRef) return { allowed: false, requiresApproval: true, reason: 'selected-frame cloud transmission requires an Agency approval bound to this request' };
  return { allowed: true, requiresApproval: false, reason: `approved selected-frame transmission ${approvalRef}` };
}
