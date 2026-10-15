> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. All current versions follow the `0.0.1-alpha.x` pattern.

# zsrv


The core server orchestration engine for **ZeruxJS**. `zsrv` manages the lifecycle of both the application server and the development environment, providing a seamless "zero-config" experience.

## Features

- **Dual Server Management**: Starts and manages your application server alongside a dedicated developer tools server.
- **Hot-Reloading**: Integrated with `zwatch` for intelligent, fast restarts on file changes.
- **Zero-Port Management**: Automatically finds available ports for your services to avoid "Address in Use" errors.
- **Portless Proxies**: Support for local domain aliases (e.g., `my-app.localhost`) for a production-like local development experience.
- **WebSocket Gateway**: Built-in WS server for real-time communication between the framework and devtools.

## Usage

### Starting a Server

```typescript
import { startServer } from 'zsrv';

await startServer({
    app: {
        name: 'my-app',
        func: (req, res) => {
            res.end('Hello from Zerux!');
        }
    },
    dev: {
        port: 4000,
        watchFunc: async (file) => {
            console.log('Reloading due to change in:', file);
        }
    }
});
```

## Integrations

`zsrv` acts as the glue between several core components:
- **`zwatch`**: For monitoring source changes.
- **`z-dev`**: For devtools registration and dashboard management.
- **`ws`**: For the real-time event pipeline.
- **`portless`**: For internal local-domain routing.

## Development Mode

When running in development mode (`details.dev` provided), `zsrv` will:
1. Register the application with the shared dev server.
2. Inject the development client into all HTML responses.
3. Establish a WebSocket connection for hot updates.
4. Set up local domain aliases if supported.

---

<p align="center">
  The engine powering ZeruxJS Applications.
</p>


## Proxy request hardening (Section 7)

The portless proxy now validates Host / HTTP/2 authority before routing, handles IPv6 authorities, and prefers the longest matching registered suffix. Untrusted `Forwarded` and `X-Forwarded-*` input is discarded; the proxy reconstructs forwarding headers from the socket and requested authority. Malformed hop counts are rejected, and upstream HTTP and WebSocket handshake requests have a 30-second socket timeout.

Run focused regression tests after building: `node --test test/request-security.test.mjs`. This local development proxy is **not** a substitute for an authenticated public reverse proxy.

## Proxy lifecycle and WebSocket behavior

The portless proxy supports HTTP/1.1, HTTP/2 over TLS, and HTTP/1.1 WebSocket upgrades. Upgrade handshake bytes are forwarded only after the upstream returns `101 Switching Protocols`; both tunnel sockets are cleaned up on disconnect. A 30-second upstream handshake timeout applies before an upgrade, while an established WebSocket tunnel is not subject to this handshake timeout.

`portlessStop()` rejects malformed PID files and refuses to signal a process unless the expected proxy is responding. If the PID no longer exists, it removes the stale marker. **Note:** an HTTP health check does not establish cryptographic process identity; do not share the proxy state directory with untrusted users. The proxy remains intended for local development. A graceful-drain shutdown, stronger process ownership verification, and production hardening remain future work.

Focused regression tests are in `test/websocket-proxy.test.mjs` and `test/lifecycle.test.mjs`.


### Atomic proxy state and recovery (Section 16)

`zsrv` now writes `proxy.state.json` as the **last, atomic commit record**
containing the port, TLS flag, TLD and verified process marker. The existing
`proxy.port`, `proxy.tls`, `proxy.tld` and `proxy.pid` files remain for older
consumers. Internal discovery reads the committed record as one snapshot instead
of combining independently updated files.

A `.proxy-startup-journal.json` left behind by an interrupted publication
causes state readers to fail closed with `PendingStartupTransactionError`.
The next coordinated startup recovers the journal under its directory lock,
subject to conflict and live-owner checks. Manual consumers can call
`recoverInterruptedStartup(stateDir)` **only while holding**
`withOperationLock(stateDir, ...)`.

Legacy installations without `proxy.state.json` are read using a verified
double snapshot until their next successful startup. Legacy reads cannot offer
the same atomic guarantee as a commit record; do not edit state files manually.
A malformed commit record or unresolved journal is not silently ignored.


## Safe route lifecycle and registry protection (Section 17)

Applications launched with `portlessRun()` now receive a unique route lease.
When the child command finishes, its cleanup only removes **that registration**;
if another app has replaced the hostname (including `--force` takeover), the
older app cannot delete the replacement. Explicit administrative `removeRoute()`
remains unconditional, and the original `addRoute()` API retains the legacy
on-disk route format.

For integrations that manage application processes themselves:

```ts
import { RouteStore } from 'zsrv';

const routes = new RouteStore('/path/to/your/proxy-state');
const lease = routes.registerRoute('myapp.localhost', 4400, process.pid);
try {
  // Serve requests while this registration is active.
} finally {
  lease.release(); // returns false if another owner replaced this route
}
```

The route registry rejects malformed, duplicated, oversized, or symlinked
`routes.json` files when making changes rather than silently overwriting them.
Reader APIs remain lenient for UI display. The route mutation lock stores an
OS-specific process identity: it will not steal a slow, active owner's lock
based on file age alone. Verified dead owners can be recovered. An ownerless,
malformed, or unverifiable lock requires manual inspection.

To run the route-focused regression tests after compiling the package:
`node --test test/routes.test.mjs test/route-leases.test.mjs`.

**Deployment note:** This continues to be a local-development proxy. Route
leases prevent accidental cleanup races; they do not provide user isolation,
authenticated registration, or a hardened internet-facing control plane.

## Application supervision and readiness (Section 18)

