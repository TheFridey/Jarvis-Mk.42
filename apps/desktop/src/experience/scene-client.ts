'use client';
import type { DesktopApprovalCommand, DesktopKernelSnapshot, DesktopProposalCommand, DesktopProposalResponse, SceneIntent, SceneSnapshot, SemanticScene } from '@jarvis/scene';
import { applySceneIntent, createSnapshot } from '@jarvis/scene';

export type KernelConnection = { status: 'connecting' | 'live' | 'reconnecting' | 'offline' | 'demo'; lastConnectedAt?: string; error?: string };
export interface SceneTransport {
  readonly kind: 'live' | 'demo';
  subscribe(listener: (scene: SemanticScene) => void): () => void;
  subscribeKernel(listener: (snapshot: DesktopKernelSnapshot | undefined) => void): () => void;
  subscribeConnection(listener: (state: KernelConnection) => void): () => void;
  submit(intent: SceneIntent, expectedVersion: number): Promise<void>;
  submitProposal(command: DesktopProposalCommand): Promise<DesktopProposalResponse>;
  decideApproval(command: DesktopApprovalCommand): Promise<void>;
  reconnect(): Promise<void>;
  close(): void;
}
export interface LayoutCache { read(sceneId: string): SceneSnapshot | undefined; write(sceneId: string, snapshot: SceneSnapshot): void; }
export class BrowserLayoutCache implements LayoutCache { read(sceneId: string) { try { const raw = localStorage.getItem(`jarvis:scene:${sceneId}`); return raw ? JSON.parse(raw) as SceneSnapshot : undefined; } catch { return undefined; } } write(sceneId: string, snapshot: SceneSnapshot) { localStorage.setItem(`jarvis:scene:${sceneId}`, JSON.stringify(snapshot)); } }

export class LocalSceneTransport implements SceneTransport {
  readonly kind = 'demo' as const; private scene: SemanticScene; private restored = false; private readonly listeners = new Set<(scene: SemanticScene) => void>();
  constructor(initial: SemanticScene, private readonly cache?: LayoutCache) { this.scene = initial; }
  subscribe(listener: (scene: SemanticScene) => void) { if (!this.restored) { this.restored = true; this.restoreCached(); } this.listeners.add(listener); listener(this.scene); return () => this.listeners.delete(listener); }
  subscribeKernel(listener: (snapshot: DesktopKernelSnapshot | undefined) => void) { listener(undefined); return () => undefined; }
  subscribeConnection(listener: (state: KernelConnection) => void) { listener({ status: 'demo' }); return () => undefined; }
  restoreCached() { const saved = this.cache?.read(this.scene.id); if (!saved) return; this.scene = applySceneIntent(this.scene, { type: 'restore', snapshot: saved, availableResourceRefs: this.scene.objects.flatMap((object) => object.resourceRefs), monitors: this.scene.monitors, input: 'keyboard' }); this.emit(); }
  async submit(intent: SceneIntent, expectedVersion: number) { if (expectedVersion !== this.scene.version) throw new Error('SCENE_VERSION_CONFLICT'); this.scene = applySceneIntent(this.scene, intent); this.cache?.write(this.scene.id, createSnapshot(this.scene, 'latest')); this.emit(); }
  async submitProposal(): Promise<DesktopProposalResponse> { throw new Error('DEMO_MODE_NO_KERNEL'); }
  async decideApproval(): Promise<void> { throw new Error('DEMO_MODE_NO_KERNEL'); }
  async reconnect() { this.emit(); }
  close() { this.listeners.clear(); }
  private emit() { this.listeners.forEach((listener) => listener(this.scene)); }
}

