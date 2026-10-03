import type { SelectedFrameDecision, SelectedFrameRequest } from '@jarvis/contracts';
export interface SelectedFrameAuthorisation {approvalId:string;requestId:string;principalId:string;imageRef:string;privacyClass:SelectedFrameRequest['privacyClass'];expiresAt:string;policyAllowed:boolean;privacyChecked:boolean;verifiedByKernel:true}
/** Projection of a Kernel-verified decision, never an authorisation issuer or a cloud transport. */
export function evaluateSelectedFrame(request:SelectedFrameRequest,approval?:SelectedFrameAuthorisation|string,now=Date.now()):SelectedFrameDecision {
 if(!request.imageRef.startsWith('local-object://'))return{allowed:false,requiresApproval:false,reason:'frame must be a local object-store reference'};
 if(request.privacyClass==='RESTRICTED')return{allowed:false,requiresApproval:false,reason:'restricted frames cannot be sent to cloud vision'};
 if(!approval||typeof approval==='string')return{allowed:false,requiresApproval:true,reason:'Kernel-verified policy, privacy and bound approval are required'};
 const bound=approval.verifiedByKernel===true&&approval.policyAllowed&&approval.privacyChecked&&approval.approvalId.length>0&&approval.requestId===request.requestId&&approval.principalId===request.principalId&&approval.imageRef===request.imageRef&&approval.privacyClass===request.privacyClass&&Date.parse(approval.expiresAt)>now;
 return{allowed:bound,requiresApproval:!bound,reason:bound?'bound approval projection; transmission still requires Kernel authority':'approval binding, expiry, policy or privacy check failed'};
}