`zerux-server run` now launches application commands **without shell interpolation**,
checks for an already occupied application port, waits for a TCP listener on
`127.0.0.1`, and **only then** publishes the hostname route. If the process
crashes, fails to spawn, or misses its readiness deadline, no route is published
and the child is stopped/reaped. The parent forwards SIGINT/SIGTERM, sends them
to the entire spawned POSIX process group, waits up to a bounded timeout, and
uses SIGKILL if necessary. Route cleanup remains ownership-aware.

```bash
zerux-server proxy start --port 1355
zerux-server run --name web --app-port 4300 --ready-timeout 20000 -- npm run dev
zerux-server run --name api --shutdown-timeout 8000 -- node server.mjs
zerux-server web node server.mjs    # short named form
```

All **launcher flags precede the application command** (optionally separated by
`--`). Anything after the command is passed to the child verbatim, including
`--port`, `--name` and `--`. Use `--no-ready` only for long-running processes
without a TCP readiness endpoint; in this mode a route can be published before
the app is actually ready. When supplying `--app-port`, the port must be free.

For library integrations, `launchSupervisedCommand(argv, { port, onExit })`
returns a `SupervisedProcess` with `.completed`, `.running`, and asynchronous
`.stop()`. `spawnCommand` is retained as a compatibility wrapper, but new code
should use the supervisor API. On Windows, direct execution does not invoke a
shell; prefer executable programs or invoke scripts through `node` explicitly.

**Section 18 limitations:** Basic TCP readiness confirms a listener, not an HTTP health endpoint;
free-port discovery cannot eliminate races before the child binds. Child-process
group termination is strongest on POSIX; native Windows process-tree supervision
still needs its own integration suite. This tool is intended for local developer
applications, not untrusted multi-tenant process execution.

Focused checks after compilation: `node --test test/process-supervisor.test.mjs
test/cli-run-arguments.test.mjs test/app-supervision-integration.test.mjs`.

## HTTP health checks and bounded restart policies (Section 19)

When an application supplies an HTTP health endpoint, ZSRV can wait for a
successful status (HTTP 200–299) before publishing a route. Health requests are
GET requests to `127.0.0.1`, do not follow redirects, have bounded timeouts,
and discard response bodies. A failing runtime health check removes the route,
stops the unhealthy child, and optionally starts a new process.

```bash
zerux-server run --name api --app-port 4300 \
  --health-path /health --health-timeout 1000 \
  --health-interval 5000 --health-failures 3 \
  --restart on-failure --max-restarts 5 \
  --restart-delay 250 --restart-window 60000 \
  -- node server.mjs
```

`--restart` accepts `never` (default, preserves previous behavior),
`on-failure`, and `always`. Restarts have capped exponential delays. The
`--max-restarts` quota applies within the `--restart-window` time interval,
and failed restarts also count toward the budget. Once exhausted, the wrapper
exits with a failure. `--health-path` enables HTTP readiness and 10-second
runtime monitoring by default. `--health-interval` adjusts this cadence.
`--health-failures` is the number of consecutive failed probes before the
supervisor stops a running process. With no HTTP path, monitoring checks TCP
connectivity. A `--no-ready` application cannot enable health monitoring.

For library clients, use `launchManagedApplication(argv, { port, health,
restartPolicy, onReady })`. `onReady` may return a disposal function (such as
releasing a route lease). It is called after each successful readiness check;
the disposer is called on exit before any restart. The controller has
`.current`, `.running`, `.completed`, and `.stop()`. Additional exports include
`probeApplicationHealth()` and `validateManagedOptions()`.

**Production boundary:** Restart budgets and counters exist only in the
supervising process; restarts are sequential and not zero-downtime. HTTP probes
do not authenticate the application's content, and cannot replace production
load-balancer health checks. The supervisor is for trusted local applications,
not a privilege boundary for executing untrusted commands. Windows process tree
behavior and cross-process recovery still need native integration testing.

Regression suite (after building dependencies and `zsrv`):
`node --test test/*.test.mjs`.

## Runtime status and coordinated manual reload (Section 20)

Managed application state is now observable via `handle.status` and
`handle.subscribe(listener)`. Snapshots include lifecycle phase, child PID,
ready-generation number, automatic restart count, previous exit and timestamp.
Subscribe callbacks are isolated so a throwing observer cannot take down an app.

```ts
const app = await launchManagedApplication(['node', 'server.mjs'], {
  port: 4300,
  onReady: child => registerRouteForChild(child),
});
const unsubscribe = app.subscribe(status => console.log(status.phase));
await app.restart(); // sequential: remove old route, stop child, await readiness, publish new route
unsubscribe();
await app.stop();
```

Concurrent `.restart()` calls coalesce into one request and an explicit restart
**does not use the automatic failure budget**. A stopped app refuses manual
restart. Manual restarts are sequential, **not zero-downtime**; the route is
unpublished while its child restarts.

To enable a manual restart signal for a CLI-launched app on Linux/macOS:

```bash
zerux-server run --name api --app-port 4300 --reload-signal -- node server.mjs
# Send SIGUSR2 to the wrapper PID shown in `zerux-server status api`.
zerux-server status api
zerux-server status --json
```

`--reload-signal` is opt-in and is not installed on Windows. Only signal a
wrapper you own; the status command **never sends signals**. Status JSON lives
under a per-user `app-status-<uid>` folder inside the proxy state directory;
files are private (0600), atomically rewritten, and checked for malformed
content or symlinks. They do **not** contain CLI arguments, environment
variables, or credentials. `alive` requires verification of the wrapper's
process creation identity, not merely the PID. A `stale` result indicates
that the previous status cannot be verified as live; it is **not** a positive
application-health result. Historical terminal snapshots are retained for
troubleshooting, and may be removed manually from the private status folder.

This is local-machine observability, not a distributed control plane or an
authenticated remote management API. End-to-end Linux testing is included;
native macOS/Windows behavior requires additional platform verification.

