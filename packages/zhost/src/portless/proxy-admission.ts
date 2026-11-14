/** Bounded per-client admission accounting for the management proxy.
 * Address identity comes from the socket, never untrusted forwarding headers.
 * No default rate/body limits are imposed on existing applications; limits are opt-in.
 */
export interface ProxyAdmissionOptions {
  /** Sustained new requests per second for each direct client IP. */
  ratePerSecond?: number;
  /** Optional per-direct-peer concurrency ceiling; includes upgraded streams. */
  maxActivePerClient?: number;
  /** Optional upgraded WebSocket budget within the global request budget. */
  maxActiveStreams?: number;
  /** Optional incoming TCP ceiling, including idle sockets. */
  maxConnections?: number;
  /** Maximum burst per client; defaults to ratePerSecond. */
  burst?: number;
  /** Maximum number of upstream HTTP requests globally in flight. */
  maxActiveRequests?: number;
  /** Streaming request body size limit. Also checked against Content-Length. */
  maxBodyBytes?: number;
}
/** Per-operation capacity receipt; successful callers own release through actual settlement. */
export interface AdmissionResult {
  /** Whether this receipt owns admitted capacity. */
  readonly allowed: boolean;
  /** 200 for admission, 429 for rate denial or 503 for capacity denial. */
  readonly status: 200 | 429 | 503;
  /** Release this admission receipt; denied receipts are inert and successful receipts release at most once.
   * @returns {void} Returns capacity without reinserting or replaying work.
   */
  release(): void;
}
/** Process-local token refill state; no distributed coordination is implied. */
interface Bucket {
  /** Fractional currently available direct-peer tokens. */
  balance: number;
  /** Last refill epoch milliseconds. */
  last: number;
}
/** Opt-in process-local direct-peer accounting; this class does not itself parse or serve HTTP. */
export class ProxyAdmission {
  readonly maxBodyBytes: number | null;
  /** Outstanding accepted request/stream reservations. */
  private active = 0;
  /** Outstanding upgraded-stream subset of accepted reservations. */
  private streams = 0;
  /** Lifetime accepted reservation count. */
  private accepted = 0;
  /** Lifetime token-budget denial count. */
  private deniedRate = 0;
  /** Lifetime concurrent/cardinality denial count. */
  private deniedCapacity = 0;
  /** Bounded direct-peer outstanding counts, removed when their last reservation releases. */
  private readonly clients = new Map<string, number>();
  /** Optional per-direct-peer concurrency ceiling. */
  private readonly perClient: number | null;
  /** Validated upgraded-stream cap within the total request budget. */
  private readonly streamLimit: number;
  readonly maxConnections: number | undefined;
  /** Bounded direct-peer refill state; oldest entries may be evicted at capacity. */
  private readonly buckets = new Map<string, Bucket>();
  /** Optional positive token refill rate per second. */
  private readonly rate: number | null;
  /** Validated token capacity, defaulting to the configured rate. */
  private readonly burst: number;
  /** Validated total outstanding request/stream ceiling. */
  private readonly concurrency: number;
  /** Hard cardinality cap on retained direct-peer labels. */
  private readonly maxClients = 4096;
  /** Validate optional direct-peer token/concurrency budgets without opening sockets or starting timers.
   * @param {ProxyAdmissionOptions} options - Trusted bounded host policy; omitted limits preserve documented legacy defaults.
   * @param {() => number} clock - Trusted epoch-millisecond source used only for token refills.
   */
  constructor(
    options: ProxyAdmissionOptions = {},
    private readonly clock = () => Date.now()
  ) {
    /** Validate an optional positive bounded integer before retaining policy.
     * @param {number | undefined} value Optional host setting.
     * @param {number} maximum Inclusive supported maximum.
     * @param {string} name Fixed configuration error label.
     * @returns {number | undefined} Validated setting or undefined without coercion. */
    const safeInt = (
      value: number | undefined,
      maximum: number,
      name: string
    ) => {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      ) {
        throw new RangeError(`Invalid ${name}`);
      }
      return value;
    };
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      typeof clock !== 'function'
    ) {
      throw new TypeError('Invalid admission options');
    }
    this.perClient =
      safeInt(options.maxActivePerClient, 100_000, 'client concurrency') ??
      null;
    this.streamLimit =
      safeInt(options.maxActiveStreams, 100_000, 'stream concurrency') ??
      100_000;
    this.maxConnections = safeInt(
      options.maxConnections,
      100_000,
      'connection concurrency'
    );
    this.rate = safeInt(options.ratePerSecond, 100_000, 'request rate') ?? null;
    /** Explicit validated token capacity; only legal with a configured refill rate. */
    const explicitBurst = safeInt(options.burst, 1_000_000, 'request burst');
    if (explicitBurst !== undefined && this.rate === null) {
      throw new RangeError('Burst requires a request rate');
    }
    this.burst = explicitBurst ?? this.rate ?? 1;
    this.concurrency =
      safeInt(options.maxActiveRequests, 100_000, 'request concurrency') ??
      100_000;
    this.maxBodyBytes =
      safeInt(options.maxBodyBytes, 1_073_741_824, 'request body size') ?? null;
  }
  /**
   * Read current outstanding admitted request/stream reservations.
   * @returns {number} Process-local count; native server sockets have a separate limit.
   */
  get activeRequests(): number {
    return this.active;
  }
  /** Return fixed-label process-local admission counters without retaining or exposing request paths and peer identifiers.
   * @returns {{ activeRequests: number; activeStreams: number; trackedClients: number; accepted: number; deniedRate: number; deniedCapacity: number }} Detached counters; not distributed rate-limit or durability guarantees.
   */
  stats() {
    return {
      activeRequests: this.active,
      activeStreams: this.streams,
      trackedClients: this.clients.size,
      accepted: this.accepted,
      deniedRate: this.deniedRate,
      deniedCapacity: this.deniedCapacity,
    };
  }
  /** Reserve one request/stream slot using only the actual direct socket peer; forwarding headers must never supply this identity.
   * @param {string | undefined} address - Optional native peer address bounded to 128 characters.
   * @param {'request' | 'stream'} kind - Validated request or upgraded-stream reservation class.
   * @returns {AdmissionResult} Explicit allowed/status receipt with idempotent release; callers release successful reservations on actual settlement.
   */
  acquire(
    address: string | undefined,
    kind: 'request' | 'stream' = 'request'
  ): AdmissionResult {
    if (
      (kind !== 'request' && kind !== 'stream') ||
      (address !== undefined &&
        (typeof address !== 'string' || address.length > 128))
    ) {
      throw new TypeError('Invalid admission identity');
    }
    /** Native peer label or fixed unknown bucket, never a forwarding-chain value. */
    const peer = address || 'unknown';
    /** Create an inert denial receipt while incrementing its fixed reason counter.
     * @param {429 | 503} status Fixed rate or capacity failure status.
     * @returns {AdmissionResult} Non-owning receipt whose release is a no-op. */
    const deny = (status: 429 | 503): AdmissionResult => {
      if (status === 429) {
        this.deniedRate++;
      } else {
        this.deniedCapacity++;
      }
      return {
        allowed: false,
        status,
        /** Release this admission receipt; denied receipts are inert and successful receipts release at most once.
         * @returns {void} Returns capacity without reinserting or replaying work.
         */ release() {},
      };
    };
    /** Per-peer outstanding capacity/cardinality guard evaluated before token consumption. */
    const clientFull =
      this.perClient !== null &&
      ((this.clients.get(peer) ?? 0) >= this.perClient ||
        (!this.clients.has(peer) && this.clients.size >= this.maxClients));
    if (
      this.active >= this.concurrency ||
      (kind === 'stream' && this.streams >= this.streamLimit) ||
      clientFull
    ) {
      return deny(503);
    }
    if (this.rate !== null) {
      /** Native peer label used only in the bounded process-local token map. */
      const ip = address || 'unknown';
      /** Trusted finite epoch-millisecond refill reading. */
      const now = this.clock();
      if (!Number.isFinite(now) || now < 0) {
        throw new Error('Invalid request clock');
      }
      let bucket = this.buckets.get(ip);
      if (!bucket) {
        // Enforce a hard bound on client cardinality; drop the oldest inactive
        // entry without permitting an unbounded attacker-controlled map.
        if (this.buckets.size >= this.maxClients) {
          this.buckets.delete(this.buckets.keys().next().value!);
        }
        bucket = { balance: this.burst, last: now };
        this.buckets.set(ip, bucket);
      } else {
        bucket.balance = Math.min(
          this.burst,
          bucket.balance + (Math.max(0, now - bucket.last) * this.rate) / 1000
        );
        bucket.last = now;
      }
      if (bucket.balance < 1) {
        return deny(429);
      }
      bucket.balance -= 1;
    }
    this.active++;
    this.accepted++;
    if (kind === 'stream') {
      this.streams++;
    }
    if (this.perClient !== null) {
      this.clients.set(peer, (this.clients.get(peer) ?? 0) + 1);
    }
    let released = false;
    return {
      allowed: true,
      status: 200,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.active--;
        if (kind === 'stream') {
          this.streams--;
        }
        if (this.perClient !== null) {
          /** Remaining outstanding reservations for this peer after release. */
          const count = (this.clients.get(peer) ?? 1) - 1;
          if (count) {
            this.clients.set(peer, count);
          } else {
            this.clients.delete(peer);
          }
        }
      },
    };
  }
}
