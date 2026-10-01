export interface FrameHost { request(callback:FrameRequestCallback):number; cancel(id:number):void; now():number; }
export class ForgeRenderLoop {
  private handle?:number; private last=0; private running=false;
  constructor(private readonly host:FrameHost,private readonly frame:(time:number)=>void,private fps:number){}
  start(){if(this.running)return;this.running=true;this.schedule()}
  setFps(fps:number){this.fps=Math.max(1,fps)}
  stop(){this.running=false;if(this.handle!==undefined)this.host.cancel(this.handle);this.handle=undefined}
  private schedule(){if(!this.running)return;this.handle=this.host.request((time)=>{if(time-this.last>=1000/this.fps){this.last=time;this.frame(time)}this.schedule()})}
}