## Multi-instance routing and safe traffic handovers (Section 21)

Route pools can distribute **new HTTP requests and WebSocket upgrades** across
up to 32 local application instances using smooth weighted round-robin. Legacy
single-port routes are unchanged. The proxy selects only loopback ports; it
never accepts remote backend addresses from route files.

```ts
import { RouteStore, handoverBackends, createProxyServer } from 'zsrv';

const routes = new RouteStore('/path/to/proxy-state');
const lease = routes.registerPoolRoute('api.localhost', [
  { port: 4300, weight: 3 },
  { port: 4301, weight: 1 },
], process.pid);

const server = createProxyServer({
  getRoutes: () => routes.loadRoutes(),
  proxyPort: 1355,
  backendHealth: {
    intervalMs: 5_000,
    failureThreshold: 2,
    cooldownMs: 5_000,
    probe: { path: '/health', timeoutMs: 800 },
  },
});

server.listen(1355);
console.log(server.backendPool.status());
await server.backendPool.checkNow(); // optional immediate health sweep

// Run the new instance first. Only commit after its health probe succeeds.
const committed = await handoverBackends(lease, [{ port: 4400 }], {
  health: { path: '/health', timeoutMs: 1_000 },
});
if (committed) {
  // New requests go to 4400. Keep old 4300/4301 processes alive until
  // their existing HTTP requests and WebSocket connections have drained.
}
// When finished: lease.release(); server.close();
```

- `RouteStore.registerPoolRoute()` saves validated weighted targets atomically
  and returns a lease. `lease.switchBackends()` swaps targets under the same
  route lock and fails safely if another process took over the hostname.
- `handoverBackends()` checks the *new* targets before committing; failed probes
  or invalid targets leave the currently published route unchanged.
- The proxy isolates failed upstream connections. With an active probe interval,
  isolated instances recover only after a successful check. Without an interval,
  passive failures recover after the configured cooldown. When all instances
  are unhealthy, new requests receive HTTP **503** rather than being routed to
  a known failed instance.
- `BackendPool.status()` exposes per-instance health and failure information.
  Background health probes are bounded to eight concurrent connections and
  cleaned up when the proxy listener closes.
- Manual handovers only switch **new** requests. They do not spawn new child
  servers, kill old ones, migrate existing WebSocket sessions, or guarantee
  uninterrupted availability when the old process is stopped too early. The
  deployment controller must manage the overlap and connection-drain period.
- This is still a local-development proxy. It is not an internet-facing load
  balancer, authenticated service mesh, or distributed routing coordinator.

After a package build, run `node --test test/backend-*.test.mjs` for the new
pool, handover, and WebSocket integration regression tests.

## Rolling application deployments (Section 22)

`launchRollingApplication` runs *overlapping* generations of the same loopback
application on different ports, tests the candidate's readiness, switches the
existing leased hostname atomically, and retires the previous child after its
in-flight proxy connections finish (or a configured drain deadline elapses).
It is an opt-in API; existing `zerux-server run` behavior is unchanged.

The **proxy and controller must share the same `BackendConnections` instance**.
This release does not provide cross-process drain coordination; do not use a
tracker from an unrelated proxy instance to claim uninterrupted deployments.

```ts
import { RouteStore, createProxyServer, launchRollingApplication } from 'zsrv';

const store = new RouteStore('./.local-proxy-state');
const proxy = createProxyServer({
  getRoutes: () => store.loadRoutes(),
  proxyPort: 4000,
});
proxy.listen(4000, '127.0.0.1');

const app = await launchRollingApplication(['node', 'server.mjs'], {
  store,
  hostname: 'api.localhost',
  ports: [4300, 4301],
  connections: proxy.backendConnections,
  health: { path: '/health', timeoutMs: 1_000 },
  readyTimeoutMs: 10_000,
  shutdownTimeoutMs: 5_000,
  drainTimeoutMs: 15_000,
  verificationChecks: 3,
  verificationIntervalMs: 200,
});

const result = await app.deploy(); // candidate starts BEFORE traffic switches
console.log(result); // { fromPort, toPort, generation, drained }

await app.stop(); // withdraw route, drain, then stop the child
await proxy.connectionTracker.drain({ timeoutMs: 10_000 });
```

The child server **must bind to `127.0.0.1:${process.env.PORT}`**. Ports must be
available, different, and exclusively owned by this deployment controller.
The controller passes the correct `PORT` to each child even if an existing
`env.PORT` was set. Health probes are loopback-only and do not follow redirects.

### Safety and limitations

- **Pre-publication failure:** failed process start, timeout, or failed initial
  health verification leaves the old route and process untouched.
- **Post-publication failure:** verification detects a failure and conditionally
  switches traffic back to the still-running old instance before stopping the
  candidate. If another process superseded the route lease, this controller
  cannot overwrite it during rollback.
- **Drain:** existing HTTP requests and upgraded WebSockets remain pinned to
  the old backend. `drained: false` means the deadline elapsed, so terminating
  the old process may interrupt remaining sessions.
- **Stop:** removes the route only if this controller still owns its lease;
  waits for current traffic and terminates the child. Repeated stops and
  concurrent deploy requests are coalesced.
- This is a **same-machine, same-process-proxy** orchestration API, not a
  distributed deployment system, persistent supervisor, or cross-process
  zero-downtime controller. It does not automatically roll back a deployment
  after the verification window has ended.

Focused validation: build `zsrv`, then run
`node --test test/rolling-app.test.mjs test/backend-*.test.mjs`.

## Rolling CLI & cross-process deployment control (Section 23)

