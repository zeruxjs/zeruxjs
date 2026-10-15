import { createFetchRoute } from '../fetch-route.js';
import type { ZeruxPluginApi } from './types.js';
import type { RuntimeServiceScope } from './services.js';

/**
 * Reject routes that could shadow an internal endpoint (including dynamically
 * named parameters and catch-alls). Mount only when the generation is prepared.
 */
export function serviceRouteOverlaps(left: string, right: string): boolean {
  const a = left.split('/').filter(Boolean);
  const b = right.split('/').filter(Boolean);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].startsWith(':') && a[i].endsWith('*')) return true;
    if (b[i].startsWith(':') && b[i].endsWith('*')) return true;
    if (a[i].startsWith(':') || b[i].startsWith(':')) continue;
    // Zerux multisite folder groups accept both `{name}` and `name`.
    const expand = (segment: string) => segment.startsWith('{') && segment.endsWith('}')
      ? [segment, segment.slice(1, -1)] : [segment];
    if (!expand(a[i]).some(value => expand(b[i]).includes(value))) return false;
  }
  return a.length === b.length;
}

export function registerServiceHttpRoutes(
  api: Pick<ZeruxPluginApi, 'addRoute'>,
  scope: Pick<RuntimeServiceScope, 'httpRoutes'>,
  applicationPatterns: readonly string[]
): void {
  const routes = scope.httpRoutes();
  for (const route of routes) {
    if (applicationPatterns.some(existing => serviceRouteOverlaps(existing, route.pattern))) {
      throw new Error(`Reserved ${route.service} endpoint conflicts with application route: ${route.pattern}`);
    }
  }
  for (const route of routes) {
    api.addRoute({
      pattern: route.pattern,
      method: 'ALL',
      handler: createFetchRoute((request) => route.handler(request)),
      meta: { streamBody: true },
      source: `service:${route.service}`
    });
  }
}
