/**
 * Shared spatial composition for the DOM projections and the GPU scene. Both
 * place elements from these pixel coordinates, so labels stay attached to the
 * geometry they describe at every viewport size.
 */
export interface Point { x: number; y: number }
export interface SpatialLayout {
  width: number; height: number; narrow: boolean;
  core: Point;
  /** Outer radius of the Core's gravitational field, px. */
  coreRadius: number;
  modelRadius: number;
  models: Array<Point & { angle: number }>;
  /** Screen-space angle of the locality boundary (cloud above, local below). */
  localityBoundary: { inner: Point; outer: Point };
  agents: Array<Point & { angle: number }>;
  agentRadius: number;
  execution: { barrier: Point; anchor: Point; angle: number };
  conversation: Point;
  /** Room left of the core once the scene dock is excluded; the projection never crosses it. */
  conversationWidth: number;
  flow: Point;
}

const DEG = Math.PI / 180;
const polar = (core: Point, radius: number, degrees: number): Point => ({ x: core.x + radius * Math.cos(degrees * DEG), y: core.y - radius * Math.sin(degrees * DEG) });

function spread(count: number, from: number, to: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(from + to) / 2];
  return Array.from({ length: count }, (_, i) => from + (to - from) * (i / (count - 1)));
}

/** Scene panels dock along the left edge; projections keep clear of them. */
const DOCK_RESERVE = 300;

export function spatialLayout(input: { width: number; height: number; coreFraction?: Point; models: Array<{ locality?: 'local' | 'cloud-ok' }>; agentCount: number }): SpatialLayout {
  const width = Math.max(320, input.width), height = Math.max(320, input.height);
  const narrow = width < 1100 || height < 560;
  const coreFraction = input.coreFraction ?? { x: .5, y: .47 };
  const core = { x: width * coreFraction.x, y: height * (narrow ? .38 : coreFraction.y) };
  const coreRadius = narrow ? Math.min(width * .26, height * .17) : Math.min(height * .17, width * .13);
  const sideColumn = width <= 1400 ? 280 : width >= 2200 && height >= 1300 ? 400 : 330;
  const labelRoom = narrow ? 40 : sideColumn + 170;
  const modelRadius = Math.max(coreRadius * 1.4, Math.min(coreRadius * 2.3, width - core.x - labelRoom));
  const cloud = input.models.map((model, index) => ({ model, index })).filter(item => item.model.locality === 'cloud-ok');
  const other = input.models.map((model, index) => ({ model, index })).filter(item => item.model.locality !== 'cloud-ok');
  const models: SpatialLayout['models'] = new Array(input.models.length);
  spread(cloud.length, 14, cloud.length > 3 ? 58 : 46).forEach((angle, i) => { models[cloud[i]!.index] = { ...polar(core, modelRadius, angle), angle }; });
  spread(other.length, -14, other.length > 3 ? -58 : -46).forEach((angle, i) => { models[other[i]!.index] = { ...polar(core, modelRadius, angle), angle }; });
  const agentRadius = coreRadius * 1.7;
  const agents = spread(input.agentCount, 112, input.agentCount > 4 ? 172 : 160).map(angle => ({ ...polar(core, agentRadius, angle), angle }));
  const executionAngle = 232;
  const conversation = polar(core, coreRadius * 1.3, 186);
  return {
    width, height, narrow, core, coreRadius, modelRadius, models,
    localityBoundary: { inner: polar(core, modelRadius * .78, 0), outer: polar(core, modelRadius * 1.12, 0) },
    agents, agentRadius,
    execution: { barrier: polar(core, coreRadius * 1.5, executionAngle), anchor: polar(core, coreRadius * 2.25, executionAngle), angle: executionAngle },
    conversation,
    conversationWidth: Math.round(Math.max(200, Math.min(380, conversation.x - DOCK_RESERVE))),
    flow: { x: core.x, y: core.y + coreRadius * 1.22 },
  };
}
