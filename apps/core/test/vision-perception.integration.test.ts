import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {isDockerAvailable} from '@jarvis/testkit';
import {setupIt,truncateAll,type ItContext} from './it-harness.ts';
import windows from '../../../capabilities/windows/definition.ts';
import type {CapabilityInvocationProposal,Grant,ModelRequest,ModelResponse} from '@jarvis/contracts';
interface FixtureAdapterJob {operation:string;action:string;mode:string}
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const dockerOk=await isDockerAvailable(),principalId='principal-operator';
describe.skipIf(!dockerOk)('composed selected-error perception (fixture hardware)',()=>{
 let ctx:ItContext;beforeAll(async()=>{ctx=await setupIt();await truncateAll(ctx.pg);ctx.clock.set(Date.now());});afterAll(()=>ctx?.cleanup());
 it('requires approval before selected text enters voice context, keeps analysis local and creates no repair effect',async()=>{
  let captures=0;const modelRequests:ModelRequest[]=[];
  const fixture={localPath:'fixture.png',capturedAt:ctx.clock.nowIso(),selectedText:'TS2304: Cannot find name widget.',imageSha256:'a'.repeat(64)};
  const adapterHost={run:async(job:FixtureAdapterJob)=>{if(job.operation==='simulate')return{output:{summary:'fixture selected capture',changes:[]},log:[],workerPid:0};if(job.action==='capture_region'&&job.mode==='full')captures++;return{output:fixture,log:[],workerPid:0};}};
  const modelGateway={generate:async(request:ModelRequest):Promise<ModelResponse>=>{modelRequests.push(request);const provenance={method:'model' as const,producedBy:'fixture-local',producedOn:'test',producedAt:ctx.clock.nowIso(),correlationId:request.correlationId,derivedFromUntrusted:true};return{modelId:'fixture-local',output:{proposals:[{proposalId:'answer-'+request.correlationId,kind:'answer',correlationId:request.correlationId,confidence:.9,provenance,text:'The selected error reports an undefined widget identifier.',citations:[]}]},usage:{contextUnits:100,outputUnits:20,costEstimate:0,latencyMs:1},finishReason:'stop',provenance};}};
  const grant:Grant={id:'vision-grant',principalId,holder:{kind:'principal',id:principalId},scopes:['windows.screen.read','windows.screen.capture'],maxRiskWithoutLiveApproval:'MEDIUM',mayProceedWithoutLiveApproval:true,issuedAt:ctx.clock.nowIso(),version:1,resourceConstraints:[],nodeConstraints:[],timeWindows:[]};
  const k=ctx.makeKernel({adapterHost:adapterHost as never,modelGateway,capabilities:[{manifest:windows.manifest,moduleUrl:pathToFileURL(resolve('capabilities/windows/definition.ts')).href}],bootstrapGrants:[grant]});await k.start();
  try{
   const provenance={method:'assertion' as const,producedBy:principalId,producedOn:k.config.nodeId,producedAt:ctx.clock.nowIso(),correlationId:'selected-capture',derivedFromUntrusted:false};
   const proposal:CapabilityInvocationProposal={proposalId:'capture-error',kind:'capability_invocation',correlationId:'selected-capture',confidence:1,provenance,invocation:{capabilityId:'capabilities.windows',capabilityVersion:windows.manifest.version,action:'capture_region',input:{x:0,y:0,width:300,height:200,outputPath:'fixture.png',extractText:true}},justification:'Explicitly selected terminal error, local OCR only'};
   const pendingResult=await k.agency.submit(proposal,{principalId,authenticated:true});expect(pendingResult.outcome).toBe('awaiting_approval');expect(captures).toBe(0);
   const approval=(await k.approvals.listPending())[0]!;expect(await k.approvals.approve({invocationId:approval.invocationId,operatorId:principalId,sessionId:'fixture-operator',authTrustLevel:'trusted',nonce:approval.nonce!,version:approval.version!})).toBe(true);
   const completed=await k.agency.submit(proposal,{principalId,authenticated:true});const captureEvents=await k.eventStore.byCorrelation('selected-capture');expect(completed.outcome,JSON.stringify(captureEvents.map(event=>event.payload))).toBe('verified');expect(captures).toBe(1);
   const at=ctx.clock.nowIso();await k.vision.handle({commandId:'screen',nodeId:k.config.nodeId,principalId,signal:{type:'screen-context',context:{source:'windows',coordinateSpace:'physical-pixels',monitors:[{id:'primary',label:'primary',x:0,y:0,width:1920,height:1080,primary:true,scaleFactor:1}],activeWindow:{application:'terminal',title:'fixture terminal',windowId:'terminal-1',bounds:{x:0,y:0,width:900,height:600}},cursor:{x:100,y:100},observedAt:at}}});
   await k.vision.handle({commandId:'point',nodeId:k.config.nodeId,principalId,signal:{type:'air-touch',gesture:'point',frame:{phase:'hover',monitorId:'primary',point:{x:100,y:100},confidence:.9,observedAt:at},diagnostics:{status:'ready',fps:30,inferenceLatencyMs:8,airTouchLatencyMs:8,confidence:.9,droppedFrames:0,calibrationQuality:.9,model:'fixture',updatedAt:at}}});
   const wake=await k.voice.handle({commandId:'wake',nodeId:k.config.nodeId,principalId,event:{type:'activation',activation:'wake-phrase',deviceId:'fixture-microphone'}});
   const response=await k.voice.handle({commandId:'question',nodeId:k.config.nodeId,principalId,event:{type:'asr.final',sessionId:wake.sessionId,sequence:1,text:"Jarvis, what's wrong with that?"}});
   expect(response.utterance).toContain('undefined widget');expect(modelRequests).toHaveLength(1);const request=modelRequests[0]!;expect(request).toMatchObject({locality:'local',cloudAllowed:false,privacyClass:'RESTRICTED'});const wire=JSON.stringify(request.input.context);expect(wire).toContain('TS2304');expect(wire).toContain('terminal');expect(wire).toContain("what's wrong with that");expect(wire).toContain('derivedFromUntrusted');expect(wire).toContain('gesture_target');expect(wire).toContain('sceneVersion');
   const repair=await k.voice.handle({commandId:'repair',nodeId:k.config.nodeId,principalId,event:{type:'asr.final',sessionId:wake.sessionId,sequence:2,text:'repair that'}});expect(repair.utterance).toContain('screenshot is not a repair target');expect(modelRequests).toHaveLength(1);expect(captures).toBe(1);expect(await k.approvals.listPending()).toHaveLength(0);
  }finally{await k.stop();}
 });
});