export class KernelSceneTransport implements SceneTransport {
  readonly kind = 'live' as const; private scene?: SemanticScene; private snapshot?: DesktopKernelSnapshot; private status: KernelConnection = { status: 'connecting' }; private stopped = false; private polling = false; private timer?: ReturnType<typeof setTimeout>; private failures = 0;
  private readonly sceneListeners = new Set<(scene: SemanticScene) => void>(); private readonly kernelListeners = new Set<(snapshot: DesktopKernelSnapshot | undefined) => void>(); private readonly connectionListeners = new Set<(state: KernelConnection) => void>();
  constructor(private readonly options: { endpoint: string; token: string; cache?: LayoutCache; fetch?: typeof globalThis.fetch; pollMs?: number; retryMaxMs?: number }) {}
  subscribe(listener: (scene: SemanticScene) => void) { this.sceneListeners.add(listener); if (this.scene) listener(this.scene); this.start(); return () => this.sceneListeners.delete(listener); }
  subscribeKernel(listener: (snapshot: DesktopKernelSnapshot | undefined) => void) { this.kernelListeners.add(listener); listener(this.snapshot); this.start(); return () => this.kernelListeners.delete(listener); }
  subscribeConnection(listener: (state: KernelConnection) => void) { this.connectionListeners.add(listener); listener(this.status); this.start(); return () => this.connectionListeners.delete(listener); }
  async submit(intent: SceneIntent, expectedVersion: number) { if (!this.scene || expectedVersion !== this.scene.version) throw new Error('SCENE_VERSION_CONFLICT'); const authoritativeVersion = this.scene.version; this.scene = { ...applySceneIntent(this.scene, intent), version: authoritativeVersion }; this.options.cache?.write(this.scene.id, createSnapshot(this.scene, 'presentation')); this.sceneListeners.forEach((listener) => listener(this.scene!)); }
  async submitProposal(command: DesktopProposalCommand) { return this.command<DesktopProposalResponse>('/desktop/proposals', command); }
  async decideApproval(command: DesktopApprovalCommand) { await this.command('/desktop/approvals', command); await this.poll(); }
  async reconnect() { this.failures = 0; this.setStatus({ status: 'reconnecting' }); await this.poll(); }
  close() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  private start() { if (this.stopped) this.stopped = false; if (!this.timer && !this.polling) void this.poll(); }
  private async poll() {
    if (this.stopped || this.polling) return;
    this.polling = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    try {
      const response = await this.request('/desktop/snapshot'); if (!response.ok) throw new Error(`Kernel snapshot HTTP ${response.status}`);
      const snapshot = await response.json() as DesktopKernelSnapshot; if (snapshot.schemaVersion !== 1 || !snapshot.scene || typeof snapshot.stateVersion !== 'number') throw new Error('Invalid Kernel snapshot');
      this.failures = 0; this.snapshot = snapshot; this.scene = this.restorePresentation(snapshot.scene); this.kernelListeners.forEach((listener) => listener(snapshot)); this.sceneListeners.forEach((listener) => listener(this.scene!)); this.setStatus({ status: 'live', lastConnectedAt: new Date().toISOString() }); this.schedule(this.options.pollMs ?? 1500);
    } catch (error) { this.failures++; this.setStatus({ status: this.snapshot ? 'reconnecting' : 'offline', ...(error instanceof Error ? { error: error.message } : {}) }); this.schedule(Math.min((this.options.pollMs ?? 1500) * 2 ** Math.min(this.failures, 5), this.options.retryMaxMs ?? 15_000)); }
    finally { this.polling = false; }
  }
  private async command<T = unknown>(path: string, body: unknown): Promise<T> {
    if (this.status.status !== 'live' || !this.snapshot) throw new Error('KERNEL_OFFLINE_COMMAND_REJECTED');
    const response = await this.request(path, { method: 'POST', body: JSON.stringify(body) });
    if (response.status === 409) { await this.poll(); throw new Error('STATE_VERSION_CONFLICT'); }
    if (!response.ok) throw new Error(`KERNEL_COMMAND_REJECTED_${response.status}`);
    return response.json() as Promise<T>;
  }
  private request(path: string, init: RequestInit = {}) { return (this.options.fetch ?? globalThis.fetch)(`${this.options.endpoint.replace(/\/$/, '')}${path}`, { ...init, headers: { authorization: `Bearer ${this.options.token}`, 'content-type': 'application/json', ...init.headers } }); }
  private schedule(ms: number) { if (!this.stopped) this.timer = setTimeout(() => { this.timer = undefined; void this.poll(); }, ms); }
  private setStatus(status: KernelConnection) { this.status = status; this.connectionListeners.forEach((listener) => listener(status)); }
  private restorePresentation(scene: SemanticScene) { const saved = this.options.cache?.read(scene.id); if (!saved) return scene; const savedById = new Map(saved.objects.map((object) => [object.id, object])); return { ...scene, objects: scene.objects.map((object) => { const prior = savedById.get(object.id); return prior ? { ...object, monitorId: prior.monitorId, position: prior.position, size: prior.size, state: prior.state, pinned: prior.pinned, zIndex: prior.zIndex } : object; }) }; }
}

export function createDesktopTransport(): SceneTransport { return new KernelSceneTransport({ endpoint: process.env.NEXT_PUBLIC_JARVIS_CORE_URL ?? 'http://127.0.0.1:7420', token: process.env.NEXT_PUBLIC_JARVIS_DESKTOP_TOKEN ?? 'dev-desktop-token', cache: new BrowserLayoutCache() }); }
