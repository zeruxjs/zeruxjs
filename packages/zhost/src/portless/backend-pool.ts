/** Multi-instance routing, passive failure isolation, and optional active probes.
 * State belongs to a proxy instance, never to global module state. */
import { createHash } from 'node:crypto';
import {
  BackendHealthStore,
  type SavedBackendHealth,
} from './backend-health-state.js';
import {
  probeApplicationHealth,
  validateHealthCheck,
  type HealthCheckOptions,
} from './health.js';
import type { RouteInfo, RouteBackend } from './types.js';

export interface BackendHealthOptions {
  /** Enables background probes; omit to use passive upstream errors only. */
  intervalMs?: number;
  /** Number of successive active probe failures before isolation (default 2). */
  failureThreshold?: number;
  /** Passive failures are isolated for this long (default 5000ms). */
  cooldownMs?: number;
  /** Optional HTTP health endpoint; otherwise probes TCP on loopback. */
  probe?: HealthCheckOptions;
  /** Optional private state directory for restoring recent failure isolation after proxy restarts. */
  stateDir?: string;
  /** Reject stored circuit-breaker state older than this (default 60 seconds). */
  stateMaxAgeMs?: number;
  /** Coalesce checkpoint writes; never write synchronously per HTTP request (default 250ms). */
  persistDebounceMs?: number;
}
export interface BackendStatus {
  /** Route hostname from the synchronized table. */
  hostname: string;
  /** Loopback TCP backend port. */
  port: number;
  /** Validated relative traffic weight. */
  weight: number;
  /** Whether isolation has expired at the time of the status snapshot. */
  healthy: boolean;
  /** Bounded consecutive failure count. */
  failures: number;
  /** Last observation timestamp in milliseconds, or null before any observation. */
  checkedAt: number | null;
}
interface BackendState {
  /** Validated relative traffic weight. */
  weight: number;
  /** Smooth weighted round-robin accumulator, reset when the generation changes. */
  current: number;
  /** Bounded consecutive failure count. */
  failures: number;
  /** Cooldown timestamp, or Infinity until an active probe succeeds. */
  isolatedUntil: number;
  /** Last observation timestamp in milliseconds, or null before any observation. */
  checkedAt: number | null;
}

/** Fingerprint backend membership and lease/process identity so late results cannot affect a replacement generation.
 * @param {RouteInfo} route - Current route and optional backend weights.
 * @returns {string} SHA-256 routing identity; not an authorization credential.
 */
function routeKey(route: RouteInfo): string {
  /** Validated backend targets or a detached list of this sweep’s loopback probes. */
  const targets = validateBackends(route.backends ?? [{ port: route.port }]);
  return createHash('sha256')
    .update(
      JSON.stringify([
        route.hostname,
        route.leaseId ?? null,
        route.pid ?? null,
        targets.map((target) => [target.port, target.weight ?? 1]),
      ])
    )
    .digest('hex');
}

/** Validate and copy the bounded local backend list shared by writers and selectors.
 * @param {readonly RouteBackend[]} backends - One to 32 distinct TCP ports with optional integer weights.
 * @returns {RouteBackend[]} Detached validated backend records.
 */
export function validateBackends(
  backends: readonly RouteBackend[]
): RouteBackend[] {
  if (!Array.isArray(backends) || backends.length < 1 || backends.length > 32) {
    throw new RangeError('Routes require 1–32 backends');
  }
  /** Distinct live ports used for validation and membership reconciliation. */
  const ports = new Set<number>();
  return backends.map((backend) => {
    if (
      !backend ||
      typeof backend !== 'object' ||
      !Number.isSafeInteger(backend.port) ||
      backend.port < 1 ||
      backend.port > 65535
    ) {
      throw new RangeError('Backend port must be 1–65535');
    }
    if (ports.has(backend.port)) {
      throw new TypeError('Duplicate backend port');
    }
    ports.add(backend.port);
    if (
      backend.weight !== undefined &&
      (!Number.isSafeInteger(backend.weight) ||
        backend.weight < 1 ||
        backend.weight > 100)
    ) {
      throw new RangeError('Backend weight must be 1–100');
    }
    return backend.weight === undefined
      ? { port: backend.port }
      : { port: backend.port, weight: backend.weight };
  });
}

