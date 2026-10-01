import type { JarvisMode } from '@jarvis/contracts';
import type { SystemMode } from '@jarvis/scene';

export function presentationSystemMode(mode:JarvisMode):SystemMode {
  if(mode==='DEGRADED')return'DEGRADED';
  if(mode==='GUARDIAN')return'GUARDIAN';
  if(mode==='FOCUSED'||mode==='ENGAGED')return'FOCUSED';
  return'AMBIENT';
}
