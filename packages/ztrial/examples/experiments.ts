import {
  createExperimentCatalog, createExperimentEvaluator,
  type VerifiedExperimentContext
} from 'ztrial/experiments';

export function configureCheckout(
  tenant: string,
  tenantSalt: Uint8Array,
  authenticate: (principal: unknown, signal: AbortSignal) => Promise<VerifiedExperimentContext>
) {
  const catalog = createExperimentCatalog([{
    id: 'checkout', version: 1, salt: 'checkout_allocation_v1', migration: 'initial',
    environments: ['production'],
    variants: [
      {name: 'control', weight: 5000},
      {name: 'compact', weight: 3000},
      {name: 'express', weight: 2000}
    ]
  }]);
  return createExperimentEvaluator({
    catalog, tenant, tenantSalt,
    resolveContext: (principal, {signal}) => authenticate(principal, signal)
  });
}

export async function decideCheckout(
  evaluator: ReturnType<typeof configureCheckout>,
  serverPrincipal: unknown,
  signal: AbortSignal
) {
  // A middleware calls this after authentication; UI code consumes only the result.
  return evaluator.evaluate('checkout', serverPrincipal, {signal});
}
// The application owns await evaluator.close() at generation shutdown.
