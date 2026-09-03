'use client';
import { motion, useReducedMotion } from 'motion/react'; import type { PresentationState } from '@jarvis/scene';
export function JarvisCore({ state, activity }: { state: PresentationState; activity: string[] }) { const reduced = useReducedMotion(); return <div className={`core-wrap core-${state.toLowerCase()}`} aria-label={`JARVIS is ${state.toLowerCase()}`}>
  <motion.div className="core-halo" animate={reduced ? {} : { rotate: 360 }} transition={{ duration: state === 'THINKING' ? 16 : 28, repeat: Infinity, ease: 'linear' }} />
  <motion.div className="core-structure" animate={reduced ? {} : { scale: state === 'LISTENING' ? [1, 1.055, 1] : [1, 1.018, 1] }} transition={{ duration: state === 'LISTENING' ? 1.5 : 4.8, repeat: Infinity, ease: 'easeInOut' }}><span /><span /><span /><i /></motion.div>
  <div className="core-readout"><small>{state}</small><strong>JARVIS</strong><div>{activity.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div></div>
  <div className="core-baseline" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 7) % 24)}px` }} />)}</div>
 </div>; }
