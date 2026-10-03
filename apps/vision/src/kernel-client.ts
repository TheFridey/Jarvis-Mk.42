import type {VisionEventCommand} from '@jarvis/contracts';
const replaceable=(command:VisionEventCommand)=>command.signal.type==='diagnostics'||command.signal.type==='screen-context'||command.signal.type==='air-touch'&&['hover','pinch-move'].includes(command.signal.frame.phase);
export class VisionKernelClient {
 private queue:VisionEventCommand[]=[];private sending=false;private auth?:{accessToken:string;sessionId:string};private dropped=0;
 constructor(private endpoint:string,private bootstrapCredential:string,private nodeId:string,private maxQueue=64){}
 droppedObservations(){return this.dropped;}
 publish(command:VisionEventCommand){
  const last=this.queue.at(-1);if(last&&replaceable(last)&&replaceable(command)&&last.signal.type===command.signal.type){this.queue[this.queue.length-1]=command;this.dropped++;}else this.queue.push(command);
  if(this.queue.length>this.maxQueue){const disposable=this.queue.findIndex(replaceable);if(disposable>=0)this.queue.splice(disposable,1);else{this.queue.splice(0,this.queue.length-1);if(command.signal.type==='air-touch')this.queue.push({...command,signal:{...command.signal,gesture:'none',frame:{...command.signal.frame,phase:'lost',confidence:0}}});}this.dropped++;}
  void this.flush().catch(()=>undefined);
 }
 private async authenticate(){if(this.auth)return this.auth;const response=await fetch(`${this.endpoint}/auth/session`,{method:'POST',signal:AbortSignal.timeout(3000),headers:{'content-type':'application/json'},body:JSON.stringify({credential:this.bootstrapCredential,nodeId:this.nodeId,scopes:['vision.write'],surface:'vision'})});if(!response.ok)throw new Error('vision authentication unavailable');const body=await response.json() as {accessToken:string;credential:{sessionId:string}};return this.auth={accessToken:body.accessToken,sessionId:body.credential.sessionId};}
 private async flush(){if(this.sending)return;this.sending=true;try{while(this.queue.length){const auth=await this.authenticate(),command=this.queue[0]!;const response=await fetch(`${this.endpoint}/vision/events`,{method:'POST',signal:AbortSignal.timeout(3000),headers:{authorization:`Bearer ${auth.accessToken}`,'x-jarvis-node-id':this.nodeId,'x-jarvis-session-id':auth.sessionId,'content-type':'application/json'},body:JSON.stringify(command)});if(response.status===401){this.auth=undefined;throw new Error('vision session expired');}if(!response.ok)throw new Error('vision event rejected');if(this.queue[0]===command)this.queue.shift();}}finally{this.sending=false;}}
}
