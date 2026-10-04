type Schema = { type?: string; required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean; enum?: unknown[]; items?: unknown; minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number; minLength?: number; maxLength?: number; pattern?: string; minItems?: number; maxItems?: number };

function withinNumberBounds(s: Schema, value: number): boolean {
  return (s.minimum === undefined || value >= s.minimum) && (s.maximum === undefined || value <= s.maximum) && (s.exclusiveMinimum === undefined || value > s.exclusiveMinimum) && (s.exclusiveMaximum === undefined || value < s.exclusiveMaximum);
}

function withinStringBounds(s: Schema, value: string): boolean {
  if (s.minLength !== undefined && value.length < s.minLength) return false;
  if (s.maxLength !== undefined && value.length > s.maxLength) return false;
  if (s.pattern === undefined) return true;
  try { return new RegExp(s.pattern).test(value); } catch { return false; }
}

export function validateJsonSchema(schema: unknown, value: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const candidate = schema as Schema;
  if (candidate.enum && !candidate.enum.some((item) => Object.is(item, value))) return false;
  if (candidate.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (candidate.required?.some((key) => !(key in object))) return false;
    if (candidate.additionalProperties === false && Object.keys(object).some((key) => !(key in (candidate.properties ?? {})))) return false;
    return Object.entries(candidate.properties ?? {}).every(([key, child]) => !(key in object) || validateJsonSchema(child, object[key]));
  }
  if (candidate.type === 'array') return Array.isArray(value) && (candidate.minItems === undefined || value.length >= candidate.minItems) && (candidate.maxItems === undefined || value.length <= candidate.maxItems) && (!candidate.items || value.every((item) => validateJsonSchema(candidate.items, item)));
  if (candidate.type === 'string') return typeof value === 'string' && withinStringBounds(candidate, value);
  if (candidate.type === 'number') return typeof value === 'number' && Number.isFinite(value) && withinNumberBounds(candidate, value);
  if (candidate.type === 'integer') return typeof value === 'number' && Number.isInteger(value) && withinNumberBounds(candidate, value);
  if (candidate.type === 'boolean') return typeof value === 'boolean';
  if (candidate.type === 'null') return value === null;
  return true;
}
