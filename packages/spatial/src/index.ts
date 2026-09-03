export interface Point2 { x: number; y: number; }
export interface Size2 { width: number; height: number; }
export interface Rect2 extends Point2, Size2 {}
export interface MonitorSurface { id: string; label: string; bounds: Rect2; workArea: Rect2; scaleFactor: number; primary: boolean; connected: boolean; }
export type SpatialInput = 'mouse' | 'keyboard' | 'touch' | 'voice' | 'air-touch' | 'gaze';
export interface SpatialReference { kind: 'point' | 'region' | 'direction'; monitorId?: string; point?: Point2; region?: Rect2; direction?: 'left' | 'right' | 'up' | 'down'; confidence: number; observedAt: string; }
export const clampRect = (rect: Rect2, area: Rect2): Rect2 => ({ width: Math.min(rect.width, area.width), height: Math.min(rect.height, area.height), x: Math.max(area.x, Math.min(rect.x, area.x + area.width - Math.min(rect.width, area.width))), y: Math.max(area.y, Math.min(rect.y, area.y + area.height - Math.min(rect.height, area.height))) });
export function nearestMonitor(monitors: MonitorSurface[], point: Point2) { return monitors.filter((m) => m.connected).sort((a, b) => distance(a.workArea, point) - distance(b.workArea, point))[0]; }
const distance = (r: Rect2, p: Point2) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.width)), Math.max(r.y - p.y, 0, p.y - (r.y + r.height)));
