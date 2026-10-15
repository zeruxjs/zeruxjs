export { launchSupervisedCommand, canConnect, childEnvironment, validateAppPort, exitStatus } from './portless/process-supervisor.js';
export type { SupervisorOptions, SupervisedProcess, ProcessExit } from './portless/process-supervisor.js';
// Public portless proxy and route-management API. Core implementations live
// in src/portless so consumers can also import the small dedicated modules.
export { RouteStore, RouteConflictError } from './portless/routes.js';
export type { RouteMapping, RouteLease } from './portless/routes.js';
export {
  portlessProxy, portlessStop, portlessRestart, portlessRun,
  portlessList, portlessAlias, portlessGet, portlessHosts, portlessTrust, portlessStatus,
} from './portless/portless.js';

export { startServer } from './dev/server.js';

export * from "./portless/health.js";
export * from "./portless/managed-app.js";
export * from "./portless/process-supervisor.js";
export * from './portless/managed-status.js';
export * from './portless/runtime-status.js';

// Traffic pools and readiness-checked, lease-protected backend switching.
export { BackendHealthStore } from './portless/backend-health-state.js';
export type { SavedBackendHealth } from './portless/backend-health-state.js';
export { BackendPool, validateBackends } from './portless/backend-pool.js';
export type { BackendHealthOptions, BackendStatus } from './portless/backend-pool.js';
export type { RouteBackend, RouteInfo, ProxyServerOptions } from './portless/types.js';
export { handoverBackends } from './portless/handover.js';
export type { HandoverOptions } from './portless/handover.js';

export { createProxyServer, PORTLESS_HEADER } from './portless/proxy.js';
export type { ProxyServer } from './portless/proxy.js';

export { BackendConnections } from "./portless/backend-connections.js";
export { launchRollingApplication } from "./portless/rolling-app.js";
export type { RollingAppOptions, RollingApplication, RollingDeployResult, RollingStatus, RollingPhase } from "./portless/rolling-app.js";

// Cross-process rolling-deployment control, proxy drain RPC and durable history.
export { parseRollingRunArguments } from "./bin/parse-rolling.js";
export { createLocalControl, sendLocalControl, readControlDescriptor } from "./portless/local-control.js";
export { createDeploymentHistory, readDeploymentHistory } from "./portless/deployment-history.js";
export { createProxyConnectionControl, RemoteBackendConnections } from "./portless/proxy-control.js";
export type { DeploymentEvent, DeploymentRecord } from "./portless/deployment-history.js";

export { readGenerationRecord, recoverRollingGenerationsLocked } from './portless/generation-registry.js';
export { inspectRollingControllers, reconcileRollingControllers } from './portless/rolling-reconciler.js';
export type { ReconciliationItem, ReconciliationReport, ReconciliationOptions } from './portless/rolling-reconciler.js';
export type { TrackedGeneration, GenerationRecord, RecoveryReport } from './portless/generation-registry.js';
export { pruneDeploymentHistory } from './portless/deployment-history.js';

// Health-aware local process fleet management; independent from single-instance rolling controllers.
export { launchInstanceFleet } from './portless/instance-fleet.js';
export type { InstanceFleet, InstanceFleetOptions, FleetMemberStatus, FleetStatus, FleetReconcileResult, FleetPhase } from './portless/fleet-types.js';

// Multi-instance supervision with authenticated fleet CLI and durable retry budgets.
export { parseFleetRunArguments } from './bin/parse-fleet.js';
export { startFleetFromCLI, fleetCLIAction } from './portless/fleet-command.js';
export { readFleetCheckpoint, createFleetCheckpointWriter, fingerprintFleetConfig, removeFleetCheckpoint } from './portless/fleet-state.js';
export type { FleetCheckpoint } from './portless/fleet-state.js';

// Section 28: dynamic fleet capacity, bounded request-rate telemetry,
// hysteretic autoscaling, private event history and CLI controls.
export { AutoscalePolicy, validateAutoscaleConfig, DEFAULT_AUTOSCALE } from './portless/autoscale-policy.js';
export type { AutoscaleConfig, AutoscaleState } from './portless/autoscale-policy.js';
export { createFleetAutoscaler } from './portless/fleet-autoscaler.js';
export type { FleetAutoscaler, FleetLoadSource, FleetLoadMetrics, FleetAutoscaleObservation } from './portless/fleet-autoscaler.js';
export { availableFleetPort, fleetServingCount, fleetRetirementCandidate } from './portless/fleet-capacity.js';
export { appendFleetHistory, readFleetHistory, fleetHistoryPath } from './portless/fleet-events.js';
export type { FleetEvent, FleetEventKind } from './portless/fleet-events.js';
export { inspectFleetState } from './portless/fleet-diagnostics.js';
export type { FleetDiagnostics } from './portless/fleet-diagnostics.js';

export { LinuxFleetResourceSampler, parseLinuxProcessStat } from './portless/fleet-resources.js';
export type { FleetResourceMetrics, FleetResourceSource } from './portless/fleet-resources.js';
export type { AutoscaleMetric } from './portless/autoscale-policy.js';

export { renderFleetPrometheus } from './portless/fleet-prometheus.js';
export type { FleetMetricsExport } from './portless/fleet-prometheus.js';

export { evaluateFleetLiveHealth } from './portless/fleet-live-health.js';
export type { LiveFleetHealthOptions, LiveFleetHealthReport } from './portless/fleet-live-health.js';

export { FleetMetricHistory, readFleetMetricHistory, fleetMetricHistoryPath } from './portless/fleet-metric-history.js';
export type { FleetMetricPoint } from './portless/fleet-metric-history.js';

export { readLinuxContainerLimits } from './portless/fleet-container.js';
export type { LinuxContainerLimits } from './portless/fleet-container.js';
export { filterProxyHeaders, validateProxyBindAddress } from './portless/proxy-headers.js';
export { ProxyAdmission } from './portless/proxy-admission.js';
export type { ProxyAdmissionOptions } from './portless/proxy-admission.js';
export { parseProxyStartArguments } from './bin/parse-proxy.js';

// Built-in transport/protocol APIs (MCP moved into ZSRV).
export * from './protocols/index.js';
export { ProxyTelemetry } from './portless/proxy-telemetry.js';
export type { ProxyLoadStatus, RouteLoadStatus, StatusFamily } from './portless/proxy-telemetry.js';

export { forwardCompressedResponse, negotiateCompression, parseAcceptEncoding, encodingQuality, compressionSupported, validateCompressionOptions } from './portless/proxy-compression.js';
export type { ProxyCompressionOptions, CompressionEncoding } from './portless/proxy-compression.js';
export { ApplicationLoadMonitor } from './portless/application-load.js';
export type { ApplicationUsage } from './portless/application-load.js';

export { ProxyResponseCache } from './portless/proxy-cache.js';
export type { ProxyCacheOptions, ProxyCacheStats } from './portless/proxy-cache.js';
