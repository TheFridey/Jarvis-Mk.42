import type { JarvisOperatingPicture, OperatingModelRun } from '@jarvis/scene';
export function liveActivityPicture(picture: JarvisOperatingPicture | undefined, live: boolean) {
  return live ? picture : undefined;
}
export function modelRunState(run: OperatingModelRun, live: boolean): string {
  if (!live) return 'STALE';
  if (run.status === 'failed') return 'FAILED';
  if (run.status === 'completed') return 'COMPLETE';
  if (run.activityConfirmed === false && run.routing?.phase !== 'COMPLETE') return 'WAITING / UNCONFIRMED';
  return run.routing?.phase ?? 'IDLE';
}
