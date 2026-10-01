import { describe, expect, it } from 'vitest';
import type { JarvisOperatingPicture } from '@jarvis/scene';
import { coreVisualPolicy } from './core-visual-policy.ts';

const picture=(interactionState:JarvisOperatingPicture['interactionState'],workState:JarvisOperatingPicture['workState'])=>({interactionState,workState} as JarvisOperatingPicture);
describe('Core visual policy',()=>{
  it('keeps interaction and work axes independent',()=>{const value=coreVisualPolicy(picture('LISTENING','IDLE'));expect(value.label).toBe('LISTENING');expect(value.waveform).toBe(1);expect(value.gold).toBeLessThan(.2)});
  it('renders real work ahead of passive interaction',()=>{const value=coreVisualPolicy(picture('AWARE','EXECUTING'));expect(value.label).toBe('EXECUTING');expect(value.gold).toBe(1)});
  it('uses localized failure signals',()=>{const value=coreVisualPolicy(picture('DORMANT','ERROR'));expect(value.fracture).toBe(1);expect(value.incompleteOrbit).toBe(false)});
});
