/** Sliding restart-attempt budget. Failed spawns count toward the limit. */
export class SlidingRestartBudget {
  private readonly timestamps: number[] = [];
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly baseDelayMs: number,
    readonly maxDelayMs: number,
  ) {}
  private expire(now: number): void {
    while (this.timestamps.length && this.timestamps[0] <= now - this.windowMs) this.timestamps.shift();
  }
  get used(): number { this.expire(Date.now()); return this.timestamps.length; }
  snapshot(): readonly number[] { this.expire(Date.now()); return [...this.timestamps]; }
  restore(saved: readonly number[]): void {
    if (!Array.isArray(saved) || saved.length > 1000 ||
        saved.some((t, i) => !Number.isSafeInteger(t) || t < 0 || t > Date.now() + 30_000 || (i > 0 && t < saved[i - 1]))) {
      throw new TypeError('Invalid saved restart attempts');
    }
    this.timestamps.length = 0;
    this.timestamps.push(...saved.filter(t => t > Date.now() - this.windowMs).slice(-this.limit || undefined));
    if (this.limit === 0) this.timestamps.length = 0;
  }
  canAttempt(): boolean { return this.used < this.limit; }
  /** Consume exactly one attempt and return its capped exponential delay. */
  consume(): number {
    if (!this.canAttempt()) throw new Error('Replacement budget exhausted');
    const earlier = this.timestamps.length;
    this.timestamps.push(Date.now());
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.min(earlier, 16));
  }
}
