import type { ExperienceChannel, ExperienceStreamUpdate, JarvisOperatingPicture } from '@jarvis/scene';

const CHANNEL_KEYS: Record<ExperienceChannel, ReadonlyArray<keyof JarvisOperatingPicture>> = {
  system: ['generatedAt','stateVersion','sceneVersion','systemMode','interactionState','workState','principal','presence','systemHealth','diagnostics','state','principalId'],
  objectives: ['activeObjective','activeTasks','objectives','scalesmiths'],
  cognition: ['activeModels','recentModelRuns','activeAgents','agentJobs','conversationActivity','cognitionResponses','cognitionResponseBodiesTruncated','sessions'],
  agency: ['activeCapabilities','pendingApprovals','capabilityActivity','policyDenials','approvals','agentJobs'],
  notifications: ['notifications'], scene: ['scene','selectedContext','selectedProjectId','contextId','referentFocus'], telemetry: ['telemetrySummary','voiceAudio'],
};
export const ALL_EXPERIENCE_CHANNELS = Object.freeze(Object.keys(CHANNEL_KEYS) as ExperienceChannel[]);

export function channelsForEvent(type: string): ExperienceChannel[] {
  if (type.includes('.cognition.')) return ['cognition','agency','system'];
  if (type.includes('.agency.') || type.includes('.capability.') || type.includes('.approval.')) return ['agency','system'];
  if (type.includes('.objective.')) return ['objectives','system'];
  if (type.includes('.notification.') || type.includes('.alert.')) return ['notifications','system'];
  if (type.includes('.health.') || type.includes('.mode.') || type.includes('.state.')) return ['system','scene','telemetry'];
  return ['system'];
}
export function filterExperienceUpdate(update:ExperienceStreamUpdate,channels:readonly ExperienceChannel[]):ExperienceStreamUpdate|undefined{const selected=update.channels.filter((channel)=>channels.includes(channel));if(!selected.length&&!update.full)return undefined;const included=update.full?[...channels]:selected;const patch:Partial<JarvisOperatingPicture>={};for(const channel of included)for(const key of CHANNEL_KEYS[channel])if(key in update.patch)Object.assign(patch,{[key]:update.patch[key]});return{...update,channels:included,patch}}

export class ExperienceProjection {
  private sequence = 0; private currentPicture?: JarvisOperatingPicture; private timer?: ReturnType<typeof setTimeout>;
  private pending = new Set<ExperienceChannel>(); private refreshing?: Promise<void>; private readonly history: ExperienceStreamUpdate[] = [];
  private readonly listeners = new Set<(update: ExperienceStreamUpdate) => void>();
  constructor(private readonly deps: { streamId:string; build:()=>Promise<JarvisOperatingPicture>; historySize?:number; reportError?:(error:unknown)=>void }) {}
  get streamId() { return this.deps.streamId; } get currentSequence() { return this.sequence; }
  subscribe(listener:(update:ExperienceStreamUpdate)=>void){this.listeners.add(listener);if(this.pending.size&&!this.timer)this.invalidate([]);return()=>this.listeners.delete(listener)}
  async snapshot(){if(!this.currentPicture)await this.refresh(ALL_EXPERIENCE_CHANNELS,true);return this.currentPicture!}
  invalidate(channels:ExperienceChannel[]){for(const channel of channels)this.pending.add(channel);if(!this.listeners.size)return;if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush()},0)}
  updatesAfter(streamId:string,sequence:number){if(streamId!==this.streamId)return undefined;const earliest=this.history[0]?.sequence??this.sequence;if(sequence<earliest-1)return undefined;return this.history.filter((item)=>item.sequence>sequence)}
  async fullUpdate(channels:readonly ExperienceChannel[]){const picture=await this.snapshot();return this.makeUpdate(picture,channels,true,false)}
  stop(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.listeners.clear()}
  private async flush(){if(this.refreshing)return this.refreshing;const channels=this.pending.size?[...this.pending]:ALL_EXPERIENCE_CHANNELS;this.pending.clear();this.refreshing=this.refresh(channels,false).finally(()=>{this.refreshing=undefined;if(this.pending.size)this.invalidate([])});return this.refreshing}
  private async refresh(channels:readonly ExperienceChannel[],initial:boolean){try{const picture=await this.deps.build();this.currentPicture=picture;const update=this.makeUpdate(picture,initial?ALL_EXPERIENCE_CHANNELS:channels,initial,true);this.record(update);for(const listener of this.listeners)listener(update)}catch(error){this.deps.reportError?.(error)}}
  private makeUpdate(picture:JarvisOperatingPicture,channels:readonly ExperienceChannel[],full:boolean,advance:boolean):ExperienceStreamUpdate{const selected=full?[...ALL_EXPERIENCE_CHANNELS]:[...new Set(channels)];const patch:Partial<JarvisOperatingPicture>={};for(const channel of selected)for(const key of CHANNEL_KEYS[channel])Object.assign(patch,{[key]:picture[key]});if(advance)this.sequence++;return{type:'experience.update',schemaVersion:1,streamId:this.streamId,sequence:this.sequence,generatedAt:picture.generatedAt,stateVersion:picture.stateVersion,sceneVersion:picture.sceneVersion,channels:selected,full,patch}}
  private record(update:ExperienceStreamUpdate){this.history.push(update);const limit=this.deps.historySize??128;if(this.history.length>limit)this.history.splice(0,this.history.length-limit)}
}
