import type { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; values?: string[]; valueType?: z.ZodTypeAny; type?: z.ZodTypeAny; shape?: () => Record<string, z.ZodTypeAny> };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(child);
        if (!child.safeParse(undefined).success) required.push(key);
      }
      return { type: 'object', properties, additionalProperties: false, ...(required.length ? { required } : {}) };
    }
    case 'ZodString': return { type: 'string' };
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'string', enum: def.values ?? [] };
    case 'ZodArray': return { type: 'array', items: zodToJsonSchema(def.type!) };
    case 'ZodOptional': return zodToJsonSchema(def.innerType!);
    case 'ZodDefault': return zodToJsonSchema(def.innerType!);
    case 'ZodEffects': return zodToJsonSchema(def.schema!);
    case 'ZodRecord': return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType!) };
    default: return {};
  }
}
