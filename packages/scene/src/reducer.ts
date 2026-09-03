import { clampRect, nearestMonitor, type MonitorSurface } from '@jarvis/spatial';
import type { SceneIntent, SceneObject, SceneSnapshot, SemanticScene } from './types.ts';
export function applySceneIntent(scene: SemanticScene, intent: SceneIntent): SemanticScene {
  if (intent.type === 'restore') return restoreScene(scene, intent.snapshot, intent.monitors, new Set(intent.availableResourceRefs));
  const targetIds = intent.type === 'group' ? new Set(intent.targetIds) : new Set([intent.targetId]);
  const objects = scene.objects.flatMap((object): SceneObject[] => {
    if (!targetIds.has(object.id)) return [object];
    if (intent.type === 'dismiss') return object.dismissible ? [] : [object];
    if (intent.type === 'focus') return [{ ...object, state: 'focused', zIndex: Math.max(...scene.objects.map((o) => o.zIndex), 0) + 1 }];
    if (intent.type === 'expand' || intent.type === 'collapse') return [{ ...object, state: intent.type === 'expand' ? 'expanded' : 'collapsed' }];
    if (intent.type === 'pin') return [{ ...object, pinned: !object.pinned }];
    if (intent.type === 'group') return [{ ...object, groupId: intent.groupId }];
    if (intent.type === 'resize') return [{ ...object, size: { width: Math.max(280, intent.size.width), height: Math.max(160, intent.size.height) } }];
    if (intent.type !== 'move') return [object];
    const monitor = scene.monitors.find((m) => m.id === intent.monitorId && m.connected);
    return monitor ? [{ ...object, monitorId: monitor.id, position: clampRect({ ...intent.position, ...object.size }, monitor.workArea) }] : [object];
  });
  return { ...scene, objects, version: scene.version + 1, updatedAt: new Date().toISOString() };
}
export function createSnapshot(scene: SemanticScene, name: string): SceneSnapshot { return { id: `${scene.id}:${scene.version}`, name, sceneVersion: scene.version, objects: structuredClone(scene.objects), selectedProjectId: scene.selectedProjectId, savedAt: scene.updatedAt }; }
export function restoreScene(current: SemanticScene, snapshot: SceneSnapshot, monitors: MonitorSurface[], available: Set<string>): SemanticScene {
  const connected = monitors.filter((m) => m.connected); const fallback = connected.find((m) => m.primary) ?? connected[0];
  const objects = snapshot.objects.filter((o) => o.resourceRefs.every((ref) => available.has(ref))).flatMap((object): SceneObject[] => {
    const monitor = connected.find((m) => m.id === object.monitorId) ?? nearestMonitor(connected, object.position) ?? fallback;
    if (!monitor) return [];
    return [{ ...object, monitorId: monitor.id, position: clampRect({ ...object.position, ...object.size }, monitor.workArea) }];
  });
  return { ...current, monitors, objects, selectedProjectId: snapshot.selectedProjectId, version: current.version + 1, updatedAt: new Date().toISOString() };
}
export function reconcileMonitors(scene: SemanticScene, monitors: MonitorSurface[]) { return restoreScene(scene, createSnapshot(scene, 'monitor-reconcile'), monitors, new Set(scene.objects.flatMap((o) => o.resourceRefs))); }
