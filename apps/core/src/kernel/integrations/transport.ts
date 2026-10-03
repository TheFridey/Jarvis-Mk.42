import { z } from 'zod';
import type { AdapterEgress } from '../executor/hosted-adapter.ts';
import type { AdapterJob } from '../../../../adapter-host/src/ipc.ts';
import type { CredentialBroker } from '../credential-broker/broker.ts';
import email from '../../../../../capabilities/email/definition.ts';
import calendar from '../../../../../capabilities/calendar/definition.ts';
import scalesmiths from '../../../../../capabilities/scalesmiths/definition.ts';

export const googleMaterial = z.object({ principalId: z.string().min(1), clientId: z.string().min(1), clientSecret: z.string().min(1), refreshToken: z.string().min(1), calendars: z.array(z.string()).min(1).default(['primary']) }).strict();
export const scaleMaterial = z.object({ principalId: z.string().min(1), baseUrl: z.string().url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;}), token: z.string().min(1), contractVersion: z.literal(1), mutations: z.array(z.enum(['leads.update','tasks.update'])).default([]) }).strict();
const record = z.object({ id: z.string().min(1), entityType: z.enum(['business','client','lead','contact','project','invoice','retainer','meeting','website','repository','service','deployment','task','payment','proposal','analytics','infrastructure','caseStudy']), attributes: z.record(z.unknown()), sourceRef: z.string().min(1), observedAt: z.string().datetime({ offset: true }), validTo: z.string().datetime({ offset: true }).optional(), confidence: z.number().min(0).max(1), privacy: z.enum(['SENSITIVE','RESTRICTED']) }).strict();
export const scalePageSchema = z.object({ records: z.array(record).max(100), complete: z.boolean(), cursor: z.string().optional(), signals: z.record(z.unknown()).optional() }).strict().refine(v => v.complete || !!v.cursor, 'Incomplete pages require a cursor');
export type ScalePage = z.infer<typeof scalePageSchema>;
const definitions = { email, calendar, scalesmiths };
const enc = encodeURIComponent;
type Json = Record<string, unknown>;
const object = (v: unknown): Json => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid upstream response'); return v as Json; };

