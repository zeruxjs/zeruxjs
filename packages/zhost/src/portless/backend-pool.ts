/** Multi-instance routing, passive failure isolation, and optional active probes.
 * State belongs to a proxy instance, never to global module state. */
import { createHash } from 'node:crypto';
import { BackendHealthStore, type SavedBackendHealth } from './backend-health-state.js';
import { probeApplicationHealth, validateHealthCheck, type HealthCheckOptions } from './health.js';
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
  hostname: string;
  port: number;
  weight: number;
  healthy: boolean;
  failures: number;
  checkedAt: number | null;
}
interface BackendState { weight: number; current: number; failures: number; isolatedUntil: number; checkedAt: number | null; }

/** A new route lease or process must not inherit the prior generation's failures. */
function routeKey(route: RouteInfo): string {
  const targets = validateBackends(route.backends ?? [{ port: route.port }]);
  return createHash('sha256').update(JSON.stringify([route.hostname, route.leaseId ?? null, route.pid ?? null,
    targets.map(target => [target.port, target.weight ?? 1])])).digest('hex');
}

/** Validation is shared by route-file writers and the runtime selector. */
export function validateBackends(backends: readonly RouteBackend[]): RouteBackend[] {
  if (!Array.isArray(backends) || backends.length < 1 || backends.length > 32) throw new RangeError('Routes require 1–32 backends');
  const ports = new Set<number>();
  return backends.map(backend => {
    if (!backend || typeof backend !== 'object' || !Number.isSafeInteger(backend.port) || backend.port < 1 || backend.port > 65535) {
      throw new RangeError('Backend port must be 1–65535');
    }
    if (ports.has(backend.port)) throw new TypeError('Duplicate backend port');
    ports.add(backend.port);
    if (backend.weight !== undefined && (!Number.isSafeInteger(backend.weight) || backend.weight < 1 || backend.weight > 100)) {
      throw new RangeError('Backend weight must be 1–100');
    }
    return backend.weight === undefined ? { port: backend.port } : { port: backend.port, weight: backend.weight };
  });
}

export class BackendPool {
  private readonly states = new Map<string, Map<number, BackendState>>();
  private readonly routeKeys = new Map<string, string>();
  private readonly healthStore?: BackendHealthStore;
  private readonly restored = new Map<string, SavedBackendHealth>();
  private persistenceTimer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private readonly persistDebounceMs: number;
  private readonly intervalMs: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly probeOptions: HealthCheckOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  private closed = false;
  private readonly getRoutes: () => RouteInfo[];

  constructor(getRoutes: () => RouteInfo[], options: BackendHealthOptions = {}) {
    if (options.intervalMs !== undefined && (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 100 || options.intervalMs > 3_600_000)) {
      throw new RangeError('Health interval must be 100–3600000ms');
    }
    this.intervalMs = options.intervalMs ?? 0;
    this.failureThreshold = options.failureThreshold ?? 2;
    this.cooldownMs = options.cooldownMs ?? 5_000;
    if (!Number.isSafeInteger(this.failureThreshold) || this.failureThreshold < 1 || this.failureThreshold > 20) throw new RangeError('Invalid health failure threshold');
    if (!Number.isSafeInteger(this.cooldownMs) || this.cooldownMs < 100 || this.cooldownMs > 300_000) throw new RangeError('Invalid backend cooldown');
    this.probeOptions = validateHealthCheck(options.probe);
    this.persistDebounceMs = options.persistDebounceMs ?? 250;
    if (!Number.isSafeInteger(this.persistDebounceMs) || this.persistDebounceMs < 0 || this.persistDebounceMs > 10_000) {
      throw new RangeError('Invalid health checkpoint debounce');
    }
    if (options.stateDir) {
      this.healthStore = new BackendHealthStore(options.stateDir, options.stateMaxAgeMs);
      for (const entry of this.healthStore.read()) this.restored.set(`${entry.hostname}:${entry.port}`, entry);
    }
    this.getRoutes = getRoutes;
    if (this.intervalMs) {
      this.timer = setInterval(() => { void this.checkNow().catch(error => console.error('Backend health sweep failed:', error)); }, this.intervalMs);
      this.timer.unref?.();
    }
  }

  /** Keep states only while both route and backend remain in the current table. */
  sync(routes: readonly RouteInfo[]): void {
    const live = new Set<string>();
    for (const route of routes) {
      const targets = route.backends ?? [{ port: route.port }];
      let valid: RouteBackend[];
      try { valid = validateBackends(targets); } catch { continue; }
      const key = route.hostname;
      const signature = routeKey(route);
      live.add(key);
      if (this.routeKeys.get(key) !== signature) {
        if (this.routeKeys.has(key)) this.schedulePersist();
        this.states.delete(key);
        this.routeKeys.set(key, signature);
      }
      let state = this.states.get(key);
      if (!state) { state = new Map(); this.states.set(key, state); }
      const ports = new Set(valid.map(v => v.port));
      for (const oldPort of state.keys()) if (!ports.has(oldPort)) state.delete(oldPort);
      for (const target of valid) {
        const prev = state.get(target.port);
        if (prev) prev.weight = target.weight ?? 1;
        else {
          const saved = this.restored.get(`${key}:${target.port}`);
          const validSaved = saved?.routeKey === signature ? saved : undefined;
          state.set(target.port, { weight: target.weight ?? 1, current: 0,
            failures: validSaved?.failures ?? 0,
            isolatedUntil: validSaved?.blocked ? Infinity : (validSaved?.cooldownUntil ?? 0),
            checkedAt: validSaved?.checkedAt ?? null });
        }
      }
    }
    for (const host of this.states.keys()) if (!live.has(host)) { this.states.delete(host); this.routeKeys.delete(host); this.schedulePersist(); }
    if (this.healthStore && this.dirty) this.schedulePersist();
    // Disk state is only applied once after boot, never resurrected after a route switch.
    this.restored.clear();
  }