/** Proxy-owned weighted routing and health isolation; close releases timers and local state. */
export class BackendPool {
  /** Mutable health accounting owned separately for each route hostname. */
  private readonly states = new Map<string, Map<number, BackendState>>();
  /** Current generation fingerprint per hostname; late completions must match it. */
  private readonly routeKeys = new Map<string, string>();
  /** Optional private checkpoint writer; no descriptor is held between writes. */
  private readonly healthStore?: BackendHealthStore;
  /** Boot-only health records consumed by the first synchronization. */
  private readonly restored = new Map<string, SavedBackendHealth>();
  /** Owned coalescing timer, cleared by flush or close. */
  private persistenceTimer?: ReturnType<typeof setTimeout>;
  /** Whether live health changes still need checkpointing. */
  private dirty = false;
  /** Validated checkpoint coalescing delay in milliseconds. */
  private readonly persistDebounceMs: number;
  /** Validated active-probe interval, or zero for passive-only health. */
  private readonly intervalMs: number;
  /** Consecutive active failures required for indefinite isolation. */
  private readonly failureThreshold: number;
  /** Validated passive-error isolation duration in milliseconds. */
  private readonly cooldownMs: number;
  /** Detached validated loopback health policy. */
  private readonly probeOptions: HealthCheckOptions;
  /** Owned periodic active-probe timer, stopped by close. */
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Prevents overlapping active sweeps within this proxy instance. */
  private checking = false;
  /** Fences scheduling and asynchronous state updates after teardown. */
  private closed = false;
  /** Borrowed route supplier; its lifecycle remains with the proxy host. */
  private readonly getRoutes: () => RouteInfo[];

