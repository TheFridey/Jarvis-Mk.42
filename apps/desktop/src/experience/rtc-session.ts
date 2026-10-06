/** Cancellation is checked at each asynchronous media boundary. */
export async function startRtcSession(d:{connect:()=>Promise<unknown>;publish:()=>Promise<unknown>;startAudio:()=>Promise<unknown>;isCurrent:()=>boolean;discard:()=>Promise<unknown>}):Promise<boolean>{
  for(const step of [d.connect,d.publish,d.startAudio]){
    if(!d.isCurrent()){await d.discard();return false}
    await step();
  }
  if(!d.isCurrent()){await d.discard();return false}
  return true;
}