/** Only called by Adapter Host after Executor has minted authority. No token crosses IPC. */
export class IntegrationTransport {
  constructor(private readonly broker: CredentialBroker, private readonly request: typeof fetch = fetch) {}
  readonly run: AdapterEgress = async (job, req) => {
    const provider = job.capabilityId.replace('capabilities.', '') as keyof typeof definitions;
    const definition = definitions[provider];
    if (!definition || req.url !== `integration://${provider}/${job.action}` || req.method !== (job.mode === 'dry-run' ? 'GET' : 'POST')) throw new Error('Egress denied');
    if (job.handle.invocationId !== job.invocationId || job.handle.scope.capabilityId !== job.capabilityId || job.handle.mode !== job.mode || ![job.action,'verify'].includes(job.handle.scope.action)) throw new Error('Credential binding mismatch');
    const input = object(definition.actions[job.action]!.input.parse(job.input));
    const credential = this.broker.redeem(job.handle.handleId, job.invocationId);
    if (!credential.use || !credential.principalId || credential.readOnly !== (job.mode === 'dry-run')) throw new Error('Credential unavailable');
    const material: unknown = credential.use(secret => JSON.parse(secret));
    if (provider === 'scalesmiths') {
      const config = scaleMaterial.parse(material); this.principal(config.principalId, credential.principalId);
      return { data: await this.scale(job, input, config) };
    }
    const config = googleMaterial.parse(material); this.principal(config.principalId, credential.principalId);
    const token = await this.accessToken(config);
    const call = (path: string, method = 'GET', body?: unknown) => this.json(path, token, method, body);
    return { data: provider === 'email' ? await this.gmail(job, input, call) : await this.calendar(job, input, config.calendars, call) };
  };
  private principal(owner: string, actor: string) { if (owner !== actor) throw new Error('Integration principal mismatch'); }
  private async accessToken(config: z.infer<typeof googleMaterial>) {
    const response = await this.request('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }) });
    if (!response.ok) throw new Error('Google authorization unavailable');
    const data = object(await response.json()); if (typeof data.access_token !== 'string') throw new Error('Google authorization unavailable'); return data.access_token;
  }
  private async json(url: string, token: string, method = 'GET', body?: unknown): Promise<Json> {
    const response = await this.request(url, { method, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Upstream request failed (${response.status})`);
    if (response.status === 204) return {};
    const text = await response.text(); if (text.length > 1_000_000) throw new Error('Upstream response too large'); return object(JSON.parse(text));
  }
  private async scale(job: AdapterJob, input: Json, config: z.infer<typeof scaleMaterial>) {
    const base = new URL(config.baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('ScaleSmiths requires a fixed HTTPS service boundary');
    const write = job.action.endsWith('.update');
    if (write && !config.mutations.includes(job.action as 'leads.update' | 'tasks.update')) throw new Error('ScaleSmiths mutation not supported by configured upstream');
    // Versioned bridge accepts these actions; never reuse browser session cookies or query tables.
    const path = new URL(`v1/${enc(job.action)}`, base.href.endsWith('/') ? base : `${base.href}/`);
    if (write && job.mode === 'full') {
      const changed=scalePageSchema.parse(await this.json(path.href, config.token, 'PATCH', input));
      const entity=changed.records.find(row=>row.id===input.id);
      if(!entity||!matches(entity.attributes,input.patch))throw new Error('ScaleSmiths mutation intent not confirmed');
      return changed;
    }
    const readAction = write ? job.action.replace('.update', '.read') : job.action;
    const readUrl = new URL(`v1/${enc(readAction)}`, base.href.endsWith('/') ? base : `${base.href}/`);
    for (const [key,value] of Object.entries(write ? { id: input.id } : input)) if (value !== undefined) readUrl.searchParams.set(key, String(value));
    return scalePageSchema.parse(await this.json(readUrl.href, config.token));
  }
  private async gmail(job: AdapterJob, input: Json, call: (url:string,method?:string,body?:unknown)=>Promise<Json>) {
    const root = 'https://gmail.googleapis.com/gmail/v1/users/me';
    const result = object((job.output as { data?: unknown } | undefined)?.data ?? {});
    const getMessage = (id: unknown) => { if (typeof id !== 'string' || !id) throw new Error('Readback message id unavailable'); return call(`${root}/messages/${enc(id)}?format=full`); };
    const getDraft = (id: unknown) => { if (typeof id !== 'string' || !id) throw new Error('Readback draft id unavailable'); return call(`${root}/drafts/${enc(id)}?format=full`); };
    switch (job.action) {
      case 'search': { const params = new URLSearchParams({ q: String(input.query), maxResults: String(input.limit) }); if(input.pageToken)params.set('pageToken',String(input.pageToken)); return call(`${root}/messages?${params}`); }
      case 'read': return getMessage(input.messageId);
      case 'thread.read': return call(`${root}/threads/${enc(String(input.threadId))}?format=full`);
      case 'draft.create': case 'draft.update': {
        if(job.mode === 'dry-run') {const draft=await getDraft(result.id);this.confirmMail(object(draft.message),input);return draft;}
        const path = job.action === 'draft.update' ? `/drafts/${enc(String(input.draftId))}` : '/drafts';
        const created = await call(root + path, job.action === 'draft.update' ? 'PUT' : 'POST', { message: this.mime(input) });
        const draft=await getDraft(created.id);this.confirmMail(object(draft.message),input);return draft;
      }
      case 'send': {
        if(job.mode === 'dry-run') {const message=await getMessage(result.id);if(!(message.labelIds as string[]|undefined)?.includes('SENT'))throw new Error('Sent message not confirmed');this.confirmMail(message,input);return message;}
        const sent = await call(`${root}/messages/send`, 'POST', this.mime(input));
        const message=await getMessage(sent.id);if(!(message.labelIds as string[]|undefined)?.includes('SENT'))throw new Error('Sent message not confirmed');this.confirmMail(message,input);return message;
      }
      case 'archive': {
        if(job.mode === 'full') await call(`${root}/messages/${enc(String(input.messageId))}/modify`, 'POST', { removeLabelIds: ['INBOX'] });
        const message=await getMessage(input.messageId);if((message.labelIds as string[]|undefined)?.includes('INBOX'))throw new Error('Archive not confirmed');return message;
      }
      default: throw new Error('Unsupported Gmail action');
    }
  }
  private mime(input: Json) {
    if(input.threadId&&!input.inReplyTo)throw new Error('Thread replies require the original RFC Message-ID');
    const chunks:string[]=[];let chunk='';for(const character of String(input.subject)){if(Buffer.byteLength(chunk+character,'utf8')>45){chunks.push(chunk);chunk='';}chunk+=character;}if(chunk)chunks.push(chunk);
    const subject=chunks.map(value=>`=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`).join('\r\n ');
    const raw = `To: ${(input.to as string[]).join(',\r\n ')}\r\nSubject: ${subject}\r\n${input.inReplyTo?`In-Reply-To: ${input.inReplyTo}\r\nReferences: ${input.inReplyTo}\r\n`:''}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(String(input.body)).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''}\r\n`;
    return { raw: Buffer.from(raw).toString('base64url'), ...(input.threadId ? { threadId: input.threadId } : {}) };
  }
  private confirmMail(message:Json,input:Json){
    const payload=object(message.payload);const headers=payload.headers as Array<{name:string;value:string}>|undefined;
    const header=(name:string)=>headers?.find(h=>h.name.toLowerCase()===name)?.value??'';
    const recipients=header('to').split(',').map(value=>(value.match(/<([^<>]+)>/)?.[1]??value).trim().toLowerCase()).sort();
    const expected=(input.to as string[]).map(value=>value.toLowerCase()).sort();
    const subject=header('subject').replace(/\?=\s+=\?/g,'?==?').replace(/=\?UTF-8\?B\?([^?]+)\?=/gi,(_match,data:string)=>Buffer.from(data,'base64').toString('utf8'));
    const normalize=(value:string)=>value.replace(/\r\n/g,'\n').replace(/\n$/,'');
    const body=(part:Json):string|undefined=>{if(part.mimeType==='text/plain'&&typeof (part.body as Json|undefined)?.data==='string')return Buffer.from(String((part.body as Json).data),'base64url').toString('utf8');for(const child of part.parts as Json[]??[]){const text=body(child);if(text!==undefined)return text;}return undefined;};
    if(JSON.stringify(recipients)!==JSON.stringify(expected)||subject!==input.subject||normalize(body(payload)??'')!==normalize(String(input.body))||(input.threadId&&message.threadId!==input.threadId))throw new Error('Gmail message intent not confirmed');
  }
  private async calendar(job: AdapterJob, input: Json, allowed: string[], call:(url:string,method?:string,body?:unknown)=>Promise<Json>) {
    const calendarId = String(input.calendarId); if(!allowed.includes(calendarId)) throw new Error('Calendar not authorized');
    const root = `https://www.googleapis.com/calendar/v3/calendars/${enc(calendarId)}/events`;
    const result = object((job.output as { data?: unknown } | undefined)?.data ?? {});
    const id = input.eventId ?? result.id;
    const url = `${root}/${enc(String(id))}`;
    const get = () => call(url);
    const confirmed=async(value:Json)=>{
      if(['event.create','event.update'].includes(job.action)&&!matches(value,input.event))throw new Error('Calendar event intent not confirmed');
      if(job.action==='event.cancel'&&value.status!=='cancelled')throw new Error('Calendar cancellation not confirmed');
      if(job.action==='RSVP'&&!(value.attendees as Json[]|undefined)?.some(a=>a.self===true&&a.responseStatus===input.response))throw new Error('Calendar RSVP not confirmed');
      return value;
    };
    if (job.action === 'availability.read') return call('https://www.googleapis.com/calendar/v3/freeBusy', 'POST', { timeMin: input.timeMin, timeMax: input.timeMax, items: [{ id: calendarId }] });
    if (job.action === 'events.read') {
      if(input.eventId)return get();
      const params = new URLSearchParams({ timeMin: String(input.timeMin), timeMax: String(input.timeMax), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' }); if(input.pageToken)params.set('pageToken',String(input.pageToken));
      return call(`${root}?${params}`);
    }
    if(job.mode === 'dry-run')return confirmed(await get());
    switch (job.action) {
      case 'event.create': { const created = await call(`${root}?sendUpdates=all`, 'POST', input.event); return confirmed(await call(`${root}/${enc(String(created.id))}`)); }
      case 'event.update': await call(`${url}?sendUpdates=all`, 'PATCH', input.event); return confirmed(await get());
      case 'event.cancel': await call(`${url}?sendUpdates=all`, 'PATCH', { status: 'cancelled' }); return confirmed(await get());
      case 'RSVP': {
        const current = await get(); const attendees = current.attendees as Json[] | undefined;
        if(!attendees?.some(attendee => attendee.self === true))throw new Error('No self attendee on event');
        await call(`${url}?sendUpdates=all`, 'PATCH', { attendees: attendees.map(attendee => attendee.self === true ? { ...attendee, responseStatus: input.response } : attendee) }); return confirmed(await get());
      }
      default: throw new Error('Unsupported Calendar action');
    }
  }
}
/** Provider fields may include metadata; compare the requested subset, normalizing RFC3339 dates. */
function matches(actual:unknown,expected:unknown):boolean {
  if(Array.isArray(expected))return Array.isArray(actual)&&expected.every(item=>actual.some(candidate=>matches(candidate,item)));
  if(expected&&typeof expected==='object')return !!actual&&typeof actual==='object'&&Object.entries(expected).every(([key,value])=>matches((actual as Json)[key],value));
  if(typeof expected==='string'&&typeof actual==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(expected)&&Number.isFinite(Date.parse(expected)))return Date.parse(actual)===Date.parse(expected);
  return actual===expected;
}
