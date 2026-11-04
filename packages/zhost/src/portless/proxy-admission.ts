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
export interface AdmissionResult { readonly allowed: boolean; readonly status: 200 | 429 | 503; release(): void }
interface Bucket { balance: number; last: number }
export class ProxyAdmission {
  readonly maxBodyBytes: number | null;
  private active = 0;
  private streams = 0;
  private accepted = 0;
  private deniedRate = 0;
  private deniedCapacity = 0;
  private readonly clients = new Map<string, number>();
  private readonly perClient: number | null;
  private readonly streamLimit: number;
  readonly maxConnections: number | undefined;
  private readonly buckets = new Map<string, Bucket>();
  private readonly rate: number | null;
  private readonly burst: number;
  private readonly concurrency: number;
  private readonly maxClients = 4096;
  constructor(options: ProxyAdmissionOptions = {}, private readonly clock = () => Date.now()) {
    const safeInt = (value: number | undefined, maximum: number, name: string) => {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > maximum)) throw new RangeError(`Invalid ${name}`);
      return value;
    };
    if (!options || typeof options !== 'object' || Array.isArray(options) || typeof clock !== 'function') throw new TypeError('Invalid admission options');
    this.perClient = safeInt(options.maxActivePerClient, 100_000, 'client concurrency') ?? null;
    this.streamLimit = safeInt(options.maxActiveStreams, 100_000, 'stream concurrency') ?? 100_000;
    this.maxConnections = safeInt(options.maxConnections, 100_000, 'connection concurrency');
    this.rate = safeInt(options.ratePerSecond, 100_000, 'request rate') ?? null;
    const explicitBurst = safeInt(options.burst, 1_000_000, 'request burst');
    if (explicitBurst !== undefined && this.rate === null) throw new RangeError('Burst requires a request rate');
    this.burst = explicitBurst ?? this.rate ?? 1;
    this.concurrency = safeInt(options.maxActiveRequests, 100_000, 'request concurrency') ?? 100_000;
    this.maxBodyBytes = safeInt(options.maxBodyBytes, 1_073_741_824, 'request body size') ?? null;
  }
  get activeRequests(): number { return this.active; }
  /** Fixed-label process-local counters; no client identifiers escape. */
  stats() {
    return { activeRequests: this.active, activeStreams: this.streams, trackedClients: this.clients.size,
      accepted: this.accepted, deniedRate: this.deniedRate, deniedCapacity: this.deniedCapacity };
  }
  acquire(address: string | undefined, kind: 'request' | 'stream' = 'request'): AdmissionResult {
    if ((kind !== 'request' && kind !== 'stream') ||
        (address !== undefined && (typeof address !== 'string' || address.length > 128))) throw new TypeError('Invalid admission identity');
    const peer = address || 'unknown';
    const deny = (status: 429 | 503): AdmissionResult => {
      if (status === 429) this.deniedRate++; else this.deniedCapacity++;
      return { allowed: false, status, release() {} };
    };
    const clientFull = this.perClient !== null && ((this.clients.get(peer) ?? 0) >= this.perClient ||
      (!this.clients.has(peer) && this.clients.size >= this.maxClients));
    if (this.active >= this.concurrency || (kind === 'stream' && this.streams >= this.streamLimit) || clientFull) return deny(503);
    if (this.rate !== null) {
      const ip = address || 'unknown';
      const now = this.clock();
      if (!Number.isFinite(now) || now < 0) throw new Error('Invalid request clock');
      let bucket = this.buckets.get(ip);
      if (!bucket) {
        // Enforce a hard bound on client cardinality; drop the oldest inactive
        // entry without permitting an unbounded attacker-controlled map.
        if (this.buckets.size >= this.maxClients) this.buckets.delete(this.buckets.keys().next().value!);
        bucket = { balance: this.burst, last: now };
        this.buckets.set(ip, bucket);
      } else {
        bucket.balance = Math.min(this.burst, bucket.balance + Math.max(0, now - bucket.last) * this.rate / 1000);
        bucket.last = now;
      }
      if (bucket.balance < 1) return deny(429);
      bucket.balance -= 1;
    }
    this.active++;
    this.accepted++;
    if (kind === 'stream') this.streams++;
    if (this.perClient !== null) this.clients.set(peer, (this.clients.get(peer) ?? 0) + 1);
    let released = false;
    return { allowed: true, status: 200, release: () => {
      if (released) return;
      released = true;
      this.active--;
      if (kind === 'stream') this.streams--;
      if (this.perClient !== null) {
        const count = (this.clients.get(peer) ?? 1) - 1;
        if (count) this.clients.set(peer, count); else this.clients.delete(peer);
      }
    } };
  }
}
