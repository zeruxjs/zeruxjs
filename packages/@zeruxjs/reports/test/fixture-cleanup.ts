/** Register ordered fixture-only cleanup; no operator data or live services are touched.
 * @param {import('node:test').TestContext} context - Native owning test context.
 * @returns {(stage: string, release: () => unknown) => void} Register finite release callbacks; all stages run even after a failure.
 */
export function createFixtureCleanup(context) {
  /** Dependency order: cancel/release held work before owners, then close environments and observe promises. */
  const order = [
    'cancel',
    'view',
    'source',
    'credentials',
    'environment',
    'pending',
  ];
  /** Finite callbacks acquired by this one test; nothing is shared across tests. */
  const entries = [];
  context.after(async () => {
    /** Preserve failures until every remaining fixture owner has had a release attempt. */
    const failures = [];
    // Stable ordering preserves registration order within one ownership stage.
    for (const { release } of entries.sort((a, b) => a.priority - b.priority)) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError(failures);
    }
  });
  return (stage, release) => {
    /** Trusted fixture stage; reject a typo instead of silently reordering resource cleanup. */
    const priority = order.indexOf(stage);
    if (priority < 0 || typeof release !== 'function') {
      throw new TypeError('Invalid fixture cleanup');
    }
    entries.push({ priority, release });
  };
}
