import type { ReferenceContext, ResolvedReference, SemanticScene } from './types.ts';
export function resolveReference(scene: SemanticScene, context: ReferenceContext): ResolvedReference {
  const words = context.utterance.toLowerCase();
  if (/\b(these|those)\b/.test(words) && context.selectedIds.length) return result(context.selectedIds, .96, 'selected objects');
  if (/\b(this|that)\b/.test(words)) {
    if (context.pointing?.point) { const p = context.pointing.point; const hits = scene.objects.filter((o) => o.monitorId === context.pointing?.monitorId && p.x >= o.position.x && p.x <= o.position.x + o.size.width && p.y >= o.position.y && p.y <= o.position.y + o.size.height).sort((a, b) => b.zIndex - a.zIndex); if (hits[0]) return result([hits[0].id], context.pointing.confidence, 'pointing hit'); }
    const target = context.hoveredId ?? context.focusedId; if (target) return result([target], .82, 'interaction focus');
  }
  const byMeaning = scene.objects.filter((o) => words.includes(o.title.toLowerCase()) || words.includes(o.kind.replace('-', ' ')));
  if (byMeaning.length === 1) return result([byMeaning[0]!.id], .9, 'semantic label');
  return { objectIds: [], confidence: 0, reason: 'ambiguous spatial reference', requiresClarification: true };
}
const result = (objectIds: string[], confidence: number, reason: string): ResolvedReference => ({ objectIds, confidence, reason, requiresClarification: confidence < .7 });
