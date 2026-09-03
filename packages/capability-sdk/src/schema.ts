import type { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string; innerType?: z.ZodTypeAny; values?: string[]; valueType?: z.ZodTypeAny; type?: z.ZodTypeAny; shape?: () => Record<string, z.ZodTypeAny> };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(child);
        if ((child._def as { typeName?: string }).typeName !== 'ZodOptional') required.push(key);
      }
      return { type: 'object', properties, additionalProperties: false, ...(required.length ? { required } : {}) };
    }
    case 'ZodString': return { type: 'string' };
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'string', enum: def.values ?? [] };
    case 'ZodArray': return { type: 'array', items: zodToJsonSchema(def.type!) };
    case 'ZodOptional': return zodToJsonSchema(def.innerType!);
    default: return {};
  }
}
