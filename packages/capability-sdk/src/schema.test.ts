import { expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './schema.ts';
it('preserves object constraints through refinements and accepts omitted default fields',()=>{
  const schema=z.object({name:z.string(),limit:z.number().default(50),patch:z.record(z.unknown()).optional()}).strict().refine(v=>!!v.name);
  expect(zodToJsonSchema(schema)).toEqual({type:'object',properties:{name:{type:'string'},limit:{type:'number'},patch:{type:'object',additionalProperties:{}}},additionalProperties:false,required:['name']});
});
it('carries numeric, length, pattern, item-count and literal bounds so proposers see and validators enforce them',()=>{
  const schema=z.object({url:z.string().min(1).max(2048).regex(/^https?:\/\//),loose:z.string().regex(/^a/i),maxChars:z.number().int().min(500).max(12000).optional(),ratio:z.number().gt(0).lt(1),links:z.array(z.string()).max(25),trust:z.literal('untrusted')}).strict();
  expect(zodToJsonSchema(schema)).toEqual({type:'object',additionalProperties:false,required:['url','loose','ratio','links','trust'],properties:{url:{type:'string',minLength:1,maxLength:2048,pattern:'^https?:\\/\\/'},loose:{type:'string'},maxChars:{type:'integer',minimum:500,maximum:12000},ratio:{type:'number',exclusiveMinimum:0,exclusiveMaximum:1},links:{type:'array',items:{type:'string'},maxItems:25},trust:{enum:['untrusted']}}});
});
