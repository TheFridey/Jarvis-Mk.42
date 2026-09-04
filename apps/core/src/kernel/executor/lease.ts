export class ResourceLeaseManager {
  private readonly held = new Map<string, string>();
  async acquire(resource: string, invocation: string) { if (this.held.has(resource)) return false; this.held.set(resource, invocation); return true; }
  release(resource: string, invocation: string) { if (this.held.get(resource) === invocation) this.held.delete(resource); }
}
