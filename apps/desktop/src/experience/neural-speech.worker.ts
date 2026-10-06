import { KokoroTTS } from 'kokoro-js';
import type { NeuralVoiceId } from './neural-voices.ts';

let model:Promise<KokoroTTS>|undefined;
let queue=Promise.resolve();
let latest=0;
const worker=self as unknown as {onmessage:((event:MessageEvent<{id:number;text?:string;voice?:NeuralVoiceId;cancel?:boolean}>)=>void)|null;postMessage:(value:unknown,transfer?:Transferable[])=>void};
worker.onmessage=event=>{
  const {id,text,voice,cancel}=event.data;latest=id;
  if(cancel||!text||!voice)return;
  queue=queue.then(async()=>{
    if(latest!==id)return;
    try{
      if(!model){
        worker.postMessage({id,status:'Loading free voice model · first use downloads locally'});
        model=KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{
          dtype:'q8',device:'wasm',progress_callback:progress=>{
            if(latest===id&&progress.status==='progress')worker.postMessage({id,status:`Downloading voice model · ${Math.round(progress.progress??0)}%`});
          },
        });
        model.catch(()=>{model=undefined;});
      }
      const tts=await model;if(latest!==id)return;
      worker.postMessage({id,status:'Generating speech · locally'});
      const result=await tts.generate(text,{voice});
      if(latest===id)worker.postMessage({id,audio:result.audio,sampleRate:result.sampling_rate},[result.audio.buffer]);
    }catch{if(latest===id)worker.postMessage({id,error:'Local voice generation failed. Check model download access and try Preview again.'});}
  });
};
