---
{
  "title": "Server orchestration and local proxies",
  "description": "Set up zhost with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zhost",
  "sources": [
    "packages/zhost/README.md",
    "packages/zhost/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Installation and integration path

```sh
npm install zhost@0.0.4
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { startServer } from 'zhost';
type ServerSetup = Parameters<typeof startServer>[0];
type StartedServer = Awaited<ReturnType<typeof startServer>>;
// Construct ServerSetup using the real app request handler and explicit development policy. 
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Zhost coordinates server startup, local proxy routing, development client connections and related lifecycle operations. The main Zerux server command supplies its application runtime; a standalone host must supply its own handler and shutdown policy. It is not a general static-export pipeline.

Portless aliases, proxy state, supervised processes and protocol gateways have separate focused contracts. A configured alias does not prove public DNS/TLS or authenticate a visitor. Shared state directories must be protected from untrusted writers, and process markers/health checks are not cryptographic ownership proofs.

## Public types

```ts
import { startServer } from 'zhost';
type Inputs = Parameters<typeof startServer>;
type Result = Awaited<ReturnType<typeof startServer>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

Treat established WebSocket lifetimes separately from upstream handshake timeouts. Validate forwarded authority and do not trust arbitrary forwarding headers from an external client. The local development proxy has explicit limitations; production hosting needs its own authentication/network boundary and operational validation. Test stale process markers, interrupted state updates, route conflicts, child exit and shutdown, rather than force-killing an assumed PID.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### SupervisorOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `env` | `NodeJS.ProcessEnv` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `cwd` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `port` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `readyTimeoutMs` | `number` | No | Readiness deadline for a TCP listener, milliseconds; ignored if port is unset. |
| `shutdownTimeoutMs` | `number` | No | Deadline to give the child for graceful termination before SIGKILL. |
| `onExit` | `(result: ProcessExit) => void` | No | Called exactly once when the child exits or fails to spawn. |
| `onSpawn` | `(child: ChildProcess) => void` | No | Called immediately after spawn, before readiness, to persist child identity. |
| `stdio` | `'inherit' \| 'ignore' \| 'pipe'` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `forwardSignals` | `boolean` | No | Install SIGINT/SIGTERM forwarding from this process (default true). |
| `health` | `HealthCheckOptions` | No | Use an HTTP endpoint for readiness instead of only testing an open TCP port. |

### ProxyServerOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `cache` | `import("./proxy-cache.js").ProxyCacheOptions` | No | Opt-in reverse-proxy cache; caches only explicit public GET representations. |
| `compression` | `import("./proxy-compression.js").ProxyCompressionOptions` | No | Enable transparent streaming compression of eligible unencoded upstream responses. |
| `protocols` | `import("../protocols/gateway.js").ProtocolGateway` | No | Optional application protocols registered at startup. |
| `http3Terminator` | `import("../protocols/transport.js").Http3Terminator` | No | Advertise external HTTP/3+QUIC termination only if actually configured. |
| `limits` | `import('./proxy-admission.js').ProxyAdmissionOptions` | No | Optional admission limits for HTTP forwarding (WebSocket upgrades are separate). |
| `getRoutes` | `() => RouteInfo[]` | Yes | Called on each request to get the current route table. |
| `backendHealth` | `import("./backend-pool.js").BackendHealthOptions` | No | Optional active checks and passive failure isolation for backend pools. |
| `proxyPort` | `number` | Yes | The port the proxy is listening on (used to build correct URLs). |
| `tld` | `string` | No | TLD suffix used for hostnames (default: "localhost"). |
| `onError` | `(message: string) => void` | No | Optional error logger; defaults to console.error. |
| `allowPlainHttp` | `boolean` | No | Explicit compatibility switch for mixed HTTP/TLS on the same port. Disabled by default to prevent accidental plaintext transport. |
| `tls` | `{ cert: Buffer; key: Buffer; /** SNI callback for per-hostname certificate selection. */ SNICallback?: ( servername: string, cb: (err: Error \| null, ctx?: import("node:tls").SecureContext) => void ) => void; }` | No | When provided, enables HTTP/2 over TLS (HTTPS). |

### HealthCheckOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | A relative, origin-form HTTP path; omit for a TCP connection probe. |
| `timeoutMs` | `number` | No | Per-probe timeout in milliseconds. |
| `minStatus` | `number` | No | HTTP status range considered healthy, inclusive. Defaults to 200–299. |
| `maxStatus` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### ManagedAppOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `restartPolicy` | `RestartPolicy` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxRestarts` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `restartWindowMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `restartDelayMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxRestartDelayMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `healthIntervalMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `unhealthyThreshold` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `onReady` | `(process: SupervisedProcess) => void \| (() => void) \| Promise<void \| (() => void)>` | No | Publish the route after readiness; return its cleanup closure. |
| `onRestart` | `(attempt: number, delayMs: number, reason: ProcessExit) => void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `onStatus` | `StatusListener` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### BackendHealthOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `intervalMs` | `number` | No | Enables background probes; omit to use passive upstream errors only. |
| `failureThreshold` | `number` | No | Number of successive active probe failures before isolation (default 2). |
| `cooldownMs` | `number` | No | Passive failures are isolated for this long (default 5000ms). |
| `probe` | `HealthCheckOptions` | No | Optional HTTP health endpoint; otherwise probes TCP on loopback. |
| `stateDir` | `string` | No | Optional private state directory for restoring recent failure isolation after proxy restarts. |
| `stateMaxAgeMs` | `number` | No | Reject stored circuit-breaker state older than this (default 60 seconds). |
| `persistDebounceMs` | `number` | No | Coalesce checkpoint writes; never write synchronously per HTTP request (default 250ms). |

### HandoverOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `health` | `HealthCheckOptions` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `requireAll` | `boolean` | No | Require every target to pass the probe (default true). |

### RollingAppOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `onSpawn` | `(child: ChildProcess, port: number) => void` | No | Record each detached generation as soon as it spawns (before readiness). |
| `onLease` | `(leaseId: string) => void` | No | Persist the initial route lease before returning a published controller. |
| `store` | `RouteStore` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `hostname` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `ports` | `readonly number[]` | Yes | Two or more private, distinct loopback ports. Each child receives PORT. |
| `connections` | `Pick<BackendConnections, 'waitForIdle'>` | Yes | Backend connection tracker of the actual proxy serving this hostname. |
| `drainTimeoutMs` | `number` | No | Maximum time to let old HTTP requests and WebSockets finish after cutover. |
| `preCutoverChecks` | `number` | No | Number of independent health checks required before publishing a replacement. |
| `verificationChecks` | `number` | No | Number of post-cutover health probes before retiring the old process. |
| `verificationIntervalMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `force` | `boolean` | No | Explicitly replace an existing registration; disabled by default. |
| `onStatus` | `(status: Readonly<RollingStatus>) => void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |

### ReconciliationOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `dryRun` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `waitMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxRecords` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### InstanceFleetOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `store` | `RouteStore` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `hostname` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `ports` | `readonly number[]` | Yes | At least replicas + 1 distinct ports, to allow a ready-before-cutover spare. |
| `replicas` | `number` | Yes | 2–16 processes; at least one spare port is required. |
| `connections` | `Pick<BackendConnections, 'waitForIdle'>` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `healthIntervalMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `unhealthyThreshold` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxReplacements` | `number` | No | Maximum attempted replacements during restartWindowMs (0 disables recovery). |
| `restartWindowMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `replacementDelayMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxReplacementDelayMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `drainTimeoutMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `force` | `boolean` | No | Permit explicit replacement of an existing route owned by someone else. |
| `onSpawn` | `(child: ChildProcess, port: number) => void` | No | Persist each generation immediately after spawn, before health readiness. |
| `onLease` | `(leaseId: string) => void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `onStatus` | `(status: Readonly<FleetStatus>) => void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `restoredAttempts` | `readonly number[]` | No | Retry timestamps restored from a private checkpoint; bounded by current policy. |
| `onBudgetAttempt` | `(attempts: readonly number[]) => void` | No | Synchronous durable checkpoint callback, invoked before every replacement. |

### AutoscaleConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `metric` | `AutoscaleMetric` | No | rps: incoming requests per replica; cpu: one-core CPU %; memory: mean RSS MiB. |
| `scaleUpThreshold` | `number` | No | Required for CPU and memory modes. Overrides RPS thresholds. |
| `scaleDownThreshold` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxErrorRate` | `number` | No | Optional safeguards: only allow downscaling with valid healthy proxy telemetry. |
| `maxP95LatencyMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `enabled` | `boolean` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `minReplicas` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxReplicas` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `scaleUpRps` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `scaleDownRps` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `cooldownMs` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `consecutiveSamples` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `sampleIntervalMs` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `windowMs` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |

### LiveFleetHealthOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `maxErrorRate` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxP95LatencyMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxMetricAgeMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### ProxyAdmissionOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `ratePerSecond` | `number` | No | Sustained new requests per second for each direct client IP. |
| `burst` | `number` | No | Maximum burst per client; defaults to ratePerSecond. |
| `maxActiveRequests` | `number` | No | Maximum number of upstream HTTP requests globally in flight. |
| `maxBodyBytes` | `number` | No | Streaming request body size limit. Also checked against Content-Length. |

## Application-owned protocol adapters

Import `createTransportRegistry`, `createHttpTransportAdapter`,
`createWebSocketTransportAdapter`, `createProtocolGateway` and
`transportCapabilityMatrix` from `zhost/protocols`. Register only trusted adapter
factories; unknown transport names fail without package discovery. Registration
is inert, startup checks readiness, and failure rolls back partial resources in
reverse order. Numeric-IP binds reject duplicate fixed ports before startup;
port zero is supported for disposable listeners.

The HTTP adapter owns its gateway and requires explicit authorization, including
loopback. Gateway `authorizeEndpoint` adds per-path policy; method/tool handlers
still own tenant and operation authorization. Forwarding headers are not proof
of identity. WebSocket upgrades require their own authorization and explicit
browser origin allowances. Message sizes, work concurrency and cooperative
signals are bounded; a disconnected handler retains capacity until it settles.
Stop closes admission, signals work, closes streams/sockets, then drains actual
pending work. Uncooperative JavaScript is not forcibly cancelled.

The runtime matrix distinguishes native HTTP/WS/SSE/JSON-RPC from JSON-only
Connect/tRPC and stateless MCP core subsets. Existing gRPC support forwards
HTTP/2 frames to an upstream; there is no native gRPC service adapter. QUIC and
WebTransport require explicitly configured external implementations. Generic SSE
is not MCP resumable Streamable HTTP. The package README includes a runnable
public-import factory and the detailed limits/authentication matrix.

## Proxy overload and bounded drain

Use `createProxyServer({ getRoutes, proxyPort, limits })` with explicit workload
budgets. Optional `maxConnections` caps TCP sockets, `maxActivePerClient` caps
concurrent work per direct socket peer, and `maxActiveStreams` caps upgraded
WebSockets within the existing global `maxActiveRequests` ceiling. HTTP/SSE and
HTTP/2 requests share the global ceiling. Forwarded headers cannot change peer
identity, and a shared front proxy groups callers unless the owning application
applies a separate authenticated identity policy. Limits are process-local;
distributed rate accounting remains the security package's atomic-store contract.

`proxy.getAdmissionStatus()` exposes fixed counters without peer/URL labels.
Capacity rejects with 503; configured rate exhaustion rejects with 429. There is
no unbounded queue or automatic replay. TCP overload can close a connection before
HTTP exists. The package README contains a public-import listener factory.

Piping preserves upload/download backpressure; downstream disconnect destroys
identity and compressed response sources. Partially delivered POSTs are never
rerouted to another backend. Existing cache privacy, health selection, rolling
replacement and restart budgets remain authoritative. Drain accepts integer
0–300000ms deadlines and closes remaining sockets after waiting; it does not prove
rollback of an upstream operation. Focused loopback workloads test overload and
cleanup, without claiming a production performance gain.

## Private local state and event streams

Development `startServer` consumers can set `dev.watchIgnoredPaths` to validated
relative directories. `createDevelopmentWatchIgnore` snapshots the list before
watch traversal, so one application’s private data does not trigger source reloads
or change another subscriber’s configuration. Absolute/traversal paths reject.

For authenticated events, provide `events: new SseHub({privateCache:true})` to
`createProtocolGateway`. This emits `private, no-store, no-transform`; the legacy
cache policy remains the default. Hosts still own finite SSE connection lifetimes,
which are distinct from the gateway dispatch deadline.
