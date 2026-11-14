// Trusted server code only. Never replace this with browser roles, public config or permissive callbacks.
// Return resolveCorePrincipal, publicPrincipal, authenticate, login, logout, authorize,
// csrf:{issue,verify}, verifySetupSecret, authorizeRecovery and admit.
// Consult zenixjs/application's ZenixOptions and @zenixjs/core/cms's CmsOptions.
// Core principals must be verified by the host auth/session system on every invocation.
/** Deliberately fail closed until the operator implements real server identity and policy.
 * @returns {Promise<never>} Always rejects in the scaffold; no default credentials or permissive callbacks exist.
 */
export async function createHostPolicy() {
  throw Error(
    'ZENIX_HOST_POLICY_REQUIRED: configure persistent verified sessions, site permissions, CSRF, bounded admission, constant-time setup-secret verification and trusted recovery before startup. No default credentials exist.'
  );
}
