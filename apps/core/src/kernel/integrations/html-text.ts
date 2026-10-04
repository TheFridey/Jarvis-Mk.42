/** Dependency-free readable-text extraction. Output is untrusted data, never markup or instructions. */
export interface ExtractedPage { title: string; description: string; text: string; links: Array<{ url: string; text: string }>; }

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', pound: '£', euro: '€', middot: '·', bull: '•', times: '×', deg: '°' };
const DROPPED = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'canvas', 'select', 'head'];
// Tag bodies use [^<>]* so hostile markup (e.g. long runs of unclosed '<') stays linear-time.
const BLOCK = /<\/?(?:p|div|br|ul|ol|tr|td|th|table|section|article|header|footer|nav|main|aside|blockquote|pre|hr|form|fieldset|figure|figcaption|dd|dt|dl|address|summary|details)\b[^<>]*>/gi;

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});/gi, (match, body: string) => {
    if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? match;
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
  });
}

/** Removes control, bidi-override and zero-width characters that can hide or reorder text. */
export function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/\r\n?/g, '\n').replace(/[ \t\f\v\u00a0]+/g, ' ')
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.slice(0, 4096).matchAll(/([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) out[match[1]!.toLowerCase()] ??= decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return out;
}

function stripTags(html: string): string { return cleanText(decodeEntities(html.replace(/<[^<>]*>/g, ' ').replace(/[<>]/g, ' '))); }

export function extractHtml(html: string, baseUrl: string): ExtractedPage {
  let body = html.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
  const title = stripTags(body.match(/<title\b[^<>]*>([\s\S]*?)(?:<\/title\s*>|$)/i)?.[1]?.slice(0, 2000) ?? '').slice(0, 300);
  let description = '';
  for (const tag of body.match(/<meta\b[^<>]*>/gi) ?? []) {
    const attrs = attributes(tag); const key = (attrs.name ?? attrs.property ?? '').toLowerCase();
    if ((key === 'description' || key === 'og:description') && attrs.content) { description = cleanText(attrs.content).slice(0, 600); if (key === 'description') break; }
  }
  for (const name of DROPPED) body = body.replace(new RegExp(`<${name}\\b[^<>]*>[\\s\\S]*?(?:<\\/${name}\\s*>|$)`, 'gi'), ' ');
  const links: ExtractedPage['links'] = []; const seen = new Set<string>();
  for (const match of body.matchAll(/<a\b([^<>]*)>([\s\S]*?)(?:<\/a\s*>|$)/gi)) {
    if (links.length >= 25) break;
    const href = attributes(match[1] ?? '').href; if (!href) continue;
    let url: URL; try { url = new URL(href, baseUrl); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    url.hash = ''; const absolute = url.href; if (absolute.length > 2048 || seen.has(absolute)) continue;
    seen.add(absolute); links.push({ url: absolute, text: stripTags((match[2] ?? '').slice(0, 2000)).slice(0, 120) });
  }
  body = body.replace(/<h([1-6])\b[^<>]*>/gi, (_m, level: string) => `\n${'#'.repeat(Number(level))} `).replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<li\b[^<>]*>/gi, '\n- ').replace(BLOCK, '\n');
  return { title, description, text: stripTags(body), links };
}

export function extractText(raw: string, contentType: string, baseUrl: string): ExtractedPage {
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return extractHtml(raw, baseUrl);
  return { title: '', description: '', text: cleanText(raw), links: [] };
}
