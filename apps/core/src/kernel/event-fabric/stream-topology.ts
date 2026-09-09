import { EventNames, type EventName } from '@jarvis/contracts';

export type StreamName = 'EPHEMERAL' | 'SECURE' | 'OPERATIONS';

const canonical = Object.values(EventNames) as EventName[];

export function streamForEventType(eventType: string): StreamName {
  if (!canonical.includes(eventType as EventName)) throw new Error(`canonical event has no JetStream owner: ${eventType}`);
  if (eventType.startsWith('jarvis.perception.')) return 'EPHEMERAL';
  if (
    eventType.startsWith('jarvis.security.') ||
    eventType.startsWith('jarvis.kernel.identity.') ||
    eventType.startsWith('jarvis.kernel.policy.') ||
    eventType.startsWith('jarvis.kernel.permission.') ||
    eventType.startsWith('jarvis.agency.capability.')
  ) return 'SECURE';
  return 'OPERATIONS';
}

export const STREAMS: ReadonlyArray<{name: StreamName; subjects: string[]}> =
  (['EPHEMERAL', 'SECURE', 'OPERATIONS'] as const).map((name) => ({
    name,
    subjects: canonical.filter((eventType) => streamForEventType(eventType) === name),
  }));

export function validateStreamTopology(streams = STREAMS): void {
  const owners = new Map<string, string[]>();
  for (const stream of streams) for (const subject of stream.subjects) {
    const list = owners.get(subject) ?? [];
    list.push(stream.name);
    owners.set(subject, list);
  }
  const duplicate = [...owners].filter(([, names]) => names.length !== 1);
  const missing = canonical.filter((name) => !owners.has(name));
  const extra = [...owners.keys()].filter((name) => !canonical.includes(name as EventName));
  const overlaps:Array<[string,string,string,string]>=[];
  for(let i=0;i<streams.length;i++)for(let j=i+1;j<streams.length;j++)for(const left of streams[i]!.subjects)for(const right of streams[j]!.subjects)if(subjectPatternsOverlap(left,right))overlaps.push([streams[i]!.name,left,streams[j]!.name,right]);
  if (duplicate.length || missing.length || extra.length || overlaps.length) {
    throw new Error(`invalid JetStream topology: overlap=${JSON.stringify(overlaps)} duplicate=${JSON.stringify(duplicate)} missing=${JSON.stringify(missing)} nonCanonical=${JSON.stringify(extra)}`);
  }
}

export function subjectPatternsOverlap(left:string,right:string):boolean{
  const a=left.split('.'),b=right.split('.');let i=0;
  while(i<a.length&&i<b.length){if(a[i]==='>'||b[i]==='>')return true;if(a[i]!==b[i]&&a[i]!=='*'&&b[i]!=='*')return false;i++}
  return i===a.length&&i===b.length;
}

export function streamSubjectsForFilter(stream: StreamName, filters: string[], matches: (pattern:string, subject:string)=>boolean): string[] {
  return STREAMS.find((candidate) => candidate.name === stream)!.subjects.filter((subject) => filters.some((filter) => matches(filter, subject)));
}