The Section 22 rolling controller is now available from the CLI, with **real
proxy-side HTTP/WebSocket drain observations** even when the proxy and the
application wrapper are separate processes. Use an existing ZSRV proxy built
from this version or later; rolling launches deliberately refuse to claim
traffic has drained when they cannot reach its authenticated control endpoint.

```bash
zerux-server proxy start --port 1355
zerux-server rolling run --name api --ports 4300,4301 \
  --health-path /health --drain-timeout 15000 --verify-checks 2 \
  -- node server.mjs
# From a second terminal, under the same operating-system user:
zerux-server rolling deploy api
zerux-server rolling status api --json
zerux-server rolling history api --json
zerux-server rolling stop api
```

`rolling run` keeps a supervising process alive. Deploy starts a replacement on
the spare port, waits for health, switches the leased route, verifies health,
then asks the actual proxy to wait for outstanding HTTP requests and WebSocket
tunnels before stopping the old process. When the drain deadline expires,
`drained: false` is recorded and the old child is stopped. Failure before
cutover leaves the old route available; failure during the verification window
attempts a lease-checked rollback. Deployment commands are serialized by the
supervisor; multiple concurrent requests share the same in-flight deployment.

The CLI control endpoint listens **only** on IPv4 loopback with a random
256-bit bearer token. Its discovery descriptor and bounded deployment history
live in a private, same-user directory beneath the selected proxy state
directory. Descriptors require a verified process-start fingerprint. Requests
and responses are size-limited and time-limited; arbitrary command execution,
file access and unauthenticated process signaling are not exposed through RPC.
`rolling status` displays *last known* state and separately reports whether the
owning controller is online. History keeps up to 50 events per hostname, with
no application argv or environment secrets saved.

**Operational boundaries:** this is local, single-host orchestration for
trusted application commands, not a publicly exposed management API or a
cross-host control plane. Both proxy and rolling wrapper must be accessible to
the same OS user; a root-owned privileged proxy control is not exposed to
another user. Abrupt supervisor termination (for example `SIGKILL` or power
loss) cannot guarantee cleanup of detached application children; stale routes
are filtered by owner liveness and require inspection. Multi-file crash
consistency, distributed scheduling and external load-balancer draining are
not provided. Run `node --test test/rolling-cli-control.test.mjs` against fresh
compiled output for a separate-process smoke test.

### Recovering rolling applications after a hard crash (Section 24)

The rolling wrapper now records its own OS creation fingerprint and the
fingerprints/ports of **each spawned generation** in a private, atomically
replaced `app-controls-<uid>/*.generations.json` file. Recording happens before
readiness and the initial route lease is saved before launch returns. A normal
stop removes this recovery record only after the supervised children have
exited. A new `rolling run` automatically attempts recovery of an abandoned
record while holding the deployment operation lock.

```bash
# Inspect stale status (JSON includes recoveryRequired and orphanGenerations)
zerux-server rolling status api --json

# After an unexpected SIGKILL / controller crash, clean up verified children
zerux-server rolling recover api --dry-run --json
zerux-server rolling recover api --json

# Compact an offline app's audit trail
zerux-server rolling prune api --days 30 --max-events 20
```

Recovery is intentionally conservative: it will not stop a live wrapper, a
process with an unreadable creation fingerprint, or a different process that
has reused an old PID. Recorded route leases are released conditionally, so a
newer owner's route is never removed. Recovery uses process-group signals on
POSIX only when the original group leader can still be identified; if the
leader is already gone but grandchildren survive independently, operator
cleanup may still be needed. It is not a distributed process manager or an
unattended repair tool for other users' processes.

Deployment history now has a default 90-day retention window (in addition to
the existing 50-event maximum). `rolling prune` accepts 0–3650 days and 0–50
events, refuses to modify a live controller's history, and preserves the most
recent status. History is informational and is never a source of authority
for process termination. Cross-platform process identity behavior still needs
native Windows/macOS integration testing.


### Persistent backend health and multi-app reconciliation (Section 25)

ZSRV's built-in proxy now checkpoints recent backend circuit-breaker state in
`app-controls-<uid>/backend-health.json` using private atomic writes. Checkpoints
are bounded, coalesced (250 ms by default), and expire after 60 seconds. Routes
carry a registration lease/process signature: a new registration, different
backend pool, or process takeover **never inherits the previous route's
isolation state**. Late upstream responses from a replaced route cannot clear
or poison the new route's health status. Active health probes can rehabilitate
isolated backends. The standalone `createProxyServer()` API can opt into
checkpoints via `backendHealth.stateDir`; normal `portlessProxy()` configures a
private directory automatically.

```ts
import { BackendPool } from 'zsrv';

const pool = new BackendPool(() => routes, {
  intervalMs: 5_000,
  failureThreshold: 2,
  probe: { path: '/health' },
  stateDir: '/private/proxy/health-state', // must already exist and be owned
  stateMaxAgeMs: 60_000,
  persistDebounceMs: 250,
});
pool.syncCurrentRoutes();
console.log(pool.status());
pool.close();
```

The proxy also serves read-only per-backend status through its authenticated
local RPC (not over public HTTP):

```bash
zerux-server rolling backends api --json
```

Orphaned rolling controllers can be scanned and reconciled in one operation.
The scan is capped at 128 private records by default; it refuses live owners,
invalid records, and processes whose identity cannot be verified. One corrupt
record does not hide the status of other applications:

```bash
zerux-server rolling reconcile --dry-run --json
zerux-server rolling reconcile --json
```

**Safety boundaries:** Reconciliation is an explicit operator command, not a
periodic background daemon; `rolling run` still automatically recovers its own
abandoned controller before startup. Circuit-breaker checkpoints describe
recent failures and are not durable application or process authority.
No cross-host storage, distributed failover, or persistent metrics database is
provided. State files must remain private to the proxy's operating-system user.

