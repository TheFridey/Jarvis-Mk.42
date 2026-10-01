import type { ExperienceStreamUpdate, JarvisOperatingPicture } from './live.ts';

export type ExperienceApplyResult =
  | { status: 'applied'; picture: JarvisOperatingPicture }
  | { status: 'duplicate'; picture?: JarvisOperatingPicture }
  | { status: 'out_of_order'; picture?: JarvisOperatingPicture }
  | { status: 'resync_required'; reason: 'stream_changed_without_full_update' | 'stale_state_version' | 'scene_version_conflict'; picture?: JarvisOperatingPicture };

/** Idempotent, monotonic reducer shared by every Experience client. */
export class ExperienceReducer {
  private streamId?: string;
  private sequence = 0;
  private picture?: JarvisOperatingPicture;

  bootstrap(picture: JarvisOperatingPicture): void { this.picture = structuredClone(picture); }
  current(): JarvisOperatingPicture | undefined { return this.picture; }
  resume(): { streamId: string; sequence: number } | undefined { return this.streamId ? { streamId: this.streamId, sequence: this.sequence } : undefined; }

  apply(update: ExperienceStreamUpdate): ExperienceApplyResult {
    const streamChanged = this.streamId !== undefined && update.streamId !== this.streamId;
    if (streamChanged && !update.full) return { status: 'resync_required', reason: 'stream_changed_without_full_update', picture: this.picture };
    if (!streamChanged && this.streamId === update.streamId && update.sequence <= this.sequence) {
      return { status: update.sequence === this.sequence ? 'duplicate' : 'out_of_order', picture: this.picture };
    }
    if (this.picture && update.stateVersion < this.picture.stateVersion) return { status: 'resync_required', reason: 'stale_state_version', picture: this.picture };
    const scene = update.patch.scene;
    if (scene && (scene.version !== update.sceneVersion || (this.picture && scene.version < this.picture.scene.version))) {
      return { status: 'resync_required', reason: 'scene_version_conflict', picture: this.picture };
    }
    if (!this.picture && !update.full) return { status: 'resync_required', reason: 'stream_changed_without_full_update' };
    const next = { ...(this.picture ?? {}), ...update.patch } as JarvisOperatingPicture;
    if (next.stateVersion !== update.stateVersion || next.sceneVersion !== update.sceneVersion) {
      return { status: 'resync_required', reason: 'scene_version_conflict', picture: this.picture };
    }
    this.streamId = update.streamId; this.sequence = update.sequence; this.picture = next;
    return { status: 'applied', picture: next };
  }
}