  /** Refresh a status report without selecting a backend or sending traffic. */
  syncCurrentRoutes(): void { this.sync(this.getRoutes()); }

  /** Smooth weighted round-robin among healthy endpoints, with no fallback to a known-bad port. */
  select(route: RouteInfo): RouteBackend | undefined {
    const state = this.states.get(route.hostname);
    if (!state) return undefined;
    const now = Date.now();
    let best: [number, BackendState] | undefined;
    let sum = 0;
    for (const entry of state) {
      const [port, value] = entry;
      // With active health checks, wait for a successful probe to rehabilitate.
      if (value.isolatedUntil === Infinity || value.isolatedUntil > now) continue;
      sum += value.weight;
      value.current += value.weight;
      if (!best || value.current > best[1].current) best = [port, value];
    }
    if (!best) return undefined;
    best[1].current -= sum;
    return { port: best[0], weight: best[1].weight };
  }

  /** Ignore late responses belonging to an earlier route generation. */
  signature(route: RouteInfo): string { return routeKey(route); }
  markSuccess(hostname: string, port: number, expectedRouteKey?: string): void {
    if (expectedRouteKey && expectedRouteKey !== this.routeKeys.get(hostname)) return;
    const state = this.states.get(hostname)?.get(port);
    if (!state) return;
    const changed = state.failures > 0 || state.isolatedUntil !== 0;
    state.failures = 0;
    state.isolatedUntil = 0;
    state.checkedAt = Date.now();
    if (changed) this.schedulePersist();
  }
  markFailure(hostname: string, port: number, expectedRouteKey?: string): void {
    if (expectedRouteKey && expectedRouteKey !== this.routeKeys.get(hostname)) return;
    const state = this.states.get(hostname)?.get(port);
    if (!state) return;
    state.failures = Math.min(1_000_000, state.failures + 1);
    state.checkedAt = Date.now();
    // Passive upstream connection errors are immediate evidence that a backend failed.
    state.isolatedUntil = this.intervalMs ? Infinity : Date.now() + this.cooldownMs;
    this.schedulePersist();
  }
  status(): BackendStatus[] {
    const now = Date.now();
    return [...this.states].flatMap(([hostname, ports]) => [...ports].map(([port, state]) => ({
      hostname, port, weight: state.weight, healthy: state.isolatedUntil <= now,
      failures: state.failures, checkedAt: state.checkedAt,
    })));
  }
  /** Immediate health sweep, useful for deployments and operational tooling. */
  async checkNow(): Promise<void> {
    if (this.closed || this.checking) return;
    this.checking = true;
    try {
      this.sync(this.getRoutes());
      const targets = [...this.states].flatMap(([host, ports]) => [...ports.keys()].map(port => ({ host, port, key: this.routeKeys.get(host) })));
      // Bound concurrent loopback checks to avoid exhausting sockets for many routes.
      let cursor = 0;
      await Promise.all(Array.from({length: Math.min(8, targets.length)}, async () => {
        while (cursor < targets.length && !this.closed) {
          const { host, port, key } = targets[cursor++];
          const result = await probeApplicationHealth(port, this.probeOptions).catch(() => false);
          if (this.closed || this.routeKeys.get(host) !== key || !this.states.get(host)?.has(port)) continue;
          if (result) this.markSuccess(host, port);
          else {
            const state = this.states.get(host)!.get(port)!;
            state.failures = Math.min(1_000_000, state.failures + 1);
            state.checkedAt = Date.now();
            if (state.failures >= this.failureThreshold) state.isolatedUntil = Infinity;
            this.schedulePersist();
          }
        }
      }));
    } finally { this.checking = false; }
  }
  /** Persist recent circuit breakers, not request-count statistics or route ownership. */
  flushHealth(): void {
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    this.persistenceTimer = undefined;
    if (!this.healthStore || !this.dirty) return;
    const entries: SavedBackendHealth[] = [];
    for (const [hostname, ports] of this.states) {
      const key = this.routeKeys.get(hostname);
      if (!key) continue;
      for (const [port, item] of ports) {
        if (entries.length >= 1024) break;
        entries.push({ hostname, routeKey: key, port, failures: item.failures, checkedAt: item.checkedAt,
          blocked: item.isolatedUntil === Infinity,
          cooldownUntil: Number.isFinite(item.isolatedUntil) ? item.isolatedUntil : 0 });
      }
    }
    this.healthStore.write(entries);
    this.dirty = false;
  }
  private schedulePersist(): void {
    if (this.closed || !this.healthStore) return;
    this.dirty = true;
    if (this.persistenceTimer) return;
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = undefined;
      try { this.flushHealth(); } catch (error) { console.error('Failed to persist backend health state:', error); }
    }, this.persistDebounceMs);
    this.persistenceTimer.unref?.();
  }
  close(): void {
    if (this.closed) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try { this.flushHealth(); } catch (error) {
      // A corrupt/read-only health checkpoint must not prevent proxy shutdown.
      console.error('Failed to flush backend health checkpoint:', error);
    } finally {
      this.closed = true; this.states.clear(); this.routeKeys.clear(); this.restored.clear();
    }
  }
}
