export function spokenText(text:string):string {
  return text.replace(/```[\s\S]*?```/g,' Code example omitted from speech. ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'link in the written response').replace(/^[\s]*#{1,6}\s+/gm,'').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim();
}
export function speakAnswer(text:string,synthesis:SpeechSynthesis,create:(text:string)=>SpeechSynthesisUtterance,onState:(speaking:boolean,status:string)=>void,voiceURI?:string):()=>void {
  const local=synthesis.getVoices().filter(v=>v.localService);
  const voice=local.find(v=>v.voiceURI===voiceURI)??local.find(v=>v.lang==='en-GB')??local.find(v=>v.lang.startsWith('en'));
  if(!voice){onState(false,'No local English voice available');return()=>{};}
  synthesis.cancel();let cancelled=false,index=0;
  const chunks=spokenText(text).match(/.{1,220}(?:\s|$)|\S{1,220}/g)??[];
  // Keep the current utterance alive until its completion event.
  let active:SpeechSynthesisUtterance|undefined;
  onState(true,'Speaking · local voice');
  const next=()=>{
    if(cancelled)return;
    const chunk=chunks[index++];if(!chunk){active=undefined;onState(false,'Local voice · finished');return;}
    active=create(chunk);active.voice=voice;active.lang=voice.lang;active.rate=1;
    active.onend=next;active.onerror=event=>{if(cancelled)return;cancelled=true;onState(false,event.error==='not-allowed'?'Press Read aloud to enable playback':`Voice playback failed · ${event.error}`);};
    synthesis.speak(active);
  };next();
  return()=>{cancelled=true;active=undefined;synthesis.cancel();};
}
