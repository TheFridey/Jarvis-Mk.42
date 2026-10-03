import type{ActivationStrategy,RecognitionEvent}from'./contracts.ts';
export class WakePhraseActivation implements ActivationStrategy{readonly kind='wake-phrase'as const;constructor(private phrase='jarvis'){}matches(e:RecognitionEvent){const text=e.text?.trim().toLowerCase()??'';return e.type==='wake'||e.type==='final'&&text.startsWith(this.phrase.toLowerCase())&&!/[a-z0-9]/i.test(text[this.phrase.length]??'')}}
export class ManualActivation implements ActivationStrategy{readonly kind='manual'as const;private active=false;set(value:boolean){this.active=value}matches(){return this.active}}
export class PushToTalkActivation implements ActivationStrategy{readonly kind='push-to-talk'as const;private pressed=false;set(value:boolean){this.pressed=value}matches(){return this.pressed}}
