/** Deterministic capacity planning shared by operator scaling and recovery. */
export interface FleetCapacityMember { port: number; generation: number; healthy: boolean; routed: boolean; running: boolean; }
export function availableFleetPort(ports: readonly number[], occupied: ReadonlySet<number>): number | undefined {
  return ports.find(port => !occupied.has(port));
}
export function fleetServingCount(members: readonly FleetCapacityMember[]): number {
  return members.filter(m => m.routed && m.healthy && m.running).length;
}
/** Newest or unhealthy generations retire first, preserving stable backends. */
export function fleetRetirementCandidate<T extends FleetCapacityMember>(members: readonly T[]): T | undefined {
  return [...members].filter(m => m.routed && m.running)
    .sort((a,b) => Number(a.healthy) - Number(b.healthy) || b.generation - a.generation)[0];
}
