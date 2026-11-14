import { createEventClient } from '@zeruxjs/analytics/browser';

/**
 * Configure consent-gated public collection without starting a request on import or construction.
 * @param {string} endpoint - Host-approved HTTP(S) collector URL; no secret belongs in browser config.
 * @param {typeof fetch} transport - Borrowed Fetch implementation; caller owns its pools and egress policy.
 * @returns {ReturnType<typeof createEventClient>} Client the host enables through explicit consent; success means HTTP acceptance only.
 */
export function configureBrowserCollection(
  endpoint: string,
  transport: typeof fetch
) {
  return createEventClient({
    endpoint,
    fetch: transport,
    requireConsent: true,
  });
}
