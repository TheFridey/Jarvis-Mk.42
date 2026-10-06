import { spokenText } from './answer-speech.ts';
import type { NeuralVoiceId } from './neural-voices.ts';

/** Worker synthesis and audio playback have no authority and send no answer text off-device. */
export class NeuralSpeech {
  private worker?:Worker;
  private context?:AudioContext;
  private source?:AudioBufferSourceNode;
  private id=0;
  private discard?:()=>void;
  stop(){
    this.id++;this.discard?.();this.discard=undefined;
    this.source?.stop();this.source=undefined;
    this.worker?.postMessage({id:this.id,cancel:true});
  }
  async close(){this.stop();this.worker?.terminate();this.worker=undefined;await this.context?.close();this.context=undefined;}
  speak(text:string,voice:NeuralVoiceId,state:(playing:boolean,status:string)=>void):()=>void {
    this.stop();const turn=this.id;
    this.context??=new AudioContext();
    // Resume during the Preview/Read aloud click, before model loading yields.
    const ready=this.context.resume();
    state(true,'Preparing free local voice');
    const chunks=spokenText(text).match(/.{1,650}(?:\s|$)|\S{1,650}/g)??[];
    void(async()=>{
      try{
        await ready;
        if(this.context?.state!=='running')throw new Error('Press Preview to enable voice playback');
        for(const chunk of chunks){
          if(turn!==this.id)return;
          const result=await this.generate(chunk,voice,turn,state);
          if(turn!==this.id||!result)return;
          const buffer=this.context.createBuffer(1,result.audio.length,result.sampleRate);buffer.copyToChannel(new Float32Array(result.audio),0);
          const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);this.source=source;
          state(true,'Speaking · free local voice');
          await new Promise<void>(resolve=>{this.discard=resolve;source.onended=()=>{source.disconnect();if(this.source===source)this.source=undefined;resolve();};source.start();});
          if(turn===this.id)this.discard=undefined;
        }
        if(turn===this.id)state(false,'Local voice · finished');
      }catch(error){if(turn===this.id)state(false,error instanceof Error?error.message:'Local voice playback failed');}
    })();
    return()=>{if(turn===this.id)this.stop();};
  }
  private generate(text:string,voice:NeuralVoiceId,id:number,state:(playing:boolean,status:string)=>void):Promise<{audio:Float32Array;sampleRate:number}|undefined> {
    this.worker??=new Worker(new URL('./neural-speech.worker.ts',import.meta.url));
    const worker=this.worker;
    return new Promise((resolve,reject)=>{
      const clean=()=>{worker.removeEventListener('message',message);worker.removeEventListener('error',error);};
      const error=()=>{clean();worker.terminate();if(this.worker===worker)this.worker=undefined;reject(new Error('Local voice worker unavailable. Try Preview again.'));};
      const message=(event:MessageEvent<{id:number;status?:string;error?:string;audio?:Float32Array;sampleRate:number}>)=>{
        if(event.data.id!==id)return;
        if(event.data.status){state(true,event.data.status);return;}
        clean();if(event.data.error)reject(new Error(event.data.error));else if(event.data.audio)resolve({audio:event.data.audio,sampleRate:event.data.sampleRate});else reject(new Error('Local voice returned no audio'));
      };
      this.discard=()=>{clean();resolve(undefined);};
      worker.addEventListener('message',message);worker.addEventListener('error',error);worker.postMessage({id,text,voice});
    });
  }
}
