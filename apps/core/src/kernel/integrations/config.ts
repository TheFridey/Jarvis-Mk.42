import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DomainKinds, type DomainKind, type Grant } from '@jarvis/contracts';
import email from '../../../../../capabilities/email/definition.ts';
import calendar from '../../../../../capabilities/calendar/definition.ts';
import scalesmiths from '../../../../../capabilities/scalesmiths/definition.ts';
import { googleMaterial, scaleMaterial } from './transport.ts';
const schema = z.object({
  email: z.record(z.unknown()).optional(), calendar: z.record(z.unknown()).optional(), scalesmiths: z.record(z.unknown()).optional(),
  writeScopes: z.array(z.string()).default([]),
  domains: z.record(z.object({id:z.string().min(1).max(200),kind:z.enum(DomainKinds),name:z.string().min(1).max(200)}).strict()).default({}),
}).strict();
/** Read a protected operator-owned file; never expose its contents to agents or diagnostics. */
export function loadIntegrations(path: string | undefined, principalId: string, nodeId: string) {
  if(!path)return {capabilities:[],bootstrapGrants:[],credentialMaterial:{},domainDefinitions:[]};
  const config = schema.parse(JSON.parse(readFileSync(path,'utf8')));
  const capabilities:Array<{manifest:typeof email.manifest;moduleUrl:string}>=[];
  const domainDefinitions:Array<{id:string;principalId:string;kind:DomainKind;name:string}>=[];
  const bootstrapGrants:Grant[]=[];const credentialMaterial:Record<string,string>={};
  for(const [provider,definition] of Object.entries({email,calendar,scalesmiths})){
    const raw=config[provider as 'email'|'calendar'|'scalesmiths'];if(!raw)continue;
    // Adapter compatibility default; never the principal or reasoning identity.
    const domain=config.domains[provider]??(provider==='scalesmiths'?{id:`${principalId}:integration:${provider}`,kind:'BUSINESS' as const,name:'ScaleSmiths'}:{id:`${principalId}:personal`,kind:'PERSONAL' as const,name:'Personal'});
    domainDefinitions.push({...domain,principalId});
    const material:Record<string,unknown>=(provider==='scalesmiths'?scaleMaterial:googleMaterial).parse(raw);
    if(material.principalId!==principalId)throw new Error('Integration configuration principal mismatch');
    const writes=definition.manifest.actions.filter(action=>action.sideEffects.length>0).flatMap(action=>action.requiredScopes??[]);
    if(config.writeScopes.some(scope=>scope.startsWith(`${provider}.`)&&!writes.includes(scope)))throw new Error('Unknown integration write scope');
    const unsupported=provider==='scalesmiths'?definition.manifest.actions.filter(action=>action.name.endsWith('.update')&&!(Array.isArray(material.mutations)&&material.mutations.includes(action.name))).map(action=>action.name):[];
    const manifest={...definition.manifest,actions:definition.manifest.actions.filter(action=>!unsupported.includes(action.name))};
    manifest.requiredScopes=[...new Set(manifest.actions.flatMap(action=>action.requiredScopes??[]))];
    capabilities.push({manifest,moduleUrl:new URL(`../../../../../capabilities/${provider}/definition.ts`,import.meta.url).href});
    credentialMaterial[provider]=JSON.stringify(material);
    const scopes=manifest.actions.filter(action=>action.sideEffects.length===0||config.writeScopes.includes(`${provider}.${action.name}`)).flatMap(action=>action.requiredScopes??[]);
    bootstrapGrants.push({domainId:domain.id,id:`integrations:${provider}:${principalId}:${nodeId}`,principalId,holder:{kind:'principal',id:principalId},scopes,maxRiskWithoutLiveApproval:'LOW',mayProceedWithoutLiveApproval:true,issuedAt:new Date().toISOString(),version:1,resourceConstraints:[],nodeConstraints:[nodeId],timeWindows:[]});
  }
  return {capabilities,bootstrapGrants,credentialMaterial,domainDefinitions};
}