## Health-aware multi-instance process fleets (Section 26)

`launchInstanceFleet()` manages a desired set of local application processes and
publishes their backend ports through a conditional route lease. It detects
crashes and health failures, isolates unhealthy instances, launches verified
replacements using a bounded restart budget, and drains retired HTTP/WebSocket
connections before terminating the old generation. This complements the
single-instance `launchRollingApplication()` API.

```ts
import { launchInstanceFleet, RouteStore } from 'zsrv';

const fleet = await launchInstanceFleet(['node', 'server.mjs'], {
  store: new RouteStore('/path/to/state'),
  hostname: 'api.localhost',
  ports: [4300, 4301, 4302], // two running instances plus a warm spare port
  replicas: 2,
  connections: proxy.backendConnections, // must be the *serving* proxy's tracker
  health: { path: '/health' },
  healthIntervalMs: 2000,
  unhealthyThreshold: 2,
  maxReplacements: 5,
  restartWindowMs: 60_000,
});

console.log(fleet.status);
await fleet.reconcile(); // optional immediate health check and repair
await fleet.stop();
```

The fleet API is exported from the root package. Create the proxy using your
existing ZSRV proxy setup; do not create a separate empty tracker for draining.
`fleet.stop()` is required during application shutdown. Restart budgets are
currently in memory and the API does not perform cross-process ownership
recovery automatically. See `SECTION_26_MULTI_INSTANCE_SUPERVISION.md` in the
project root for operational details and limitations.

## Persistent multi-instance fleet CLI (Section 27)

`zerux-server fleet` connects the Section 26 multi-instance supervisor to the
real proxy's private authenticated control endpoint. Unlike launching the API
from another process, the CLI uses the proxy's **actual** connection tracker
for draining; it refuses to launch when that control is unavailable.

```bash
# The proxy must be running or startable by zerux-server.
zerux-server fleet run \
  --name api --ports 4300,4301,4302 --replicas 2 \
  --health-path /health --health-interval 2000 \
  --unhealthy-threshold 2 --max-replacements 5 \
  --restart-window 60000 --restart-delay 100 \
  --max-restart-delay 5000 --drain-timeout 10000 \
  -- node server.mjs

# In another terminal:
zerux-server fleet status api --json
zerux-server fleet backends api --json
zerux-server fleet reconcile api --json
zerux-server fleet stop api --json

# If a supervisor is forcibly killed, preview and perform verified cleanup:
zerux-server fleet recover api --dry-run --json
zerux-server fleet recover api --json

# To replace a fleet's command, port or replica policy, after stopping and
# recovering any orphaned generations, explicitly discard the old checkpoint:
zerux-server fleet reset api
```

A strict `--` separator protects application arguments from being interpreted
as supervisor flags. The `run` command accepts 2–16 replicas and at least one
spare port. Application children bind loopback `PORT`; an optional HTTP health
path must be an origin-form relative path. A successful initial health check
is mandatory before the route is published.

The controller records PID + OS process-start fingerprints for every detached
generation **before readiness**, and saves its route lease before returning a
running supervisor. Live operation uses a local authenticated loopback control
socket with private 0600 descriptors. CLI status displays the last persisted
checkpoint and distinguishes online from offline or recovery-required state.

The restart-budget checkpoint is a 0600 JSON file under the owner's private
`app-controls-<uid>` directory. It stores retry timestamps *before* each
attempt. A supervisor restarted with the same configuration inherits the
remaining sliding-window budget, preventing hard crashes from resetting the
attempt limit. Configuration fingerprints intentionally reject changed commands,
ports, replica counts and restart windows unless the operator explicitly resets
the checkpoint with `fleet reset` while offline and fully recovered.

**Operational limits:** This manages local processes, not distributed replicas.
The proxy must remain accessible via authenticated local control. Recovery
refuses live or unverifiable owners and cannot always discover orphaned process
grandchildren after their original leader disappears. Status is a last-known
snapshot if its writer encounters a disk error; the restart-budget persistence
hook fails closed rather than silently allowing a new replacement. A health
failure can temporarily reduce serving capacity. Full native Windows/macOS
integration and long-duration deployment tests are still required.

## Dynamic fleet capacity and request-rate autoscaling (Section 28)

A fleet can now change its desired replica count while running. Each new replica
is started and health-checked **before** its port is atomically added to the
route lease. Scale-down removes the selected port from new traffic first, waits
for in-flight HTTP and WebSocket connections (up to the configured drain
limit), then terminates the child. The fleet keeps at least one spare port.

```sh
zerux-server fleet run --name api --ports 4300,4301,4302,4303,4304 \
  --replicas 2 --health-path /health -- node app.mjs

zerux-server fleet scale api 3 --json
zerux-server fleet metrics api --json
zerux-server fleet doctor api --json
zerux-server fleet history api --json
```

### Automatic capacity policy

```sh
zerux-server fleet run --name api \
  --ports 4300,4301,4302,4303,4304 --replicas 2 \
  --health-path /health --autoscale --min-replicas 2 --max-replicas 4 \
  --scale-up-rps 25 --scale-down-rps 5 --scale-samples 3 \
  --scale-interval 5000 --scale-window 30000 --scale-cooldown 30000 \
  -- node app.mjs

zerux-server fleet autoscale api pause
zerux-server fleet autoscale api resume
```

Autoscaling uses **requests per second per active healthy replica**, observed
by the *real proxy* rather than the fleet supervisor. The policy scales one
replica per decision, requires consecutive samples, uses different scale-up and
scale-down thresholds, and honors a cooldown. A manual `fleet scale` pauses
autoscaling until explicitly resumed. A failed or stale metrics request cannot
trigger a downscale; degraded fleets do not automatically downscale.

