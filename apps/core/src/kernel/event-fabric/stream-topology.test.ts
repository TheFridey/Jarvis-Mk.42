import { describe, expect, it } from 'vitest';
import { EventNames } from '@jarvis/contracts';
import { STREAMS, streamForEventType, validateStreamTopology } from './stream-topology.ts';

describe('JetStream topology', () => {
  it('routes every canonical event to exactly one explicit subject owner', () => {
    expect(() => validateStreamTopology()).not.toThrow();
    const subjects=STREAMS.flatMap((s)=>s.subjects);
    expect(subjects).toHaveLength(Object.values(EventNames).length);
    expect(new Set(subjects).size).toBe(subjects.length);
    for(const eventType of Object.values(EventNames)) expect(STREAMS.filter((s)=>s.subjects.includes(eventType))).toHaveLength(1);
  });
  it('classifies representative domains',()=>{
    expect(streamForEventType(EventNames.VoiceTranscript)).toBe('EPHEMERAL');
    expect(streamForEventType(EventNames.IdentityRevoked)).toBe('SECURE');
    expect(streamForEventType(EventNames.ModeChanged)).toBe('OPERATIONS');
    expect(()=>streamForEventType('jarvis.unknown.event')).toThrow(/no JetStream owner/);
  });
  it('rejects duplicate or missing ownership before connecting',()=>{
    expect(()=>validateStreamTopology([{name:'EPHEMERAL',subjects:[EventNames.VoiceTranscript]},{name:'SECURE',subjects:[EventNames.VoiceTranscript]},{name:'OPERATIONS',subjects:[]}])).toThrow(/invalid JetStream topology/);
    expect(()=>validateStreamTopology([{name:'EPHEMERAL',subjects:['jarvis.perception.>']},{name:'SECURE',subjects:[]},{name:'OPERATIONS',subjects:['jarvis.>']}])).toThrow(/overlap/);
  });
});
