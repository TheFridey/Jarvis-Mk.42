export class CircuitBreaker {
  private failures = 0; private openedAt = 0;
  constructor(private readonly threshold = 3, private readonly resetMs = 30_000, private readonly now = () => Date.now()) {}
  canAttempt() { return this.failures < this.threshold || this.now() - this.openedAt >= this.resetMs; }
  success() { this.failures = 0; this.openedAt = 0; }
  failure() { this.failures++; if (this.failures >= this.threshold) this.openedAt = this.now(); }
  get open() { return !this.canAttempt(); }
  get state() { return this.open ? 'open' as const : 'closed' as const; }
}