Only 2–16 replicas are supported, and the reserved port pool must contain
at least one extra port beyond the configured maximum. Scale operations are
serialized with health reconciliation. A partial scale-up error retains
healthy serving instances; reconciliation repairs missing desired capacity
within the durable replacement budget.

### Persisted state and troubleshooting

Fleet checkpoints retain desired replica count, restart attempt timestamps,
autoscaling pause state, and cooldown timestamp. Restart with the **same**
command, ports, baseline replica count, and scaling policy to restore state.
Configuration changes require deliberate checkpoint reset after verifying
all old generations are stopped. Private event history retains up to 100
lifecycle events for 30 days; `fleet doctor` reports offline owners, capacity
shortfalls, route mismatch and stale checkpoints without changing processes.

**Operational caveats:** metrics are a bounded in-memory rolling window and
reset when the proxy restarts; they are not an observability database. A drain
limit can disconnect long-lived WebSockets. Scaling is local-process
orchestration, not cluster autoscaling; it does not provision machines, limit
CPU/memory usage, or distribute control across hosts. The OS and full app
integration still need validation in your deployment environment.

## Fleet observability and resource autoscaling (Section 29)

The fleet controller supports request-rate scaling (default) and Linux child-process
resource scaling. Samples are based on **the serving child processes**, not the
ZSRV controller process. Memory is the mean resident set size (RSS) in MiB per
replica; CPU usage is a percentage of **one CPU core** per replica (and may
exceed 100% for multithreaded work).

```sh
# CPU-based scaling, 2–4 active workers, plus a spare slot
zerux-server fleet run --name api --ports 4300,4301,4302,4303,4304 \
  --replicas 2 --autoscale --min-replicas 2 --max-replicas 4 \
  --scale-mode cpu --scale-up 75 --scale-down 25 \
  --scale-samples 3 --scale-cooldown 30000 \
  --scale-max-error-rate 0.05 --scale-max-p95 1500 \
  --health-path /health -- node app.mjs

# Memory-based scaling (MiB per live child)
zerux-server fleet run --name worker --ports 4400,4401,4402,4403 \
  --replicas 2 --autoscale --min-replicas 2 --max-replicas 3 \
  --scale-mode memory --scale-up 768 --scale-down 256 \
  -- node worker.mjs

# Service-level and resource observations
zerux-server fleet metrics api --json
zerux-server fleet metrics api --prometheus
zerux-server fleet doctor api --live --json
zerux-server fleet samples api --json
```

Existing request-rate flags (`--scale-up-rps`, `--scale-down-rps`) continue to
work. For resource modes, provide `--scale-up` and `--scale-down`. On non-Linux
platforms, resource autoscaling fails at startup instead of emitting unsafe
zero-load observations. The first CPU sample warms up its counter baseline;
a replaced PID must also warm up before new readings can be trusted.

**Scale-down safeguards:** `--scale-max-error-rate` and `--scale-max-p95` require
recent, authenticated proxy telemetry. A response-error ratio or p95 latency
above the configured limit prevents a scale-down decision; malformed, missing,
or stale telemetry blocks sampling. WebSocket connection lifetimes are excluded
from HTTP latency measurements. Recent HTTP completion history is bounded per
backend, so p95 is an approximate percentile of the retained sample rather
than a full histogram. No server metrics endpoint is publicly exposed.

Metrics exports are read through the existing authenticated local CLI control.
The `--prometheus` format prints text to stdout for collection by an operator;
it does **not** enable an unauthenticated HTTP endpoint. Private autoscaling
observation history is retained for 24 hours, capped at 240 points, and written
no more frequently than every 30 seconds. State files remain owner-only and
symlinked or malformed files are rejected. A `fleet doctor --live` inspection
cross-checks real backend readiness, error rate and p95 latency; the original
offline `fleet doctor` continues to inspect durable state and ownership.

For production, always benchmark target workload, tune scale thresholds and
cooldowns, and test failures under sustained load. Linux `/proc` resource
monitoring is local-only, uses the operating system's conventional 100 Hz user
clock, and does not measure subprocess descendants or container-wide memory.
The metrics and scaling policy do not replace a distributed orchestrator,
container limits, autoscaler SLOs, or a monitoring time-series database.

## Production consolidation: proxy, TLS, development server and resource limits

The management proxy now **listens on `127.0.0.1` by default**, not every
network interface. This is important because registered development apps and
fleet controls are meant to be local. To deliberately expose the proxy on a
network, specify an address explicitly:

```sh
zerux-server proxy start --port 1355 --bind 0.0.0.0
```

Only numeric IP addresses and `localhost` are accepted for `--bind`. Binding
publicly is an operator decision: the proxy is not an Internet-facing ingress
controller with authentication, rate limiting, WAF, or tenant isolation.

When `--https` is selected, the proxy **rejects plaintext HTTP** on the TLS
port by default with HTTP 426. Library consumers that explicitly need the
legacy dual-protocol port can pass `allowPlainHttp: true` to
`createProxyServer`. Certificates generated by the local CA no longer cause
an automatic machine-wide trust-store update. Use the **explicit**
`zerux-server trust` command after inspecting the CA and understanding its
implications. Dynamic TLS certificates are restricted to the configured local
TLD namespace and exact requested hostnames. Cached contexts and concurrent
certificate generation are bounded.

HTTP request and response headers now filter both fixed hop-by-hop headers
and the additional fields nominated by `Connection`; WebSocket handshakes
retain the necessary upgrade headers. Managed `/etc/hosts` entries are
validated and malformed managed blocks fail closed.

The dev-server implementation is now under `src/dev/`, with `src/index.ts`
remaining the package's public export surface. Dev HTML injection is limited
to 2 MiB of identity-encoded HTML; larger and compressed responses are
forwarded without injection rather than buffered unboundedly. The dev app
listens on loopback, filesystem watch reloads are serialized, and shutdown
releases its watcher without stopping unrelated applications' proxy.

