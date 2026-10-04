'use client';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';
import { assignSlots, parseSlots, serialiseSlots, type SlotRef, type SlotRegistry } from './model-slot-registry.ts';
import { emptyChoreography, observeRoute, routeSnapshot, type ChoreographyState } from './transition-choreography.ts';

const SLOT_KEY = 'jarvis:model-slots:v1';
export const DEPARTURE_MS = 1600;

function loadRegistry(): SlotRegistry {
  try { return parseSlots(sessionStorage.getItem(SLOT_KEY)); } catch { return parseSlots(null); }
}

/** Session-stable slot per model; persisted for the desktop session only. */
export function useStableSlots(nodes: ModelNode[]): Map<string, SlotRef> {
  const registry = useRef<SlotRegistry | undefined>(undefined);
  const signature = nodes.map(node => `${node.modelId}:${node.locality ?? '-'}`).join('|');
  return useMemo(() => {
    registry.current ??= typeof window === 'undefined' ? parseSlots(null) : loadRegistry();
    const result = assignSlots(registry.current, nodes.map(node => ({ modelId: node.modelId, ...(node.locality ? { locality: node.locality } : {}) })), Date.now());
    registry.current = result.registry;
    try { sessionStorage.setItem(SLOT_KEY, serialiseSlots(result.registry)); } catch { /* presentation state only */ }
    return result.slots;
  }, [signature]);
}

/** Keeps a model that left the projection visible as a fading ghost in its reserved slot. */
export function useDepartingNodes(nodes: ModelNode[], reduced: boolean): ModelNode[] {
  const previous = useRef(new Map<string, ModelNode>());
  const [departing, setDeparting] = useState<Map<string, { node: ModelNode; until: number }>>(new Map());
  useEffect(() => {
    const present = new Set(nodes.map(node => node.modelId));
    const now = Date.now();
    setDeparting(current => {
      const next = new Map([...current].filter(([id, entry]) => !present.has(id) && entry.until > now));
      if (!reduced) previous.current.forEach((node, id) => { if (!present.has(id) && !next.has(id)) next.set(id, { node: { ...node, route: 'HISTORICAL', activity: 'historical', departing: true }, until: now + DEPARTURE_MS }); });
      return next.size === current.size && [...next.keys()].every(id => current.has(id)) ? current : next;
    });
    previous.current = new Map(nodes.map(node => [node.modelId, node]));
  }, [nodes, reduced]);
  useEffect(() => {
    if (!departing.size) return;
    const soonest = Math.min(...[...departing.values()].map(entry => entry.until));
    const timer = setTimeout(() => setDeparting(current => new Map([...current].filter(([, entry]) => entry.until > Date.now()))), Math.max(16, soonest - Date.now()));
    return () => clearTimeout(timer);
  }, [departing]);
  return useMemo(() => departing.size ? [...nodes, ...[...departing.values()].map(entry => entry.node)] : nodes, [nodes, departing]);
}

/** Records observed route changes with their local receipt time for the GPU timeline. */
export function useChoreography(route: RouteObservation | undefined, nodes: ModelNode[]): RefObject<ChoreographyState> {
  const state = useRef<ChoreographyState>(emptyChoreography());
  const snapshot = useMemo(() => routeSnapshot(route, nodes), [route, nodes]);
  useEffect(() => { state.current = observeRoute(state.current, snapshot, performance.now()); }, [snapshot]);
  return state;
}
