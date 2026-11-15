'use client';
import type { CognitionResponse } from '@jarvis/contracts';
import type { AirTouchFrame, DesktopAgentCancelCommand, DesktopAgentCancelResponse, DesktopApprovalCommand, DesktopCognitionCommand, DesktopConversationGrantCommand, DesktopConversationPrivacy, DesktopConversationRevokeCommand, DesktopKernelSnapshot, DesktopProposalCommand, DesktopProposalResponse, ExperienceClientMessage, ExperienceServerMessage, ExperienceStreamUpdate, SceneIntent, SceneSnapshot, SemanticScene } from '@jarvis/scene';
import { applySceneIntent, createSnapshot, ExperienceReducer } from '@jarvis/scene';

export type KernelConnection = { status: 'connecting' | 'live' | 'reconnecting' | 'stale' | 'offline' | 'demo'; lastConnectedAt?: string; staleSince?: string; error?: string };
export interface SceneTransport { joinRtc?(speechMode:'local'|'cloud'):Promise<{url:string;token:string;room:string;sessionId:string}>; leaveRtc?():Promise<unknown>; subscribeNotifications?(listener:(record:{title:string;body:string})=>void):()=>void; readonly kind:'live'|'demo'; subscribe(listener:(scene:SemanticScene)=>void):()=>void; subscribeKernel(listener:(snapshot:DesktopKernelSnapshot|undefined)=>void):()=>void; subscribeConnection(listener:(state:KernelConnection)=>void):()=>void; subscribeAirTouch(listener:(frame:AirTouchFrame)=>void):()=>void; submit(intent:SceneIntent,expectedVersion:number):Promise<void>; submitProposal(command:DesktopProposalCommand):Promise<DesktopProposalResponse>; submitCognition(command:DesktopCognitionCommand):Promise<CognitionResponse>; cancelAgentJob(command:DesktopAgentCancelCommand):Promise<DesktopAgentCancelResponse>; decideApproval(command:DesktopApprovalCommand):Promise<void>; reconnect():Promise<void>; close():void; }
export interface LayoutCache { read(sceneId:string):SceneSnapshot|undefined; write(sceneId:string,snapshot:SceneSnapshot):void; }
export class BrowserLayoutCache implements LayoutCache { read(sceneId:string){try{const raw=localStorage.getItem(`jarvis:scene:${sceneId}`);return raw?JSON.parse(raw) as SceneSnapshot:undefined}catch{return undefined}} write(sceneId:string,snapshot:SceneSnapshot){localStorage.setItem(`jarvis:scene:${sceneId}`,JSON.stringify(snapshot))} }

export class LocalSceneTransport implements SceneTransport { readonly kind='demo' as const;private scene:SemanticScene;private restored=false;private readonly listeners=new Set<(scene:SemanticScene)=>void>();constructor(initial:SemanticScene,private readonly cache?:LayoutCache){this.scene=initial}subscribe(listener:(scene:SemanticScene)=>void){if(!this.restored){this.restored=true;this.restoreCached()}this.listeners.add(listener);listener(this.scene);return()=>this.listeners.delete(listener)}subscribeKernel(listener:(snapshot:DesktopKernelSnapshot|undefined)=>void){listener(undefined);return()=>undefined}subscribeConnection(listener:(state:KernelConnection)=>void){listener({status:'demo'});return()=>undefined}subscribeAirTouch(){return()=>undefined}restoreCached(){const saved=this.cache?.read(this.scene.id);if(!saved)return;this.scene=applySceneIntent(this.scene,{type:'restore',snapshot:saved,availableResourceRefs:this.scene.objects.flatMap((object)=>object.resourceRefs),monitors:this.scene.monitors,input:'keyboard'});this.emit()}async submit(intent:SceneIntent,expectedVersion:number){if(expectedVersion!==this.scene.version)throw new Error('SCENE_VERSION_CONFLICT');this.scene=applySceneIntent(this.scene,intent);this.cache?.write(this.scene.id,createSnapshot(this.scene,'latest'));this.emit()}async submitProposal():Promise<DesktopProposalResponse>{throw new Error('DEMO_MODE_NO_KERNEL')}async submitCognition():Promise<CognitionResponse>{throw new Error('DEMO_MODE_NO_KERNEL')}async grantConversation():Promise<never>{throw new Error('DEMO_MODE_NO_KERNEL')}async revokeConversation():Promise<never>{throw new Error('DEMO_MODE_NO_KERNEL')}async conversationPrivacy():Promise<never>{throw new Error('DEMO_MODE_NO_KERNEL')}async cancelAgentJob():Promise<DesktopAgentCancelResponse>{throw new Error('DEMO_MODE_NO_KERNEL')}async decideApproval():Promise<void>{throw new Error('DEMO_MODE_NO_KERNEL')}async reconnect(){this.emit()}close(){this.listeners.clear()}private emit(){this.listeners.forEach((listener)=>listener(this.scene))}}

