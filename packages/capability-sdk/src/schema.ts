import type { z } from 'zod';

type Check = { kind: string; value?: number; inclusive?: boolean; regex?: RegExp };

function numberBounds(checks: Check[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const check of checks) {
    if (check.kind === 'int') out.type = 'integer';
    if (check.kind === 'min') out[check.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = check.value;
    if (check.kind === 'max') out[check.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = check.value;
  }
  return out;
}

function stringBounds(checks: Check[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const check of checks) {
    if (check.kind === 'min') out.minLength = check.value;
    if (check.kind === 'max') out.maxLength = check.value;
    if (check.kind === 'length') { out.minLength = check.value; out.maxLength = check.value; }
    if (check.kind === 'regex' && check.regex && !check.regex.flags) out.pattern = check.regex.source;
  }
  return out;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; values?: string[]; value?: unknown; valueType?: z.ZodTypeAny; type?: z.ZodTypeAny; shape?: () => Record<string, z.ZodTypeAny>; checks?: Check[]; minLength?: { value: number } | null; maxLength?: { value: number } | null };
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
    case 'ZodString': return { type: 'string', ...stringBounds(def.checks) };
    case 'ZodNumber': return { type: 'number', ...numberBounds(def.checks) };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'string', enum: def.values ?? [] };
    case 'ZodLiteral': return { enum: [def.value] };
    case 'ZodArray': return { type: 'array', items: zodToJsonSchema(def.type!), ...(def.minLength ? { minItems: def.minLength.value } : {}), ...(def.maxLength ? { maxItems: def.maxLength.value } : {}) };
    case 'ZodOptional': return zodToJsonSchema(def.innerType!);
    case 'ZodDefault': return zodToJsonSchema(def.innerType!);
    case 'ZodEffects': return zodToJsonSchema(def.schema!);
    case 'ZodRecord': return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType!) };
    default: return {};
  }
}
