'use client';
import React, { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Volume2, VolumeX, Square, ChevronDown, ChevronUp } from 'lucide-react';
import { speakAnswer } from './answer-speech.ts';
import { neuralVoiceId,neuralVoices } from './neural-voices.ts';
import { NeuralSpeech } from './neural-speech.ts';

/** Speech is presentation of an already delivered answer, using an explicitly local voice. */
export function ResponsePanel({text,answerId,live}:{text:string;answerId?:string;live:boolean}) {
  const [expanded,setExpanded]=useState(true);
  const [enabled,setEnabled]=useState(true);
  const [status,setStatus]=useState('Local voice · ready');
  const [speaking,setSpeaking]=useState(false);
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI,setVoiceURI]=useState('');
  const observed=useRef<string|undefined>(answerId);
  const cancelSpeech=useRef<(()=>void)|undefined>(undefined);
  const neuralSpeech=useRef<NeuralSpeech|undefined>(undefined);
  useEffect(()=>{
    if(!('speechSynthesis' in window)){setStatus('Speech unavailable in this browser');return;}
    const refresh=()=>{const local=window.speechSynthesis.getVoices().filter(voice=>voice.localService);setVoices(local);if(!local.some(voice=>voice.lang.startsWith('en')))setStatus('No local English voice available');};
    refresh();window.speechSynthesis.addEventListener('voiceschanged',refresh);
    setEnabled(localStorage.getItem('jarvis-response-voice')!=='off');
    setVoiceURI(localStorage.getItem('jarvis-response-voice-uri')??'');
    return()=>{window.speechSynthesis.removeEventListener('voiceschanged',refresh);cancelSpeech.current?.();void neuralSpeech.current?.close();};
  },[]);
  const stop=()=>{cancelSpeech.current?.();setSpeaking(false);setStatus('Local voice · stopped');};
  const speak=(preview=false)=>{
    const textToRead=preview?'Good morning. I am Jarvis. This is a preview of my voice. How can I help you today?':text;
    const neural=neuralVoiceId(voiceURI);
    if(neural){
      cancelSpeech.current?.();neuralSpeech.current??=new NeuralSpeech();
      try{cancelSpeech.current=neuralSpeech.current.speak(textToRead,neural,(playing,message)=>{setSpeaking(playing);setStatus(message);});}catch{setSpeaking(false);setStatus('Local neural playback unavailable in this browser');}
      return;
    }
    if(!('speechSynthesis' in window)){setStatus('Speech unavailable in this browser');return;}
    cancelSpeech.current?.();
    cancelSpeech.current=speakAnswer(textToRead,window.speechSynthesis,value=>new SpeechSynthesisUtterance(value),(playing,message)=>{setSpeaking(playing);setStatus(message);},voiceURI);
  };
  useEffect(()=>{
    if(!answerId||answerId===observed.current)return;
    observed.current=answerId;setExpanded(true);
    if(enabled&&live)speak();
  },[answerId,enabled,live]);
  if(!text)return null;
  return <aside className={`response-panel${expanded?'':' collapsed'}`} aria-label="JARVIS response">
    <header><div><span className="response-mark" aria-hidden="true">◇</span><strong>JARVIS</strong><small>{live?'RESPONSE':'LAST RECORDED RESPONSE'}</small></div><button onClick={()=>setExpanded(value=>!value)} aria-label={expanded?'Minimise response':'Expand response'} aria-expanded={expanded}>{expanded?<ChevronDown size={18}/>:<ChevronUp size={18}/>}</button></header>
    {expanded&&<div className="response-body"><Markdown skipHtml components={{a:({children,href})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,img:({alt})=><span>{alt}</span>}}>{text}</Markdown></div>}
    <label className="response-voice-selector">Speaking voice<select aria-label="Speaking voice" value={neuralVoiceId(voiceURI)||voices.some(voice=>voice.voiceURI===voiceURI)?voiceURI:''} onChange={event=>{stop();setVoiceURI(event.target.value);localStorage.setItem('jarvis-response-voice-uri',event.target.value);setStatus(neuralVoiceId(event.target.value)?'Free local voice · press Preview to load':'Local voice · ready');}}><option value="">Automatic · installed English voice</option><optgroup label="Free male voices · British English">{neuralVoices.filter(voice=>voice.accent==='British').map(voice=><option key={voice.id} value={`kokoro:${voice.id}`}>{voice.name} · British · male</option>)}</optgroup><optgroup label="Free male voices · American English">{neuralVoices.filter(voice=>voice.accent==='American').map(voice=><option key={voice.id} value={`kokoro:${voice.id}`}>{voice.name} · American · male</option>)}</optgroup><optgroup label="Installed local voices">{voices.map(voice=><option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</optgroup></select></label>
    {neuralVoiceId(voiceURI)&&<p className="voice-download-note">Free · runs on this device. First use downloads the shared voice model; your reply stays local.</p>}
    <footer><button aria-pressed={enabled} onClick={()=>{const value=!enabled;setEnabled(value);localStorage.setItem('jarvis-response-voice',value?'on':'off');if(!value)stop();else speak();}}>{enabled?<Volume2 size={15}/>:<VolumeX size={15}/>} Voice {enabled?'on':'off'}</button><span role="status">{speaking||enabled?status:'Automatic voice off'}</span><button onClick={()=>speak(true)} disabled={!neuralVoiceId(voiceURI)&&!voices.length}>Preview</button>{speaking?<button onClick={stop}><Square size={13}/> Stop</button>:<button onClick={()=>speak()} disabled={!neuralVoiceId(voiceURI)&&!voices.some(v=>v.lang.startsWith('en'))}>Read aloud</button>}</footer>
  </aside>;
}
