const words=(value:string)=>new Set(value.toLowerCase().replace(/[^a-z0-9' ]/g,' ').split(/\s+/).filter(Boolean));
export class EchoGuard{
 private reference=new Set<string>();private playbackStartedAt=0;private playbackEndedAt=0;private active=false;private suppressed=0;
 constructor(private readonly now=()=>performance.now(),private readonly tailMs=700,private readonly overlapThreshold=.72){}
 playbackStarted(text:string){this.reference=words(text);this.playbackStartedAt=this.now();this.active=true}
 playbackEnded(){this.playbackEndedAt=this.now();this.active=false}
 likelySelfAudio(text:string){if(!this.active&&this.now()-this.playbackEndedAt>this.tailMs)return false;const heard=words(text);if(!heard.size||!this.reference.size)return false;let overlap=0;for(const word of heard)if(this.reference.has(word))overlap++;const likely=overlap/heard.size>=this.overlapThreshold;if(likely)this.suppressed++;return likely}
 get diagnostics(){return{mode:'playback-reference-filter' as const,active:this.active,suppressedCount:this.suppressed,playbackStartedAt:this.playbackStartedAt}}
}
