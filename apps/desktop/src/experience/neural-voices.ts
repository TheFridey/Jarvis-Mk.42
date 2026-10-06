/** English male voices published by Kokoro, Apache-2.0. No hosted inference. */
export const neuralVoices=[
  {id:'bm_george',name:'George',accent:'British'},
  {id:'bm_fable',name:'Fable',accent:'British'},
  {id:'bm_daniel',name:'Daniel',accent:'British'},
  {id:'bm_lewis',name:'Lewis',accent:'British'},
  {id:'am_michael',name:'Michael',accent:'American'},
  {id:'am_fenrir',name:'Fenrir',accent:'American'},
  {id:'am_puck',name:'Puck',accent:'American'},
  {id:'am_adam',name:'Adam',accent:'American'},
  {id:'am_echo',name:'Echo',accent:'American'},
  {id:'am_eric',name:'Eric',accent:'American'},
  {id:'am_liam',name:'Liam',accent:'American'},
  {id:'am_onyx',name:'Onyx',accent:'American'},
  {id:'am_santa',name:'Santa',accent:'American'},
] as const;
export type NeuralVoiceId=typeof neuralVoices[number]['id'];
export function neuralVoiceId(uri:string):NeuralVoiceId|undefined {
  return neuralVoices.find(voice=>`kokoro:${voice.id}`===uri)?.id;
}
