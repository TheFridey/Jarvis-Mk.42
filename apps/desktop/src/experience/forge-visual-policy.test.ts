import { describe, expect, it } from 'vitest';
import type { JarvisOperatingPicture, SemanticScene } from '@jarvis/scene';
import { nextMeasuredTier, resolveQuality, resolveVisualState, seededUnit, visualPolicy } from './forge-visual-policy.ts';

const scene=(presentation:SemanticScene['presentation']='DORMANT')=>({presentation} as SemanticScene);
const picture=(interactionState:JarvisOperatingPicture['interactionState']='DORMANT',workState:JarvisOperatingPicture['workState']='IDLE',overall:JarvisOperatingPicture['systemHealth']['overall']='HEALTHY')=>({interactionState,workState,systemHealth:{overall},systemMode:'AMBIENT'} as JarvisOperatingPicture);

describe('Forge visual policy',()=>{
  it('never animates cached work as live after disconnect',()=>{
    const policy=visualPolicy({picture:picture('INTERPRETING','THINKING'),scene:scene('THINKING'),setting:'HIGH',measuredTier:'HIGH',reducedMotion:false,lowPower:true,disconnected:true});
    expect(policy.state).toBe('DEGRADED');expect(policy.maxFps).toBeLessThanOrEqual(15);
  });
  it('maps only truthful operating state to visual energy',()=>{expect(resolveVisualState(picture('INTERPRETING','THINKING'),'DORMANT')).toBe('REASONING');expect(resolveVisualState(picture('DORMANT','ROUTING'),'DORMANT')).toBe('ROUTING');expect(resolveVisualState(picture('DORMANT','EXECUTING'),'DORMANT')).toBe('EXECUTION');expect(resolveVisualState(picture('DORMANT','IDLE','DEGRADED'),'DORMANT')).toBe('DEGRADED');expect(resolveVisualState(picture('DORMANT','IDLE','OFFLINE'),'DORMANT')).toBe('CRITICAL')});
  it('uses measured FPS for AUTO instead of a GPU name',()=>{expect(nextMeasuredTier('HIGH',35)).toBe('MEDIUM');expect(nextMeasuredTier('MEDIUM',59)).toBe('HIGH');expect(nextMeasuredTier('HIGH',50)).toBe('HIGH')});
  it('caps reduced-motion and low-power modes',()=>{expect(resolveQuality('ULTRA','ULTRA',true,false)).toBe('MEDIUM');const policy=visualPolicy({picture:picture(),scene:scene(),setting:'ULTRA',measuredTier:'HIGH',reducedMotion:true,lowPower:false});expect(policy).toMatchObject({motion:0,maxFps:1,bloom:false,quality:'MEDIUM'})});
  it('degrades particle, postprocessing, DPR and idle frame budgets coherently',()=>{const low=visualPolicy({picture:picture(),scene:scene(),setting:'LOW',measuredTier:'HIGH',reducedMotion:false,lowPower:false});const high=visualPolicy({picture:picture('INTERPRETING','THINKING'),scene:scene('THINKING'),setting:'HIGH',measuredTier:'HIGH',reducedMotion:false,lowPower:false});expect(low).toMatchObject({particleCount:180,starCount:260,maxFps:12,bloom:false,dpr:[.75,1]});expect(high.particleCount).toBeGreaterThan(low.particleCount);expect(high.maxFps).toBe(60)});
  it('generates deterministic seeded parameters',()=>{expect(Array.from({length:8},(_,index)=>seededUnit(42,index))).toEqual(Array.from({length:8},(_,index)=>seededUnit(42,index)));expect(seededUnit(42,1)).not.toBe(seededUnit(43,1))});
});
