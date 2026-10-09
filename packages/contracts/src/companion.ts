import type { DomainOwned } from './domain.ts';
import type { NodeDescriptor, RegisteredNode } from './node.ts';

export type CompanionSurface = 'mobile' | 'wall';
export interface CompanionTurn extends DomainOwned { id:string; conversationId:string; input:string; answer:string|null; status:'running'|'completed'|'failed'; sourceNodeId:string; createdAt:string; }
export interface CompanionPicture {
  schemaVersion:1; generatedAt:string; stateVersion:number; sceneVersion:number; surface:CompanionSurface;
  mode:string; interaction:string; work:string; health:string; objective:string|null;
  alerts:string[]; workflows:Array<{id:string;action:string;state:string}>;
  agents:Array<{id:string;state:string;parentId:string|null}>;
  business:Array<{name:string;status:string}>; nextMeeting:string|null;
  conversations?:CompanionTurn[];
  sceneChoices?:Array<{id:string;title:string}>;
  displays?:Array<{id:string}>;
  presented?:{objectId:string;title:string;summary:string;resourceRefs:string[];expiresAt:string};
  notification?:{id:string;title:string;body:string;severity:string};
}
export function companionDescriptor(nodeId:string,surface:CompanionSurface):NodeDescriptor {
  return {nodeId,nodeType:surface==='mobile'?'mobile':'display',protocolVersion:'1',requestedTrustTier:'owned-mobile',sensors:[],capabilities:[],surfaces:[surface==='mobile'?'mobile-companion':'wall-display'],attributes:{}};
}
/** Node type never implies workstation authority. Guests receive basic status only. */
export function companionScopes(node:Pick<RegisteredNode,'nodeType'|'trustTier'>):string[] {
  if(node.trustTier==='guest')return [];
  if(node.nodeType==='mobile')return ['companion.read','companion.converse','companion.present'];
  if(node.nodeType==='display')return ['companion.read'];
  return [];
}