For Linux fleets, `readLinuxContainerLimits()` reports cgroup v1/v2 CPU quota
and memory limit/usage where available. These container-wide figures are
**diagnostics**, not an invented per-child memory/CPU reading; missing and
unlimited constraints are represented as `null`.

### Compatibility notes

- A proxy intentionally accessed from another device now needs `--bind`.
- Mixed HTTP and HTTPS on the same port now requires `allowPlainHttp: true`.
- Trusting a new local certificate authority is now an explicit operation.
- `startServer` no longer stops a potentially shared proxy when its dev app exits.
- HTTP responses whose bodies are too large or encoded are no longer altered to inject the dev client.

### Verification and limits

The focused TypeScript check and regression tests exercise request filtering,
loopback binding validation, local certificates, hosts blocks, HTTPS downgrade
handling, dev HTML buffering, cgroup parsing, and the established routing,
WebSocket, and fleet APIs. A full monorepo install, native macOS/Windows test,
external exposure penetration test, and production load test are still required
before calling a deployment production-certified.

### Optional proxy request limits

Configure limits before binding; duplicate flags, partial numbers, and invalid
ranges are rejected:

```sh
zerux-server proxy start --port 1355 \
  --rate 100 --burst 200 --max-active 500 --max-body 67108864
```

Equivalent library options are available through `createProxyServer({limits})`.
`--rate` is a per-direct-IP sustained request rate, `--burst` is its token-bucket
capacity, `--max-active` is a global count of concurrent HTTP and upgraded
connections, and `--max-body` is a streamed request-body byte limit. Limits
are opt-in for compatibility. They are local process protections, **not**
a substitute for an authenticated public reverse proxy or distributed DDoS
protection. Size violations are rejected with HTTP 413, rate violations with
429, and concurrency overload with 503. Backend code may have seen a partial
chunked request before a streaming size violation is detected.

## Integrated protocol gateway (Section 31)

**MCP has moved into `zsrv`**: import `createMcpServer`, `ToolRegistry`,
`ResourceRegistry` and `createProtocolGateway` from `zsrv`. The old
`@zeruxjs/mcp` package has been removed. MCP implements the stateless core
(tool/resource calls, initialize, ping) over Streamable HTTP JSON POST.
It is **not** a complete implementation of the MCP 2026-07-28 protocol
(subscriptions, elicitation, sampling, full metadata validation, etc.).

```ts
import {
  createMcpServer, createProtocolGateway, createProxyServer,
} from 'zsrv';

const mcp = createMcpServer({ name: 'my-app', version: '1.0.0' });
mcp.tools.register({
  name: 'current_load',
  handler: () => proxy.getLoadStatus(),
});
const protocols = createProtocolGateway({ mcp });
protocols.rpc.register('app.ping', () => ({ ok: true }));
protocols.connect.register('app.v1.StatusService', 'Get', () => ({ ready: true }));
protocols.trpc.register('status.read', () => ({ ready: true }));
protocols.events.publish('ready', { message: 'online' });

const proxy = createProxyServer({
  proxyPort: 1355,
  getRoutes: () => [{ hostname: 'my-app.localhost', port: 4400 }],
  protocols,
});
proxy.listen(1355, '127.0.0.1');
console.log(proxy.getLoadStatus()); // includes all HTTP status families
console.log(proxy.getApplicationLoad('my-app.localhost'));
```

Protocol endpoints are `POST /mcp`, `POST /rpc`,
`POST /<package.Service>/<Method>` for **Connect unary JSON**, `POST /trpc/<procedure>`
for the basic tRPC-compatible procedure bridge, and `GET /events` for SSE.
The Connect and tRPC bridges are lightweight JSON subsets: use their official
framework adapters for full schema, codecs, bidirectional streams and client
compatibility. gRPC-over-HTTP/2 requests with `application/grpc` are forwarded
as streaming HTTP/2 to an h2c backend; other routes continue to use HTTP/1.1.
Keep these endpoints behind authentication if accessible outside a trusted local
machine. The gateway by default allows only loopback connections, validates
browser Origin, and caps request bodies. Supply `authorize(req)` for explicit
remote access control. Tool executions must also implement their own permission
checks before accessing sensitive data.

### HTTP versions and QUIC

| Version/transport | Support |
| --- | --- |
| HTTP/1.0, HTTP/1.1 | Native Node HTTP server |
| HTTPS and HTTP/2 | TLS ALPN negotiation, HTTP/1.1 fallback |
| HTTP/3 (QUIC) | **External HTTP/3 terminator required**; optional validated `Alt-Svc` advertising |
| WebTransport | **External QUIC terminator required**; `WebTransportRouter` lets a terminator attach real sessions |
| WebSocket | HTTP/1.1 upgrade proxy |
| SSE | Native streamed HTTP event source |

Node 22's HTTP modules do not provide native HTTP/3 or WebTransport server APIs.
Do not configure `http3Terminator` unless a real QUIC listener is running at
that port with valid TLS certificates. For example:

```ts
const proxy = createProxyServer({
  proxyPort: 1355,
  getRoutes: () => routes,
  tls: { key, cert },
  http3Terminator: { enabled: true, port: 443, webTransport: true },
});
console.log(proxy.capabilities);
```

`http3Terminator` only publishes an `Alt-Svc` hint and capability metadata;
actual QUIC termination, HTTP/3 forwarding and WebTransport negotiation **must**
be provided by the external server. HTTP/2 ALPN happens automatically on the
native TLS server. Plain HTTP is not silently upgraded to TLS or QUIC.

