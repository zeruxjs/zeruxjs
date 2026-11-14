import type { IncomingMessage } from 'node:http';

import type { SharedDevRegistration, SharedDevSnapshot } from '../types.js';

export interface DevtoolsApiContext {
  /** Actual incoming request; caller identity must be verified by the owning host integration. */
  req: IncomingMessage;
  /** Registered application selected by the host router. */
  app: SharedDevRegistration;
  /** Private normalized development state borrowed for this request. */
  snapshot: SharedDevSnapshot;
  /** Optional client pairing label; it is not an authenticated principal. */
  identifier?: string | null;
}

export type DevtoolsApiHandler = (
  context: DevtoolsApiContext
) => Promise<unknown> | unknown;

/** Legacy process-wide trusted API handlers; hosts unregister replacements during reload. */
const apiHandlers = new Map<string, DevtoolsApiHandler>();

/** Install a trusted handler under an explicit legacy API name.
 * @param {string} name - Registration key replacing an existing handler with the same name.
 * @param {DevtoolsApiHandler} handler - Host-authored request handler responsible for its own validation/policy.
 * @returns {DevtoolsApiHandler} Borrowed installed callback, not a disposal handle.
 */
export const registerDevtoolsApiHandler = (
  name: string,
  handler: DevtoolsApiHandler
) => {
  apiHandlers.set(name, handler);
  return handler;
};

/** Remove one legacy process-wide API registration.
 * @param {string} name - Explicit registration key.
 * @returns {void} Removes only the map entry; callback resources remain host-owned.
 */
export const unregisterDevtoolsApiHandler = (name: string) => {
  apiHandlers.delete(name);
};

/** Look up one explicitly registered legacy API handler.
 * @param {string} name - Exact registration key.
 * @returns {DevtoolsApiHandler | null} Borrowed trusted callback, or null when absent.
 */
export const getDevtoolsApiHandler = (name: string) =>
  apiHandlers.get(name) ?? null;
