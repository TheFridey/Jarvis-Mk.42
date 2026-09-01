/**
 * Tiny 5-field cron matcher (minute hour dom month dow). No external dep.
 * Supports "*", step ("* / n" written without spaces), ranges ("a-b"),
 * lists ("a,b,c"), range-step ("a-b/n"), and plain numbers. Sufficient for the
 * Kernel's internal routines; not a general-purpose cron.
 */
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`invalid cron: "${expr}"`);
  const fields: [number, string][] = [
    [date.getMinutes(), parts[0]!],
    [date.getHours(), parts[1]!],
    [date.getDate(), parts[2]!],
    [date.getMonth() + 1, parts[3]!],
    [date.getDay(), parts[4]!],
  ];
  return fields.every(([value, spec]) => fieldMatches(value, spec));
}

function fieldMatches(value: number, spec: string): boolean {
  return spec.split(',').some((token) => {
    if (token === '*') return true;
    const stepMatch = /^\*\/(\d+)$/.exec(token);
    if (stepMatch) return value % Number(stepMatch[1]) === 0;
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token);
    if (rangeMatch) {
      const lo = Number(rangeMatch[1]);
      const hi = Number(rangeMatch[2]);
      return value >= lo && value <= hi;
    }
    const rangeStep = /^(\d+)-(\d+)\/(\d+)$/.exec(token);
    if (rangeStep) {
      const lo = Number(rangeStep[1]);
      const hi = Number(rangeStep[2]);
      const step = Number(rangeStep[3]);
      return value >= lo && value <= hi && (value - lo) % step === 0;
    }
    return Number(token) === value;
  });
}
