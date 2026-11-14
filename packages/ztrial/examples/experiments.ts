import {
  createExperimentCatalog,
  createExperimentEvaluator,
  type VerifiedExperimentContext,
} from 'ztrial/experiments';

/** Configure one explicitly server-authenticated tenant evaluator using only public imports and inert named rollout facts.
 * @param {string} tenant - Verified opaque server tenant token, never a browser role or email.
 * @param {Uint8Array} tenantSalt - Host-owned independent32byte secret copied by the evaluator; never use example repeated bytes in production.
 * @param {(
    principal: unknown,
    signal: AbortSignal
  ) => Promise<VerifiedExperimentContext>} authenticate - Trusted host callback authenticating the initiating principal and returning bound tenant/subject/environment/consent.
 * @returns {ReturnType<typeof createExperimentEvaluator>} Owned server evaluator; await close during generation shutdown and keep borrowed auth/store dependencies alive through actual settlement.
 */
export function configureCheckout(
  tenant: string,
  tenantSalt: Uint8Array,
  authenticate: (
    principal: unknown,
    signal: AbortSignal
  ) => Promise<VerifiedExperimentContext>
) {
  /** Immutable named three-variant basis-point configuration with explicit initial rollout and environment eligibility. */
  const catalog = createExperimentCatalog([
    {
      id: 'checkout',
      version: 1,
      salt: 'checkout_allocation_v1',
      migration: 'initial',
      environments: ['production'],
      variants: [
        { name: 'control', weight: 5000 },
        { name: 'compact', weight: 3000 },
        { name: 'express', weight: 2000 },
      ],
    },
  ]);
  return createExperimentEvaluator({
    catalog,
    tenant,
    tenantSalt,
    resolveContext: (principal, { signal }) => authenticate(principal, signal),
  });
}

/** Evaluate one checkout allocation after host authentication without turning an assigned variant into a permission grant.
 * @param {ReturnType<typeof configureCheckout>} evaluator - Owned tenant-fixed configured evaluator.
 * @param {unknown} serverPrincipal - Authenticated initiating host principal passed only to the trusted context resolver.
 * @param {AbortSignal} signal - Request-owned cooperative cancellation; timeout does not prove external writes rolled back.
 * @returns {ReturnType<ReturnType<typeof configureCheckout>["evaluate"]>} Sanitized assigned/denied receipt or explicit dependency/policy failure; no analytics begins implicitly.
 */
export async function decideCheckout(
  evaluator: ReturnType<typeof configureCheckout>,
  serverPrincipal: unknown,
  signal: AbortSignal
) {
  // A middleware calls this after authentication; UI code consumes only the result.
  return evaluator.evaluate('checkout', serverPrincipal, { signal });
}
// The application owns await evaluator.close() at generation shutdown.
