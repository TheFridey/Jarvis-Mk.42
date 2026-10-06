import { describe,it,expect,vi } from 'vitest';
import { speakAnswer,spokenText } from './answer-speech.ts';
function fixture(local=true){
  const utterances:SpeechSynthesisUtterance[]=[];
  const voice={localService:local,lang:'en-GB'} as SpeechSynthesisVoice;
  const synthesis={getVoices:()=>[voice],cancel:vi.fn(),speak:vi.fn((value:SpeechSynthesisUtterance)=>utterances.push(value))} as unknown as SpeechSynthesis;
  const state=vi.fn();const create=(text:string)=>({text} as SpeechSynthesisUtterance);
  return {synthesis,state,create,utterances};
}
describe('local answer playback',()=>{
  it('uses the chosen voice for playback and safely falls back if it disappears',()=>{
    const f=fixture();const british={localService:true,lang:'en-GB',voiceURI:'hazel'} as SpeechSynthesisVoice;
    const chosen={localService:true,lang:'en-US',voiceURI:'zira'} as SpeechSynthesisVoice;
    f.synthesis.getVoices=()=>[british,chosen];
    speakAnswer('Hello',f.synthesis,f.create,f.state,'zira');expect(f.utterances[0]!.voice).toBe(chosen);
    speakAnswer('Hello',f.synthesis,f.create,f.state,'removed');expect(f.utterances[1]!.voice).toBe(british);
  });
  it('cannot select a remote voice by its saved identifier',()=>{
    const f=fixture();const local={localService:true,lang:'en-GB',voiceURI:'local'} as SpeechSynthesisVoice;
    f.synthesis.getVoices=()=>[local,{localService:false,lang:'en-US',voiceURI:'remote'} as SpeechSynthesisVoice];
    speakAnswer('Hello',f.synthesis,f.create,f.state,'remote');expect(f.utterances[0]!.voice).toBe(local);
  });
  it('reads formatted prose without reading Markdown syntax or code',()=>{
    expect(spokenText('## Hello\n**Rhys** [source](https://example.com)\n```js\nsecret()\n```')).toBe('Hello Rhys source Code example omitted from speech.');
  });
  it('never falls back to a cloud voice',()=>{
    const f=fixture(false);speakAnswer('Hello',f.synthesis,f.create,f.state);
    expect(f.synthesis.speak).not.toHaveBeenCalled();expect(f.state).toHaveBeenCalledWith(false,'No local English voice available');
  });
  it('plays a long answer in sequence and reports completion',()=>{
    const f=fixture();speakAnswer('A sentence. '.repeat(60),f.synthesis,f.create,f.state);
    expect(f.utterances).toHaveLength(1);
    for(let i=0;i<f.utterances.length;i++)f.utterances[i]!.onend!({} as SpeechSynthesisEvent);
    expect(f.utterances.length).toBeGreaterThan(1);expect(f.state).toHaveBeenLastCalledWith(false,'Local voice · finished');
  });
  it('stop prevents a late completion event from starting more audio',()=>{
    const f=fixture();const stop=speakAnswer('A sentence. '.repeat(60),f.synthesis,f.create,f.state);stop();f.utterances[0]!.onend!({} as SpeechSynthesisEvent);
    expect(f.utterances).toHaveLength(1);
  });
  it('makes blocked autoplay visible and does not continue the queue',()=>{
    const f=fixture();speakAnswer('A sentence. '.repeat(60),f.synthesis,f.create,f.state);
    f.utterances[0]!.onerror!({error:'not-allowed'} as SpeechSynthesisErrorEvent);f.utterances[0]!.onend!({} as SpeechSynthesisEvent);
    expect(f.state).toHaveBeenLastCalledWith(false,'Press Read aloud to enable playback');expect(f.utterances).toHaveLength(1);
  });
});
