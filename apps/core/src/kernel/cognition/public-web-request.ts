/** Explicit public-site work can omit private conversational context.
 * Private or mixed requests retain the normal local-only history boundary. */
export function isPublicWebRequest(input: string): boolean {
  if (!/\b(site|website|page)\b/i.test(input) || !/\b(check|audit|review|research|inspect)\b/i.test(input)) return false;
  if (/\b(private|internal|confidential|invoice|invoices|revenue|crm|credentials|password|token|compare|previous|earlier|remember|discussed|conversation)\b/i.test(input)) return false;
  const urls=input.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return urls.length>0 && urls.every(raw=>{
    try {
      const url=new URL(raw.replace(/[.,!?)]*$/, ''));
      return !url.username&&!url.password&&!url.search&&!url.hash
        && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
        && !/\.(localhost|local|internal|test|invalid)$/i.test(url.hostname);
    } catch { return false; }
  });
}
