import { afterEach,describe,it,expect,vi } from 'vitest';
import { NeuralSpeech } from './neural-speech.ts';
class FakeWorker extends EventTarget {
  static instances:FakeWorker[]=[];
  messages:Array<{id:number;text?:string;voice?:string;cancel?:boolean}>=[];
  constructor(){super();FakeWorker.instances.push(this);}
  postMessage(message:typeof this.messages[number]){this.messages.push(message);}
  terminate=vi.fn();
  reply(data:unknown){this.dispatchEvent(new MessageEvent('message',{data}));}
}
class FakeContext {
  state='running';destination={};sources:FakeSource[]=[];
  resume=async()=>{};close=async()=>{};
  createBuffer(){return{copyToChannel:vi.fn()};}
  createBufferSource(){const source=new FakeSource();this.sources.push(source);return source;}
}
class FakeSource {
  buffer?:unknown;onended?:()=>void;
  connect=vi.fn();disconnect=vi.fn();start=vi.fn();stop=vi.fn(()=>this.onended?.());
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function fixture(){
  FakeWorker.instances=[];const context=new FakeContext();
  vi.stubGlobal('Worker',FakeWorker);vi.stubGlobal('AudioContext',function(){return context;});
  return {speech:new NeuralSpeech(),context,state:vi.fn()};
}
afterEach(()=>vi.unstubAllGlobals());
describe('free local neural playback',()=>{
  it('plays worker audio through the selected voice and reports completion',async()=>{
    const f=fixture();f.speech.speak('Hello Jarvis','bm_george',f.state);await flush();
    const worker=FakeWorker.instances[0]!;expect(worker.messages.at(-1)).toMatchObject({voice:'bm_george',text:'Hello Jarvis'});
    const id=worker.messages.at(-1)!.id;worker.reply({id,audio:new Float32Array(2400),sampleRate:24000});await flush();
    expect(f.context.sources[0]!.start).toHaveBeenCalled();f.context.sources[0]!.onended!();await flush();
    expect(f.state).toHaveBeenLastCalledWith(false,'Local voice · finished');await f.speech.close();
  });
  it('discards synthesis arriving after stop without playing it',async()=>{
    const f=fixture();const stop=f.speech.speak('Hello','am_michael',f.state);await flush();const worker=FakeWorker.instances[0]!;const id=worker.messages.at(-1)!.id;
    stop();worker.reply({id,audio:new Float32Array(2400),sampleRate:24000});await flush();
    expect(f.context.sources).toHaveLength(0);expect(worker.messages.at(-1)).toMatchObject({cancel:true});await f.speech.close();
  });
  it('reports download or generation failure rather than claiming speech succeeded',async()=>{
    const f=fixture();f.speech.speak('Hello','bm_fable',f.state);await flush();const worker=FakeWorker.instances[0]!;
    worker.reply({id:worker.messages.at(-1)!.id,error:'Model unavailable'});await flush();
    expect(f.state).toHaveBeenLastCalledWith(false,'Model unavailable');expect(f.context.sources).toHaveLength(0);await f.speech.close();
  });
});