  /** Own proxy-local health state, optional checkpoint scheduling and active-probe timer; the proxy must close this pool.
   * @param {() => RouteInfo[]} getRoutes - Borrowed synchronous supplier of the current route table.
   * @param {BackendHealthOptions} options - Validated probe, isolation and optional private checkpoint policy.
   */
  constructor(
    getRoutes: () => RouteInfo[],
    options: BackendHealthOptions = {}
  ) {
    if (
      options.intervalMs !== undefined &&
      (!Number.isSafeInteger(options.intervalMs) ||
        options.intervalMs < 100 ||
        options.intervalMs > 3_600_000)
    ) {
      throw new RangeError('Health interval must be 100–3600000ms');
    }
    this.intervalMs = options.intervalMs ?? 0;
    this.failureThreshold = options.failureThreshold ?? 2;
    this.cooldownMs = options.cooldownMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.failureThreshold) ||
      this.failureThreshold < 1 ||
      this.failureThreshold > 20
    ) {
      throw new RangeError('Invalid health failure threshold');
    }
    if (
      !Number.isSafeInteger(this.cooldownMs) ||
      this.cooldownMs < 100 ||
      this.cooldownMs > 300_000
    ) {
      throw new RangeError('Invalid backend cooldown');
    }
    this.probeOptions = validateHealthCheck(options.probe);
    this.persistDebounceMs = options.persistDebounceMs ?? 250;
    if (
      !Number.isSafeInteger(this.persistDebounceMs) ||
      this.persistDebounceMs < 0 ||
      this.persistDebounceMs > 10_000
    ) {
      throw new RangeError('Invalid health checkpoint debounce');
    }
    if (options.stateDir) {
      this.healthStore = new BackendHealthStore(
        options.stateDir,
        options.stateMaxAgeMs
      );
      for (const entry of this.healthStore.read()) {
        this.restored.set(`${entry.hostname}:${entry.port}`, entry);
      }
    }
    this.getRoutes = getRoutes;
    if (this.intervalMs) {
      this.timer = setInterval(() => {
        void this.checkNow().catch((error) =>
          console.error('Backend health sweep failed:', error)
        );
      }, this.intervalMs);
      this.timer.unref?.();
    }
  }

  /** Reconcile route membership and generation identities, applying restored health only during the first synchronization.
   * @param {readonly RouteInfo[]} routes - Current routes; malformed backend lists are omitted.
   * @returns {void} Removes absent generations and preserves current backend accounting.
   */
  sync(routes: readonly RouteInfo[]): void {
    /** Hostnames present in this synchronization; absent state is removed afterward. */
    const live = new Set<string>();
    for (const route of routes) {
      /** Validated backend targets or a detached list of this sweep’s loopback probes. */
      const targets = route.backends ?? [{ port: route.port }];
      let valid: RouteBackend[];
      try {
        valid = validateBackends(targets);
      } catch {
        continue;
      }
      /** Route hostname or generation identity associated with this state operation. */
      const key = route.hostname;
      /** Generation identity fences restored state and late health results. */
      const signature = routeKey(route);
      live.add(key);
      if (this.routeKeys.get(key) !== signature) {
        if (this.routeKeys.has(key)) {
          this.schedulePersist();
        }
        this.states.delete(key);
        this.routeKeys.set(key, signature);
      }
      let state = this.states.get(key);
      if (!state) {
        state = new Map();
        this.states.set(key, state);
      }
      /** Distinct live ports used for validation and membership reconciliation. */
      const ports = new Set(valid.map((v) => v.port));
      for (const oldPort of state.keys()) {
        if (!ports.has(oldPort)) {
          state.delete(oldPort);
        }
      }
      for (const target of valid) {
        /** Existing per-port state retained while its generation remains current. */
        const prev = state.get(target.port);
        if (prev) {
          prev.weight = target.weight ?? 1;
        } else {
          /** One-time boot checkpoint candidate for this hostname and port. */
          const saved = this.restored.get(`${key}:${target.port}`);
          /** Checkpoint admitted only when its generation identity matches. */
          const validSaved = saved?.routeKey === signature ? saved : undefined;
          state.set(target.port, {
            weight: target.weight ?? 1,
            current: 0,
            failures: validSaved?.failures ?? 0,
            isolatedUntil: validSaved?.blocked
              ? Infinity
              : (validSaved?.cooldownUntil ?? 0),
            checkedAt: validSaved?.checkedAt ?? null,
          });
        }
      }
    }
    for (const host of this.states.keys()) {
      if (!live.has(host)) {
        this.states.delete(host);
        this.routeKeys.delete(host);
        this.schedulePersist();
      }
    }
    if (this.healthStore && this.dirty) {
      this.schedulePersist();
    }
    // Disk state is only applied once after boot, never resurrected after a route switch.
    this.restored.clear();
  }

  /** Refresh membership from the borrowed route supplier without selecting traffic.
   * @returns {void} Updates pool membership only.
   */
  syncCurrentRoutes(): void {
    this.sync(this.getRoutes());
  }

  /** Perform smooth weighted round-robin among eligible backends without falling back to an isolated port.
   * @param {RouteInfo} route - Route whose previously synchronized membership is selected.
   * @returns {RouteBackend | undefined} Selected port and weight, or undefined when none is eligible.
   */
  select(route: RouteInfo): RouteBackend | undefined {
    /** Current live backend accounting; missing state is never recreated by a completion callback. */
    const state = this.states.get(route.hostname);
    if (!state) {
      return undefined;
    }
    /** Single wall-clock observation used consistently throughout this operation. */
    const now = Date.now();
    let best: [number, BackendState] | undefined;
    let sum = 0;
    for (const entry of state) {
      /** Port and mutable accounting record visited by the weighted selector. */
      const [port, value] = entry;
      // With active health checks, wait for a successful probe to rehabilitate.
      if (value.isolatedUntil === Infinity || value.isolatedUntil > now) {
        continue;
      }
      sum += value.weight;
      value.current += value.weight;
      if (!best || value.current > best[1].current) {
        best = [port, value];
      }
    }
    if (!best) {
      return undefined;
    }
    best[1].current -= sum;
    return { port: best[0], weight: best[1].weight };
  }

  /** Compute the generation fence to retain alongside an upstream request.
   * @param {RouteInfo} route - Route observed before forwarding.
   * @returns {string} Routing identity for rejecting stale completion callbacks.
   */
  signature(route: RouteInfo): string {
    return routeKey(route);
  }
  /** Clear isolation after successful traffic or a probe, ignoring a mismatched generation fence.
   * @param {string} hostname - Previously synchronized hostname.
   * @param {number} port - Backend port observed by the completed request.
   * @param {string} expectedRouteKey - Optional routing identity captured before forwarding.
   * @returns {void} Updates matching live state and schedules a checkpoint when needed.
   */
  markSuccess(hostname: string, port: number, expectedRouteKey?: string): void {
    if (expectedRouteKey && expectedRouteKey !== this.routeKeys.get(hostname)) {
      return;
    }
    /** Current live backend accounting; missing state is never recreated by a completion callback. */
    const state = this.states.get(hostname)?.get(port);
    if (!state) {
      return;
    }
    /** Whether this successful observation changes persisted isolation state. */
    const changed = state.failures > 0 || state.isolatedUntil !== 0;
    state.failures = 0;
    state.isolatedUntil = 0;
    state.checkedAt = Date.now();
    if (changed) {
      this.schedulePersist();
    }
  }
  /** Record passive connection failure and isolate until cooldown or a successful active probe.
   * @param {string} hostname - Previously synchronized hostname.
   * @param {number} port - Failed backend port.
   * @param {string} expectedRouteKey - Optional routing identity captured before forwarding.
   * @returns {void} Ignores absent backends and stale generations.
   */
  markFailure(hostname: string, port: number, expectedRouteKey?: string): void {
    if (expectedRouteKey && expectedRouteKey !== this.routeKeys.get(hostname)) {
      return;
    }
    /** Current live backend accounting; missing state is never recreated by a completion callback. */
    const state = this.states.get(hostname)?.get(port);
    if (!state) {
      return;
    }
    state.failures = Math.min(1_000_000, state.failures + 1);
    state.checkedAt = Date.now();
    // Passive upstream connection errors are immediate evidence that a backend failed.
    state.isolatedUntil = this.intervalMs
      ? Infinity
      : Date.now() + this.cooldownMs;
    this.schedulePersist();
  }
  /** Copy current health counters without choosing a backend.
   * @returns {BackendStatus[]} Detached records with cooldown-derived health at the current time.
   */
  status(): BackendStatus[] {
    /** Single wall-clock observation used consistently throughout this operation. */
    const now = Date.now();
    return [...this.states].flatMap(([hostname, ports]) =>
      [...ports].map(([port, state]) => ({
        hostname,
        port,
        weight: state.weight,
        healthy: state.isolatedUntil <= now,
        failures: state.failures,
        checkedAt: state.checkedAt,
      }))
    );
  }
  /** Run one bounded loopback probe sweep; concurrent sweep requests return without starting another.
   * @returns {Promise<void>} Settles after this sweep; close prevents new probes but does not cancel an already running probe.
   */
  async checkNow(): Promise<void> {
    if (this.closed || this.checking) {
      return;
    }
    this.checking = true;
    try {
      this.sync(this.getRoutes());
      /** Validated backend targets or a detached list of this sweep’s loopback probes. */
      const targets = [...this.states].flatMap(([host, ports]) =>
        [...ports.keys()].map((port) => ({
          host,
          port,
          key: this.routeKeys.get(host),
        }))
      );
      // Bound concurrent loopback checks to avoid exhausting sockets for many routes.
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, targets.length) }, async () => {
          while (cursor < targets.length && !this.closed) {
            /** Next probe claimed synchronously before yielding, within the cursor bounds. */
            const { host, port, key } = targets[cursor++]!;
            /** Probe result normalized to false on a probe failure. */
            const result = await probeApplicationHealth(
              port,
              this.probeOptions
            ).catch(() => false);
            if (
              this.closed ||
              this.routeKeys.get(host) !== key ||
              !this.states.get(host)?.has(port)
            ) {
              continue;
            }
            if (result) {
              this.markSuccess(host, port);
            } else {
              /** Current live backend accounting; missing state is never recreated by a completion callback. */
              const state = this.states.get(host)!.get(port)!;
              state.failures = Math.min(1_000_000, state.failures + 1);
              state.checkedAt = Date.now();
              if (state.failures >= this.failureThreshold) {
                state.isolatedUntil = Infinity;
              }
              this.schedulePersist();
            }
          }
        })
      );
    } finally {
      this.checking = false;
    }
  }
  /** Write bounded circuit-breaker state to the optional private checkpoint, excluding request statistics.
   * @returns {void} Clears dirty state only after a successful write; persistence errors propagate.
   */
  flushHealth(): void {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
    }
    this.persistenceTimer = undefined;
    if (!this.healthStore || !this.dirty) {
      return;
    }
    /** Bounded checkpoint records containing health metadata only. */
    const entries: SavedBackendHealth[] = [];
    for (const [hostname, ports] of this.states) {
      /** Route hostname or generation identity associated with this state operation. */
      const key = this.routeKeys.get(hostname);
      if (!key) {
        continue;
      }
      for (const [port, item] of ports) {
        if (entries.length >= 1024) {
          break;
        }
        entries.push({
          hostname,
          routeKey: key,
          port,
          failures: item.failures,
          checkedAt: item.checkedAt,
          blocked: item.isolatedUntil === Infinity,
          cooldownUntil: Number.isFinite(item.isolatedUntil)
            ? item.isolatedUntil
            : 0,
        });
      }
    }
    this.healthStore.write(entries);
    this.dirty = false;
  }
  /** Coalesce health changes behind one unreferenced checkpoint timer.
   * @returns {void} Does nothing after close or when persistence is disabled.
   */
  private schedulePersist(): void {
    if (this.closed || !this.healthStore) {
      return;
    }
    this.dirty = true;
    if (this.persistenceTimer) {
      return;
    }
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = undefined;
      try {
        this.flushHealth();
      } catch (error) {
        console.error('Failed to persist backend health state:', error);
      }
    }, this.persistDebounceMs);
    this.persistenceTimer.unref?.();
  }
  /** Stop owned timers, attempt the final checkpoint and discard state; borrowed route suppliers remain untouched.
   * @returns {void} Idempotent synchronous cleanup; an in-flight probe may still settle and is fenced from state updates.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = undefined;
    try {
      this.flushHealth();
    } catch (error) {
      // A corrupt/read-only health checkpoint must not prevent proxy shutdown.
      console.error('Failed to flush backend health checkpoint:', error);
    } finally {
      this.closed = true;
      this.states.clear();
      this.routeKeys.clear();
      this.restored.clear();
    }
  }
}