`proxy.getLoadStatus(windowMs?)` reports in-flight HTTP requests, request
arrival totals, protocol versions, response counts by status code and status
family (1xx–5xx), per-route latency and RPS, plus requests handled outside
registered application routes. `proxy.backendConnections.metrics()` continues
to provide backend-specific fleet telemetry. Aborted requests use a synthetic
`499` in the load API, not an HTTP status sent to the client.

Connect JSON streaming can be registered with
`protocols.connectStream.register('app.v1.Events', 'Watch', async function* (messages) { ... })`.
It uses Connect's five-byte framed `application/connect+json` responses,
including the end-stream envelope. Streaming is size bounded and does not
support compression or Protobuf encoding in this built-in lightweight adapter.

For application-specific load and Linux resource usage, call
`await proxy.getApplicationUsage('my-app.localhost', [workerPid])`. This returns
per-route HTTP response family counts, active upstream connections and optional
CPU/memory samples for **explicit** worker PIDs (first CPU sample is a warmup).
If you omit the PIDs, resource monitoring is not requested; unverified process
identities never produce fabricated zero-usage values.

### Content compression (Brotli / gzip / deflate / Zstandard)

ZSRV can compress eligible, **unencoded** HTTP responses while streaming the
body to the client. Negotiation observes `Accept-Encoding` quality weights,
explicit refusals, and `identity`; `Content-Encoding` and `Vary:
Accept-Encoding` describe the selected representation. Brotli, gzip and
deflate use built-in Node.js encoders; `zstd` is enabled only on runtimes with
native Zstandard support (experimental in Node 22.15+/23.8+).

```sh
# Compression is enabled by default for eligible proxy responses
zerux-server proxy start --port 1355 --compress \
  --compression-min 1024 --compression-encodings br,zstd,gzip,deflate

# Delegate compression entirely to an Nginx front proxy or upstream app
zerux-server proxy start --port 1355 --no-compress
```

Programmatically:

```ts
const server = createProxyServer({
  getRoutes,
  proxyPort: 1355,
  compression: { enabled: true, minBytes: 1024, encodings: ['br','zstd','gzip','deflate'] },
});
```

**Reverse-proxy safety:** Existing upstream `Content-Encoding` is passed
through unchanged (not decompressed or compressed a second time). Nginx can
also compress responses at the outer boundary; it should respect the
pre-existing `Content-Encoding` and forward `Accept-Encoding` correctly. Use
`--no-compress` to make Nginx the sole compression layer. The proxy strips
invalidated body-specific headers (`Content-Length`, strong ETags, digests,
range support) when compressing. It does not compress SSE, ranges/206, HEAD,
no-body statuses, or `Cache-Control: no-transform` responses. Upstream SSE
responses receive `X-Accel-Buffering: no` and `no-transform` to help protect
real-time delivery through Nginx. Already compressed but **unacceptable**
upstream representations return HTTP 406 instead of emitting content the
client cannot decode; configure upstreams to honor the original
`Accept-Encoding` for best compatibility. Unknown-length compressible streams
may still be compressed even if ultimately smaller than `minBytes`.

**Security:** Direct protocol gateway endpoints are private by default. If
Nginx or another front proxy forwards MCP/RPC to ZSRV, explicitly configure
`authorize(req)`; merely connecting from 127.0.0.1 is not a substitute for
user authentication. ZSRV denies forwarded requests without such an
allow-rule when recognized forwarding headers are present.

### Forwarded-response compression

HTTP responses can use streaming Brotli, gzip, deflate and Zstandard (where
Node exposes a Zstandard encoder), negotiated with `Accept-Encoding`.
Configure `compression: { enabled: true, minBytes: 1024, brotliQuality: 4 }`
on `createProxyServer()`, or set `compression: { enabled: false }` if your edge
server already compresses responses. The proxy avoids double-compression and
never transforms SSE, Connect/gRPC, range, or `Cache-Control: no-transform`
responses. Zstandard is only selected when the Node runtime supports it.

## Proxy cache control (Section 32)

Response caching is **off by default**, independent of ZSRV's streaming compression. To opt in:

```bash
zerux-server proxy start --port 1355 --cache \
  --cache-max-entries 256 --cache-max-entry-bytes 1048576 \
  --cache-max-total-bytes 33554432 --cache-max-age 300
```

Or set `createProxyServer({ getRoutes, proxyPort, cache: { enabled: true } })`. This exposes `proxy.responseCache.stats()`, `.invalidate(hostname, pathname?)`, and `.clear()` for explicit invalidation. The proxy caches only HTTP 200 GET responses with explicit `Cache-Control: public, max-age=...` or `s-maxage`, no cookies/authentication, no `Set-Cookie`, no `Vary` or upstream `Content-Encoding`, and no range, protocol stream or private/no-store response. Storage uses bounded process memory, not disk; entries expire and are separated by route generation. Cached identity bodies are compressed per client on delivery, so a gzip client and a Brotli client are never served the wrong encoding. `Age` reflects storage time.

**Nginx deployment:** You can leave ZSRV compression disabled with `--no-compress` and use Nginx `gzip`/`brotli` instead. Already-compressed upstream responses always pass through unchanged. Do not configure both layers to compress the same response intentionally. SSE and Connect streams are neither buffered in ZSRV's cache nor compressed by ZSRV; configure Nginx `proxy_buffering off` for SSE as needed. Content-length, ETag, Vary and Accept-Encoding safety is handled by the proxy's compression layer; application-level cache policies remain authoritative.

### Reloading the development HTTP server

Development reloads now replace the active request handler without unbinding the application's HTTP port. In-flight requests retain their old handler, new requests use the new handler, and a failed `watchFunc` leaves the previous handler serving. This is local development lifecycle behavior, not a guarantee of zero-downtime production deployment.
