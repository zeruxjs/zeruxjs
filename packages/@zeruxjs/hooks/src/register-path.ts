import { createPathRegistry } from './path-registry.js';
export { createPathRegistry } from './path-registry.js';
/** Compatible wrapper using the current working directory at invocation time.
 * @param {string} alias - Validated explicit path alias.
 * @param {string} target - Trusted existing target resolved by the current directory registry.
 * @returns {void} Private atomic registry update; concurrent writers still require host serialization.
 */
export function registerPath(alias: string, target: string): void {
  createPathRegistry().register(alias, target);
}
/** Resolve a valid alias using the invocation-time directory; ordinary module specifiers return a compatible miss.
 * @param {string} alias - Literal loader specifier inspected without importing/ executing it.
 * @returns {string | null} Registered absolute target or null; malformed registry failures still propagate.
 */
export function resolvePath(alias: string): string | null {
  // Loader callers pass every module specifier; a non-alias must be a miss.
  if (
    typeof alias !== 'string' ||
    !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}:[a-zA-Z0-9_./-]{1,200}$/.test(alias)
  ) {
    return null;
  }
  return createPathRegistry().resolve(alias);
}
/** Project invocation-time registry entries without exposing its mutable storage object.
 * @returns {Record<string, string>} Fresh alias/absolute-target map; no imports are executed.
 */
export function getAllPaths(): Record<string, string> {
  return createPathRegistry().list();
}
/** Remove one invocation-time registry alias through the atomic local writer.
 * @param {string} alias - Validated exact alias; a missing key is a no-op.
 * @returns {void} No target file is deleted; only the registry mapping changes.
 */
export function unregisterPath(alias: string): void {
  createPathRegistry().unregister(alias);
}