interface SocketLike { readonly readyState:number; onopen:null|(()=>void); onmessage:null|((event:{data:string})=>void); onclose:null|((event:{code:number;reason:string})=>void); onerror:null|(()=>void); send(data:string):void; close(code?:number,reason?:string):void; }
type SocketFactory=(url:string)=>SocketLike;
/** Actionable wording per authoritative gateway error code. No keys, no payloads. */
export function inferenceFailureMessage(code:string|undefined):string{
  switch(code){
    case 'NO_ROUTE':return 'No model can serve this request: a private conversation needs a local model, and none is registered. Press ALLOW CLOUD to permit the configured provider, or configure a local model.';
    case 'AUTHENTICATION':return 'The configured provider rejected the credentials. Check the runtime key on the gateway.';
    case 'RATE_LIMITED':return 'The configured provider is rate limiting requests. Try again shortly.';
    case 'TIMEOUT':return 'The configured provider did not answer in time. Try again.';
    case 'UNAVAILABLE':return 'The configured provider is not answering. Kernel state and permission checks remain available.';
    case 'BUDGET_EXCEEDED':return 'This request would exceed the configured spending limit.';
    case 'CANCELLED':return 'The request was cancelled before it finished. Nothing was retried.';
    case 'INVALID_RESPONSE':return 'The response reached its generation limit or arrived malformed before it could finish. I have not automatically sent your information again.';
    case 'PROVIDER_ERROR':return 'The configured provider returned an error for this request.';
    case 'INVALID_RESPONSE':return 'The configured provider returned something unusable for this request.';
    case 'CANCELLED':return 'The request was cancelled.';
    default:return 'Model inference did not complete. Kernel state and permission checks remain available.';
  }
}

export class KernelSceneTransport implements SceneTransport {
  readonly kind='live' as const;private scene?:SemanticScene;private snapshot?:DesktopKernelSnapshot;private status:KernelConnection={status:'connecting'};private stopped=false;private started=false;private failures=0;private reconnectTimer?:ReturnType<typeof setTimeout>;private heartbeatTimer?:ReturnType<typeof setTimeout>;private socket?:SocketLike;private auth?:{accessToken:string;sessionId:string};private readonly reducer=new ExperienceReducer();
  private readonly sceneListeners=new Set<(scene:SemanticScene)=>void>();private readonly kernelListeners=new Set<(snapshot:DesktopKernelSnapshot|undefined)=>void>();private readonly connectionListeners=new Set<(state:KernelConnection)=>void>();
  constructor(private readonly options:{endpoint:string;credential:string;nodeId:string;cache?:LayoutCache;fetch?:typeof globalThis.fetch;socket?:SocketFactory;retryBaseMs?:number;retryMaxMs?:number}){}
  private authenticating?:Promise<{accessToken:string;sessionId:string}>;
  subscribe(listener:(scene:SemanticScene)=>void){this.sceneListeners.add(listener);if(this.scene)listener(this.scene);this.start();return()=>this.sceneListeners.delete(listener)}
  subscribeKernel(listener:(snapshot:DesktopKernelSnapshot|undefined)=>void){this.kernelListeners.add(listener);listener(this.snapshot);this.start();return()=>this.kernelListeners.delete(listener)}
  subscribeConnection(listener:(state:KernelConnection)=>void){this.connectionListeners.add(listener);listener(this.status);this.start();return()=>this.connectionListeners.delete(listener)}
  subscribeAirTouch(listener:(frame:AirTouchFrame)=>void){const abort=new AbortController();void this.consumeVision(listener,abort.signal);return()=>abort.abort()}
  async submit(intent:SceneIntent,expectedVersion:number){if(!this.scene||expectedVersion!==this.scene.version)throw new Error('SCENE_VERSION_CONFLICT');const authoritativeVersion=this.scene.version;this.scene={...applySceneIntent(this.scene,intent),version:authoritativeVersion};this.options.cache?.write(this.scene.id,createSnapshot(this.scene,'presentation'));this.sceneListeners.forEach((listener)=>listener(this.scene!));if(intent.type==='focus')await this.command('/desktop/perception',{focusedId:intent.targetId,selectedIds:[intent.targetId]})}
  async joinRtc(speechMode:'local'|'cloud'){return this.command<{url:string;token:string;room:string;sessionId:string}>('/rtc/join',{speechMode})}
  async leaveRtc(){return this.command('/rtc/leave',{})}
  async submitProposal(command:DesktopProposalCommand){return this.command<DesktopProposalResponse>('/desktop/proposals',command)}
  async submitCognition(command:DesktopCognitionCommand){return this.command<CognitionResponse>('/desktop/cognition',command)}
  async grantConversation(command:DesktopConversationGrantCommand){return this.command<DesktopConversationPrivacy>('/desktop/conversations/grant',command)}
  async revokeConversation(command:DesktopConversationRevokeCommand){return this.command<DesktopConversationPrivacy>('/desktop/conversations/revoke',command)}
  /** Local speech: the browser posts captured audio, the Kernel transcribes it. */
  async transcribeUtterance(wav: Blob): Promise<{ok:boolean;transcript?:string;problem?:string;detail?:string}>{
    if(this.status.status!=='live')throw new Error('KERNEL_OFFLINE_COMMAND_REJECTED');
    const response=await this.request('/voice/utterance',{method:'POST',body:wav,headers:{'content-type':'audio/wav'}});
    const body=await response.json().catch(()=>({ok:false,problem:'engine_unavailable'})) as {ok:boolean;transcript?:string;problem?:string;detail?:string};
    if(response.status===401)throw new Error('Voice admission was refused. Sign in again.');
    return body;
  }
  /** Local synthesis: text in, WAV out, produced on this machine. */
  async synthesiseSpeech(text:string):Promise<Blob>{
    if(this.status.status!=='live')throw new Error('KERNEL_OFFLINE_COMMAND_REJECTED');
    const response=await this.request('/voice/speak',{method:'POST',body:JSON.stringify({text}),headers:{'content-type':'application/json'}});
    if(!response.ok)throw new Error('Local speech synthesis is unavailable.');
    return await response.blob();
  }

