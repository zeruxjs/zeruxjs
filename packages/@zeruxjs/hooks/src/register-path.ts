import { createPathRegistry } from './path-registry.js';
export { createPathRegistry } from './path-registry.js';
/** Legacy path APIs resolve the current working directory at call time. */
export function registerPath(alias: string, target: string): void { createPathRegistry().register(alias, target); }
export function resolvePath(alias: string): string | null {
  // Loader callers pass every module specifier; a non-alias must be a miss.
  if (typeof alias !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}:[a-zA-Z0-9_./-]{1,200}$/.test(alias)) return null;
  return createPathRegistry().resolve(alias);
}
export function getAllPaths(): Record<string, string> { return createPathRegistry().list(); }
export function unregisterPath(alias: string): void { createPathRegistry().unregister(alias); }
