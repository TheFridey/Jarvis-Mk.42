export interface Point2 { x: number; y: number; }
export interface Size2 { width: number; height: number; }
export interface Rect2 extends Point2, Size2 {}
export interface MonitorSurface { id: string; label: string; bounds: Rect2; workArea: Rect2; scaleFactor: number; primary: boolean; connected: boolean; }
export type SpatialInput = 'mouse' | 'keyboard' | 'touch' | 'voice' | 'air-touch' | 'gaze';
export interface SpatialReference { kind: 'point' | 'region' | 'direction'; monitorId?: string; point?: Point2; region?: Rect2; direction?: 'left' | 'right' | 'up' | 'down'; confidence: number; observedAt: string; }
export const clampRect = (rect: Rect2, area: Rect2): Rect2 => ({ width: Math.min(rect.width, area.width), height: Math.min(rect.height, area.height), x: Math.max(area.x, Math.min(rect.x, area.x + area.width - Math.min(rect.width, area.width))), y: Math.max(area.y, Math.min(rect.y, area.y + area.height - Math.min(rect.height, area.height))) });
export function nearestMonitor(monitors: MonitorSurface[], point: Point2) { return monitors.filter((m) => m.connected).sort((a, b) => distance(a.workArea, point) - distance(b.workArea, point))[0]; }
const distance = (r: Rect2, p: Point2) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.width)), Math.max(r.y - p.y, 0, p.y - (r.y + r.height)));

export interface CalibrationTransform { camera: Rect2; monitorId: string; monitor: Rect2; mirrorX: boolean; quality: number; }
export function calibratePoint(point: Point2, transform: CalibrationTransform): { monitorId: string; point: Point2; confidence: number } {
  const nx = Math.max(0, Math.min(1, (point.x - transform.camera.x) / transform.camera.width));
  const ny = Math.max(0, Math.min(1, (point.y - transform.camera.y) / transform.camera.height));
  return { monitorId: transform.monitorId, point: { x: transform.monitor.x + (transform.mirrorX ? 1 - nx : nx) * transform.monitor.width, y: transform.monitor.y + ny * transform.monitor.height }, confidence: transform.quality };
}

export class PointSmoother {
  private value?: Point2;
  constructor(private readonly alpha = .32, private readonly deadZonePx = 3) {}
  update(next: Point2): Point2 {
    if (!this.value) return (this.value = next);
    if (Math.hypot(next.x - this.value.x, next.y - this.value.y) <= this.deadZonePx) return this.value;
    return (this.value = { x: this.value.x + (next.x - this.value.x) * this.alpha, y: this.value.y + (next.y - this.value.y) * this.alpha });
  }
  reset() { this.value = undefined; }
}
