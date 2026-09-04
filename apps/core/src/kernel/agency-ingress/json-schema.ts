export function validateJsonSchema(schema: unknown, value: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const candidate = schema as { type?: string; required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean; enum?: unknown[]; items?: unknown };
  if (candidate.enum && !candidate.enum.some((item) => Object.is(item, value))) return false;
  if (candidate.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (candidate.required?.some((key) => !(key in object))) return false;
    if (candidate.additionalProperties === false && Object.keys(object).some((key) => !(key in (candidate.properties ?? {})))) return false;
    return Object.entries(candidate.properties ?? {}).every(([key, child]) => !(key in object) || validateJsonSchema(child, object[key]));
  }
  if (candidate.type === 'array') return Array.isArray(value) && (!candidate.items || value.every((item) => validateJsonSchema(candidate.items, item)));
  if (candidate.type === 'string') return typeof value === 'string';
  if (candidate.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (candidate.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (candidate.type === 'boolean') return typeof value === 'boolean';
  if (candidate.type === 'null') return value === null;
  return true;
}
