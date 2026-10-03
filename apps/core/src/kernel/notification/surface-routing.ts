import type { JarvisMode, NodeTrustTier, NotificationRequest, PresenceState } from '@jarvis/contracts';
export interface DeliverySurface { id:string;principalId:string;kind:'desktop'|'mobile'|'wall';trust:NodeTrustTier;available:boolean;presence:PresenceState; }
const rank:Record<NodeTrustTier,number>={guest:0,'owned-mobile':1,'owned-secure':2,'kernel-local':3};
export function chooseDeliverySurface(req:NotificationRequest,surfaces:DeliverySurface[],mode:JarvisMode,presence:PresenceState):DeliverySurface|undefined {
  const urgent=req.urgency==='urgent'||req.urgency==='immediate';
  const eligible=surfaces.filter(s=>s.available&&s.principalId===req.principalId&&rank[s.trust]>=rank[req.minimumSurfaceTrust??'owned-mobile']);
  const score=(s:DeliverySurface)=> (s.presence==='ENGAGED'?60:s.presence==='PRESENT'?35:s.presence==='FOCUSED'?(urgent?60:10):0)
    +(s.kind==='mobile'&&(presence==='ABSENT'||presence==='UNKNOWN')?40:0)
    +(s.kind==='desktop'&&mode==='FOCUSED'?30:0)+(s.kind==='wall'&&mode==='AMBIENT'&&presence==='PRESENT'?25:0)
    +(urgent&&s.kind==='mobile'?15:0);
  return eligible.sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id))[0];
}
