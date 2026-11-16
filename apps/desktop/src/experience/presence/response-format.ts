/**
 * Response formatting: turn an answer that contains structured evidence into
 * something a person can read, without inventing anything.
 *
 * The Kernel's business and telemetry answers legitimately mix prose with
 * `JSON.stringify(...)` of the records they used. Rendered verbatim that is a wall
 * of JSON in the conversation. This module splits an answer into segments:
 *
 *   - prose lines, unchanged and in order;
 *   - structured blocks, parsed and presented with a *structural* summary
 *     (row count, keys, timestamps found in ISO fields) plus an expandable,
 *     pretty-printed body;
 *   - everything else, preserved literally so nothing is ever dropped.
 *
 * Deterministic by construction: no model call, no summarisation of values, no
 * rewriting of facts. The raw text is always retained in `raw` and every
 * structured block keeps its original string in `source`.
 */

export type ResponseSegment =
  | { kind: 'prose'; text: string }
  | { kind: 'structured'; summary: string; pretty: string; source: string; timestamps: string[] }
  | { kind: 'literal'; text: string };

export interface FormattedResponse {
  segments: ResponseSegment[];
  /** The untouched answer, always available for the evidence view. */
  raw: string;
  /** True when any structured block was found and reformatted. */
  reformatted: boolean;
}

/** Only parse things that are actually sized like data, not prose in braces. */
const MAX_STRUCTURED_CHARS = 24_000;

function tryParse(candidate: string): unknown | undefined {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > MAX_STRUCTURED_CHARS) return undefined;
  if (!/^[[{]/.test(trimmed)) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' && !Array.isArray(first) ? Object.keys(first as Record<string, unknown>) : [];
  }
  return value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>) : [];
}

function collectTimestamps(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 4 || out.size >= 8) return;
  if (Array.isArray(value)) { for (const entry of value.slice(0, 20)) collectTimestamps(entry, out, depth + 1); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && /(at|_at|date|timestamp|as of)$/i.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(entry)) out.add(entry);
    else collectTimestamps(entry, out, depth + 1);
  }
}

/** Determinate, fact-free description of the shape of the data. */
export function describeStructure(value: unknown): string {
  if (Array.isArray(value)) {
    const keys = keysOf(value);
    return `${value.length} record${value.length === 1 ? '' : 's'}${keys.length ? ` · fields: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? '…' : ''}` : ''}`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object · fields: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? '…' : ''}`;
  }
  return typeof value;
}

/**
 * Split an answer into readable segments. A JSON block is recognised when it
 * occupies its own line(s); anything unbalanced stays literal so the text is
 * never mangled.
 */
export function formatAnswer(answer: string | undefined | null): FormattedResponse {
  const raw = answer ?? '';
  if (!raw.trim()) return { segments: [], raw, reformatted: false };

  const segments: ResponseSegment[] = [];
  let prose: string[] = [];
  let reformatted = false;
  const flush = () => {
    const text = prose.join('\n').trim();
    if (text) segments.push({ kind: 'prose', text });
    prose = [];
  };

  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!/^[[{]/.test(trimmed)) { prose.push(line); continue; }

    // Accumulate until the braces balance, so pretty-printed JSON spanning lines
    // is captured whole.
    let depth = 0, quoted = false, escaped = false;
    let end = -1;
    const chunk: string[] = [];
    outer: for (let cursor = index; cursor < lines.length; cursor++) {
      const piece = cursor === index ? line : lines[cursor]!;
      chunk.push(piece);
      for (const character of piece) {
        if (escaped) { escaped = false; continue; }
        if (character === '\\') { escaped = true; continue; }
        if (character === '"') { quoted = !quoted; continue; }
        if (quoted) continue;
        if (character === '{' || character === '[') depth++;
        else if (character === '}' || character === ']') depth--;
      }
      if (depth <= 0) { end = cursor; break outer; }
    }

    if (end === -1) { prose.push(line); continue; }         // unbalanced: keep literal
    const source = chunk.join('\n');
    const parsed = tryParse(source);
    if (parsed === undefined) { prose.push(line); continue; }

    flush();
    const timestamps = new Set<string>();
    collectTimestamps(parsed, timestamps);
    const dated = [...timestamps].sort();
    segments.push({
      kind: 'structured',
      summary: describeStructure(parsed),
      pretty: JSON.stringify(parsed, null, 2),
      source,
      timestamps: dated,
    });
    reformatted = true;
    index = end;
  }
  flush();
  if (!segments.length) segments.push({ kind: 'literal', text: raw });
  return { segments, raw, reformatted };
}

/**
 * How to name the dates inside a structured block. One date is an observation
 * time; several are a range, because claiming a single "as of" would be wrong.
 */
export function describeDates(timestamps: readonly string[]): string | undefined {
  if (!timestamps.length) return undefined;
  const sorted = [...new Set(timestamps)].sort();
  if (sorted.length === 1) return `as of ${sorted[0]}`;
  return `${sorted.length} timestamps · ${sorted[0]} → ${sorted[sorted.length - 1]}`;
}

/**
 * Prose convenience for answers that are pure prose: identical output, so the
 * caller never has to branch.
 */
export function readableAnswer(answer: string | undefined | null): string {
  const formatted = formatAnswer(answer);
  if (!formatted.reformatted) return formatted.raw;
  return formatted.segments.map(segment => {
    if (segment.kind !== 'structured') return segment.text;
    const dates = describeDates(segment.timestamps);
    return `${segment.summary}${dates ? ` · ${dates}` : ''}`;
  }).join('\n');
}
