/** Deterministic capacity planning shared by operator scaling and recovery. */
export interface FleetCapacityMember {
  /** Validated private backend port from controller inventory. */
  port: number;
  /** Controller generation used for deterministic retirement priority. */
  generation: number;
  /** Current observed readiness flag, not an authorization claim. */
  healthy: boolean;
  /** Whether current route membership admits new work to this member. */
  routed: boolean;
  /** Whether the owned child is still observed running. */
  running: boolean;
}
/** Select the first unoccupied port from controller-validated capacity without binding or reserving it.
 * @param {readonly number[]} ports - Validated ordered private backend inventory.
 * @param {ReadonlySet<number>} occupied - Current controller-owned occupied-port snapshot.
 * @returns {number | undefined} First unused candidate or undefined; actual launch must still handle bind races.
 */
export function availableFleetPort(
  ports: readonly number[],
  occupied: ReadonlySet<number>
): number | undefined {
  return ports.find((port) => !occupied.has(port));
}
/** Count only members simultaneously marked routed, healthy and running; no native probe is performed.
 * @param {readonly FleetCapacityMember[]} members - Trusted current controller observations.
 * @returns {number} Observed serving-member count, not a fresh health guarantee.
 */
export function fleetServingCount(
  members: readonly FleetCapacityMember[]
): number {
  return members.filter((m) => m.routed && m.healthy && m.running).length;
}
/** Choose routed/running members by unhealthy-first then newest-generation priority, retaining input order for equal priorities.
 * @param {readonly T[]} members - Trusted controller inventory; the input array is never sorted in place.
 * @returns {T | undefined} Borrowed selected member or undefined; record ownership remains with the controller.
 */
export function fleetRetirementCandidate<T extends FleetCapacityMember>(
  members: readonly T[]
): T | undefined {
  return [...members]
    .filter((m) => m.routed && m.running)
    .sort(
      (a, b) =>
        Number(a.healthy) - Number(b.healthy) || b.generation - a.generation
    )[0];
}