  /** Best-effort: publish real playback amplitude so the orb reacts to actual audio. */
  async reportPlayback(amplitude:number,tts:'idle'|'synthesizing'|'playing'|'cancelled',nodeId:string,principalId:string):Promise<void>{
    try{
      await this.request('/voice/events',{method:'POST',body:JSON.stringify({type:'audio.state',principalId,nodeId,state:{observedAt:new Date().toISOString(),wakeConfidence:null,vad:'silence',amplitude:0,tts,playbackAmplitude:Math.max(0,Math.min(1,amplitude)),deviceState:'ready'}}),headers:{'content-type':'application/json'}});
    }catch{/* the orb is a nicety; playback must not depend on it */}
  }
  async conversationPrivacy(conversationId:string){return this.command<DesktopConversationPrivacy>('/desktop/conversations/privacy',{conversationId})}
  private readonly notificationListeners=new Set<(record:{title:string;body:string})=>void>();
  subscribeNotifications(listener:(record:{title:string;body:string})=>void){this.notificationListeners.add(listener);return()=>{this.notificationListeners.delete(listener);};}
  async presentOnWall(objectId:string,expectedSceneVersion:number){const response=await this.request('/desktop/displays');if(!response.ok)throw new Error('Display lookup rejected');const displays=await response.json() as Array<{id:string}>;if(displays.length!==1)throw new Error(displays.length?'Choose a display from mobile':'No connected wall display');return this.command('/desktop/wall',{objectId,expectedSceneVersion,displayNodeId:displays[0]!.id})}
  async decideApproval(command:DesktopApprovalCommand){await this.command('/desktop/approvals',command)}
  async cancelAgentJob(command:DesktopAgentCancelCommand){return this.command<DesktopAgentCancelResponse>('/desktop/agents/cancel',command)}
  async reconnect(){this.failures=0;if(this.reconnectTimer)clearTimeout(this.reconnectTimer);this.reconnectTimer=undefined;this.replaceSocket('manual reconnect');this.setStatus({status:this.snapshot?'reconnecting':'connecting',...(this.snapshot?{staleSince:new Date().toISOString()}: {})});await this.bootstrapAndConnect(true)}
  close(){this.stopped=true;if(this.reconnectTimer)clearTimeout(this.reconnectTimer);if(this.heartbeatTimer)clearTimeout(this.heartbeatTimer);this.socket?.close(1000,'client shutdown');this.socket=undefined;this.notificationListeners.clear()}
  private start(){if(this.started)return;this.started=true;this.stopped=false;void this.bootstrapAndConnect(true)}
  private async authenticate(){
    if(this.auth)return this.auth;
    if(this.authenticating)return this.authenticating;
    const pending=(async()=>{
      const response=await(this.options.fetch??globalThis.fetch)(`${this.base()}/auth/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:this.options.credential,nodeId:this.options.nodeId,scopes:['desktop.read','desktop.write','vision.read','experience.read','voice.write'],surface:'desktop'})});
      if(!response.ok)throw new Error(`Kernel session exchange ${response.status}`);
      const body=await response.json() as{accessToken:string;credential:{sessionId:string}};
      return(this.auth={accessToken:body.accessToken,sessionId:body.credential.sessionId});
    })();
    this.authenticating=pending;
    try{return await pending}finally{if(this.authenticating===pending)this.authenticating=undefined}
  }
  private async bootstrapAndConnect(refreshSnapshot:boolean){if(this.stopped)return;try{await this.authenticate();if(refreshSnapshot||!this.snapshot)await this.bootstrap();this.openSocket()}catch(error){this.fail(error)}}
  private async bootstrap(){const response=await this.request('/desktop/snapshot');if(!response.ok)throw new Error(`Kernel snapshot HTTP ${response.status}`);const snapshot=await response.json() as DesktopKernelSnapshot;if(snapshot.schemaVersion!==2||snapshot.operatingPictureVersion!==1||!snapshot.scene||snapshot.sceneVersion!==snapshot.scene.version)throw new Error('Invalid Kernel operating picture');this.reducer.bootstrap(snapshot);this.applyPicture(snapshot)}
  private openSocket(){
    if(this.stopped)return;
    const auth=this.auth;
    if(!auth){this.scheduleReconnect();return}
    this.replaceSocket('subscription replaced');
    const factory=this.options.socket??((url)=>new WebSocket(url) as unknown as SocketLike);
    const socket=factory(`${this.base().replace(/^http/,'ws')}/experience/stream`);this.socket=socket;
    socket.onopen=()=>{
      if(this.socket!==socket||this.stopped)return;
      if(this.auth!==auth){this.replaceSocket('session changed before subscription');this.scheduleReconnect();return}
      const message:ExperienceClientMessage={type:'experience.subscribe',schemaVersion:1,accessToken:auth.accessToken,nodeId:this.options.nodeId,sessionId:auth.sessionId,channels:['system','objectives','cognition','agency','notifications','scene','telemetry'],...(this.reducer.resume()?{resume:this.reducer.resume()}: {})};socket.send(JSON.stringify(message));
    };
    socket.onmessage=(event)=>{if(this.socket!==socket)return;this.onMessage(JSON.parse(event.data) as ExperienceServerMessage)};
    socket.onerror=()=>{if(this.socket===socket)this.markStale('realtime transport error')};
    socket.onclose=(event)=>{if(this.socket!==socket||this.stopped)return;this.socket=undefined;if(event.code===4003&&this.auth===auth)this.auth=undefined;this.markStale(event.reason||`stream closed ${event.code}`);this.scheduleReconnect()};
  }
  private onMessage(message:ExperienceServerMessage){this.armHeartbeat();if(message.type=== 'experience.notification'){for(const listener of this.notificationListeners)listener(message);return;}if(message.type==='experience.ready'){this.failures=0;this.setStatus({status:'live',lastConnectedAt:new Date().toISOString()});return}if(message.type==='experience.heartbeat')return;if(message.type==='experience.resync_required'){this.resync();return}if(message.type==='experience.error'){this.markStale(message.detail);return}const result=this.reducer.apply(message as ExperienceStreamUpdate);if(result.status==='applied')this.applyPicture(result.picture);else if(result.status==='resync_required')this.resync()}
  private applyPicture(picture:DesktopKernelSnapshot){this.snapshot=picture;this.scene=this.restorePresentation(picture.scene);this.kernelListeners.forEach((listener)=>listener(picture));this.sceneListeners.forEach((listener)=>listener(this.scene!))}
  private markStale(error:string){this.setStatus({status:this.snapshot?'stale':'offline',...(this.snapshot?{staleSince:new Date().toISOString()}:{}),error})}
  private fail(error:unknown){this.failures++;this.markStale(error instanceof Error?error.message:String(error));this.scheduleReconnect()}
  private scheduleReconnect(){if(this.stopped||this.reconnectTimer)return;const delay=Math.min((this.options.retryBaseMs??500)*2**Math.min(this.failures++,5),this.options.retryMaxMs??15_000);this.setStatus({status:this.snapshot?'reconnecting':'offline',...(this.snapshot?{staleSince:this.status.staleSince??new Date().toISOString()}:{}),error:this.status.error});this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=undefined;void this.bootstrapAndConnect(false)},delay)}
  private armHeartbeat(){if(this.heartbeatTimer)clearTimeout(this.heartbeatTimer);this.heartbeatTimer=setTimeout(()=>{this.markStale('experience heartbeat timeout');this.socket?.close(4000,'heartbeat timeout')},30_000)}
  private resync(){this.replaceSocket('snapshot resync');void this.bootstrapAndConnect(true)}
  private replaceSocket(reason:string){const socket=this.socket;this.socket=undefined;socket?.close(1000,reason)}
  private async command<T=unknown>(path:string,body:unknown):Promise<T>{
    if(this.status.status!=='live'||!this.snapshot)throw new Error('KERNEL_OFFLINE_COMMAND_REJECTED');
    const response=await this.request(path,{method:'POST',body:JSON.stringify(body)});
    if(response.status===409){
      // CANCELLED is the Kernel's model cancellation, not a stale state version: refreshing the
      // snapshot and resubmitting would transmit a protected request a second time.
      const cancelled=await response.clone().json().catch(()=>undefined) as {code?:string}|undefined;
      if(cancelled?.code==='CANCELLED')throw new Error(inferenceFailureMessage('CANCELLED'));
      await this.bootstrap();throw new Error('STATE_VERSION_CONFLICT')
    }
    if(path==='/desktop/cognition'&&(response.status===503||response.status===422)){
      // The Kernel already classified the failure; one generic sentence discarded that.
      const detail=await response.clone().json().catch(()=>undefined) as {code?:string}|undefined;
      throw new Error(inferenceFailureMessage(detail?.code));
    }
    if(!response.ok)throw new Error(`KERNEL_COMMAND_REJECTED_${response.status}`);
    return response.json() as Promise<T>
  }

  /** Streamed local speech: the Kernel synthesises sentence by sentence and this is the pipe. */
  speakStream(text:string,init:{signal:AbortSignal;voice?:string}):Promise<Response>{
    return this.request('/voice/speak/stream',{method:'POST',signal:init.signal,body:JSON.stringify({text,...(init.voice?{voice:init.voice}:{})})});
  }

  private async request(path:string,init:RequestInit={}){
    for(let attempt=0;attempt<2;attempt++){
      const auth=await this.authenticate();
      const response=await(this.options.fetch??globalThis.fetch)(`${this.base()}${path}`,{...init,headers:{authorization:`Bearer ${auth.accessToken}`,'x-jarvis-node-id':this.options.nodeId,'x-jarvis-session-id':auth.sessionId,'content-type':'application/json',...init.headers}});
      if(response.status!==401)return response;
      if(this.auth===auth)this.auth=undefined;
      if(attempt===1)return response;
      // A Kernel 401 rejects before execution. Retry exactly once with the same
      // command ID, approval nonce and arguments; never retry an uncertain effect.
      await this.authenticate();
      if(this.socket){this.replaceSocket('session renewed');this.setStatus({status:'reconnecting'});this.openSocket()}
    }
    throw new Error('Kernel authentication retry exhausted');
  }
  private async consumeVision(listener:(frame:AirTouchFrame)=>void,signal:AbortSignal){while(!signal.aborted){try{const response=await this.request('/vision/stream',{signal});if(!response.ok||!response.body)throw new Error(`vision stream HTTP ${response.status}`);const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffered='';while(!signal.aborted){const part=await reader.read();if(part.done)break;buffered+=part.value;const lines=buffered.split('\n');buffered=lines.pop()??'';for(const line of lines)if(line.trim())listener(JSON.parse(line) as AirTouchFrame)}}catch{if(!signal.aborted)await new Promise((resolve)=>setTimeout(resolve,1000))}}}
  private setStatus(status:KernelConnection){this.status=status;this.connectionListeners.forEach((listener)=>listener(status))}
  private restorePresentation(scene:SemanticScene){const saved=this.options.cache?.read(scene.id);if(!saved)return scene;const savedById=new Map(saved.objects.map((object)=>[object.id,object]));return{...scene,objects:scene.objects.map((object)=>{const prior=savedById.get(object.id);return prior?{...object,monitorId:prior.monitorId,position:prior.position,size:prior.size,state:prior.state,pinned:prior.pinned,zIndex:prior.zIndex}:object})}}
  private base(){return this.options.endpoint.replace(/\/$/,'')}
}

export function createDesktopTransport():SceneTransport{return new KernelSceneTransport({endpoint:process.env.NEXT_PUBLIC_JARVIS_CORE_URL??'http://127.0.0.1:7420',credential:process.env.NEXT_PUBLIC_JARVIS_BOOTSTRAP_CREDENTIAL??'dev-bootstrap-secret',nodeId:process.env.NEXT_PUBLIC_JARVIS_NODE_ID??'local-server',cache:new BrowserLayoutCache()})}
