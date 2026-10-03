import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9._:-]{3,128}$/);
export const descriptorSchema = z.object({
  nodeId:id,nodeType:z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{1,63}$/),
  protocolVersion:z.literal('1'), sensors:z.array(id).max(32),capabilities:z.array(id).max(32),
  surfaces:z.array(id).max(32),requestedTrustTier:z.enum(['guest','owned-mobile','owned-secure']),
  attributes:z.record(z.string().max(256)).refine(v=>Object.keys(v).length<=16),
}).strict();
export const enrollmentSchema = z.object({token:z.string().min(32).max(128),descriptor:descriptorSchema,softwareVersion:z.string().min(1).max(64)}).strict();
export const authenticationSchema = z.object({nodeId:id,expectedEpoch:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
const base={requestId:id,nodeId:id,sessionId:z.string().min(1).max(128),epoch:z.number().int().positive(),sequence:z.number().int().positive(),accessToken:z.string().min(32).max(128)};
export const frameSchema=z.discriminatedUnion('type',[
  z.object({...base,type:z.literal('DECLARE'),descriptor:descriptorSchema}).strict(),
  z.object({...base,type:z.literal('SUBSCRIBE'),channel:z.enum(['system-status','companion'])}).strict(),
  z.object({...base,type:z.literal('CONVERSE'),commandId:id,expectedStateVersion:z.number().int().nonnegative(),input:z.string().trim().min(1).max(4000),conversationId:id.optional()}).strict(),
  z.object({...base,type:z.literal('PRESENT'),displayNodeId:id,objectId:z.string().min(1).max(200),expectedSceneVersion:z.number().int().nonnegative()}).strict(),
  z.object({...base,type:z.literal('REVOKE_SELF')}).strict(),
  z.object({...base,type:z.literal('HEARTBEAT'),nonce:z.string().min(32).max(128)}).strict(),
  z.object({...base,type:z.literal('OPERATE'),operationId:id,observation:z.object({sensor:z.literal('runtime-health'),healthy:z.boolean()}).strict()}).strict(),
  z.object({...base,type:z.literal('ROTATE'),certificatePem:z.string().min(100).max(16384),proof:z.string().min(64).max(1024)}).strict(),
  z.object({...base,type:z.literal('DISCONNECT')}).strict(),
]);
export type NodeWireFrame=z.infer<typeof frameSchema>;
export interface NodeStatusProjection { protocolVersion:'1'; mode:string; overallHealth:string; node:{nodeId:string;state:string;rttMs:number|null}; }
