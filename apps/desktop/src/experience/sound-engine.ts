export type JarvisSoundCue='wake'|'listening'|'routing'|'approval'|'execution'|'verification'|'complete'|'warning'|'critical';
const cue:Record<JarvisSoundCue,readonly[number,number,number]>= {wake:[392,587,.11],listening:[523,659,.08],routing:[330,495,.09],approval:[440,554,.12],execution:[196,392,.12],verification:[622,784,.08],complete:[523,784,.14],warning:[220,277,.16],critical:[147,185,.18]};
export class JarvisSoundEngine{
  private context?:AudioContext;
  async play(name:JarvisSoundCue,enabled:boolean){if(!enabled||typeof AudioContext==='undefined')return;const context=this.context??=new AudioContext();if(context.state==='suspended')await context.resume();const [from,to,duration]=cue[name];const oscillator=context.createOscillator();const gain=context.createGain();oscillator.type=name==='critical'?'sawtooth':'sine';oscillator.frequency.setValueAtTime(from,context.currentTime);oscillator.frequency.exponentialRampToValueAtTime(to,context.currentTime+duration);gain.gain.setValueAtTime(.0001,context.currentTime);gain.gain.exponentialRampToValueAtTime(name==='critical'?.045:.025,context.currentTime+.015);gain.gain.exponentialRampToValueAtTime(.0001,context.currentTime+duration);oscillator.connect(gain).connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+duration+.02)}
  async close(){await this.context?.close();this.context=undefined}
}
