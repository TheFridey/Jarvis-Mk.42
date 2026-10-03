import { describe, expect, it } from 'vitest';
import type { JarvisOperatingPicture } from '@jarvis/scene';
import { coreSystemTargets, coreVisualPolicy } from './core-visual-policy.ts';

const picture=(interactionState:JarvisOperatingPicture['interactionState'],workState:JarvisOperatingPicture['workState'])=>({interactionState,workState} as JarvisOperatingPicture);
describe('Core visual policy',()=>{
  it('keeps interaction and work axes independent',()=>{const value=coreVisualPolicy(picture('LISTENING','IDLE'));expect(value.label).toBe('LISTENING');expect(value.waveform).toBe(1);expect(value.gold).toBeLessThan(.2)});
  it('renders real work ahead of passive interaction',()=>{const value=coreVisualPolicy(picture('AWARE','EXECUTING'));expect(value.label).toBe('EXECUTING');expect(value.gold).toBe(1)});
  it('uses localized failure signals',()=>{const value=coreVisualPolicy(picture('DORMANT','ERROR'));expect(value.fracture).toBe(1);expect(value.incompleteOrbit).toBe(false)});
});
describe('Core system targets',()=>{
  it('restructures geometry and energy direction per phase, not just colour',()=>{const dormant=coreSystemTargets('DORMANT'),thinking=coreSystemTargets('THINKING'),executing=coreSystemTargets('EXECUTING'),verifying=coreSystemTargets('VERIFYING');expect(thinking.rings).toBeGreaterThan(dormant.rings);expect(thinking.shellExpansion).toBeGreaterThan(dormant.shellExpansion);expect(executing.outflow).toBe(1);expect(executing.inflow).toBe(0);expect(verifying.returnFlow).toBe(1);expect(coreSystemTargets('LISTENING').inflow).toBe(1)});
  it('keeps red fracture for authoritative critical state only',()=>{expect(coreSystemTargets('CRITICAL').colour).toBe('critical');for(const phase of ['DEGRADED','FALLBACK','BLOCKED','ERROR','COMM_LOSS'] as const)expect(coreSystemTargets(phase).colour).not.toBe('critical')});
  it('holds the Core at an approval barrier without outward execution energy',()=>{const approval=coreSystemTargets('APPROVAL');expect(approval.barrier).toBe(1);expect(approval.outflow).toBe(0);expect(approval.orbitSpeed).toBeLessThan(.1)});
  it('overlays degradation asymmetry without repainting the active phase',()=>{const value=coreSystemTargets('THINKING',true);expect(value.colour).toBe('cognition');expect(value.asymmetry).toBeGreaterThan(0)});
  it('quietens communication loss below ambient',()=>{expect(coreSystemTargets('COMM_LOSS').luminosity).toBeLessThan(coreSystemTargets('DORMANT').luminosity);expect(coreSystemTargets('COMM_LOSS').neural).toBe(0)});
});
