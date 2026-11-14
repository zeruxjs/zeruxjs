import { createFetchRoute } from '../fetch-route.js';
import type { ZeruxPluginApi } from './types.js';
import type { RuntimeServiceScope } from './services.js';

/** Conservatively detect registered service/application path shadowing, including catch-alls and multisite aliases.
 * @param {string} left - First trusted registered route pattern.
 * @param {string} right - Second trusted registered route pattern.
 * @returns {boolean} Whether these route shapes can shadow the same path.
 */
export function serviceRouteOverlaps(left: string, right: string): boolean {
  /** First route segments; the shared minimum loop bound proves indexed positions exist. */
  const a = left.split('/').filter(Boolean);
  /** Second route segments checked for possible static/dynamic/catch-all shadowing. */
  const b = right.split('/').filter(Boolean);
  // The shared minimum bound proves both indexed route segments exist.
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i]!.startsWith(':') && a[i]!.endsWith('*')) {
      return true;
    }
    if (b[i]!.startsWith(':') && b[i]!.endsWith('*')) {
      return true;
    }
    if (a[i]!.startsWith(':') || b[i]!.startsWith(':')) {
      continue;
    }
    // Zerux multisite folder groups accept both `{name}` and `name`.
    /** Expand the existing multisite brace-folder aliases without permitting arbitrary regexes.
     * @param {string} segment - Registered literal segment.
     * @returns {string[]} Literal segment and optional public folder alias.
     */
    const expand = (segment: string) =>
      segment.startsWith('{') && segment.endsWith('}')
        ? [segment, segment.slice(1, -1)]
        : [segment];
    if (!expand(a[i]!).some((value) => expand(b[i]!).includes(value))) {
      return false;
    }
  }
  return a.length === b.length;
}

/** Preflight every reserved service route against application patterns before registration.
 * @param {Pick<ZeruxPluginApi, 'addRoute'>} api - Borrowed runtime route-registration surface.
 * @param {Pick<RuntimeServiceScope, 'httpRoutes'>} scope - Generation-owned service HTTP route snapshot.
 * @param {readonly string[]} applicationPatterns - Existing application patterns; services must not override them.
 * @returns {void} Registers only after the complete conflict check passes.
 */
export function registerServiceHttpRoutes(
  api: Pick<ZeruxPluginApi, 'addRoute'>,
  scope: Pick<RuntimeServiceScope, 'httpRoutes'>,
  applicationPatterns: readonly string[]
): void {
  /** Snapshot of generation-owned service routes, preflighted before adding any to the runtime. */
  const routes = scope.httpRoutes();
  for (const route of routes) {
    if (
      applicationPatterns.some((existing) =>
        serviceRouteOverlaps(existing, route.pattern)
      )
    ) {
      throw new Error(
        `Reserved ${route.service} endpoint conflicts with application route: ${route.pattern}`
      );
    }
  }
  for (const route of routes) {
    api.addRoute({
      pattern: route.pattern,
      method: 'ALL',
      handler: createFetchRoute((request) => route.handler(request)),
      meta: { streamBody: true },
      source: `service:${route.service}`,
    });
  }
}
