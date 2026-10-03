import { expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './schema.ts';
it('preserves object constraints through refinements and accepts omitted default fields',()=>{
  const schema=z.object({name:z.string(),limit:z.number().default(50),patch:z.record(z.unknown()).optional()}).strict().refine(v=>!!v.name);
  expect(zodToJsonSchema(schema)).toEqual({type:'object',properties:{name:{type:'string'},limit:{type:'number'},patch:{type:'object',additionalProperties:{}}},additionalProperties:false,required:['name']});
});
