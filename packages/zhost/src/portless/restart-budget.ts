/** Sliding restart-attempt budget. Failed spawns count toward the limit. */
export class SlidingRestartBudget {
  /** Ordered attempt times, including failed spawns, retained only within the sliding window. */
  private readonly timestamps: number[] = [];
  /**
   * Create accounting state using limits already validated by the fleet launcher.
   *
   * @param {number} limit - Maximum attempts in one window; zero disables replacements.
   * @param {number} windowMs - Sliding accounting window in milliseconds.
   * @param {number} baseDelayMs - Initial replacement backoff in milliseconds.
   * @param {number} maxDelayMs - Upper bound for exponential backoff in milliseconds.
   */
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly baseDelayMs: number,
    readonly maxDelayMs: number
  ) {}
  /**
   * Remove attempts at or before the window boundary.
   *
   * @param {number} now - Current wall-clock timestamp in milliseconds.
   * @returns {void} Updates this budget only.
   */
  private expire(now: number): void {
    while (
      this.timestamps.length &&
      this.timestamps[0]! <= now - this.windowMs
    ) {
      this.timestamps.shift();
    }
  }
  /**
   * Count attempts remaining after expiring the current wall-clock window.
   *
   * @returns {number} Current attempt count, without consuming another attempt.
   */
  get used(): number {
    this.expire(Date.now());
    return this.timestamps.length;
  }
  /**
   * Copy live attempt times for host-owned durable checkpointing.
   *
   * @returns {readonly number[]} Detached timestamp array; this class does not persist it.
   */
  snapshot(): readonly number[] {
    this.expire(Date.now());
    return [...this.timestamps];
  }
  /**
   * Validate a checkpoint before replacing accounting state and discarding expired attempts.
   *
   * @param {readonly number[]} saved - Ordered integer timestamps, allowing at most 30 seconds of clock skew.
   * @returns {void} Retains only live attempts within the configured count limit.
   * @throws {TypeError} When the checkpoint is malformed, too large or out of order.
   */
  restore(saved: readonly number[]): void {
    if (
      !Array.isArray(saved) ||
      saved.length > 1000 ||
      saved.some(
        (t, i) =>
          !Number.isSafeInteger(t) ||
          t < 0 ||
          t > Date.now() + 30_000 ||
          (i > 0 && t < saved[i - 1])
      )
    ) {
      throw new TypeError('Invalid saved restart attempts');
    }
    this.timestamps.length = 0;
    this.timestamps.push(
      ...saved
        .filter((t) => t > Date.now() - this.windowMs)
        .slice(-this.limit || undefined)
    );
    if (this.limit === 0) {
      this.timestamps.length = 0;
    }
  }
  /**
   * Check available capacity without reserving a replacement.
   *
   * @returns {boolean} Whether another attempt may be consumed now.
   */
  canAttempt(): boolean {
    return this.used < this.limit;
  }
  /**
   * Consume exactly one attempt, including a subsequent failed spawn.
   *
   * @returns {number} Capped exponential delay in milliseconds.
   * @throws {Error} When the live attempt budget is exhausted.
   */
  consume(): number {
    if (!this.canAttempt()) {
      throw new Error('Replacement budget exhausted');
    }
    /** Prior live attempts determine backoff before this new attempt is recorded. */
    const earlier = this.timestamps.length;
    this.timestamps.push(Date.now());
    return Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** Math.min(earlier, 16)
    );
  }
}
