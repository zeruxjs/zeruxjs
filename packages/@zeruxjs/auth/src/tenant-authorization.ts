/** Host must obtain this principal only after verifying an authenticated, unexpired session. */
export interface TenantPrincipal {
  /** Previously authenticated user identifier; numeric zero remains valid. */
  userId: string | number;
  /** Exact verified tenant identifier; no coercion between strings/numbers. */
  tenantId: string | number;
  /** Explicit permission allowlist; no implicit role/wildcard access. */
  permissions: readonly string[];
  /** Optional site allowlist; omitted means this principal cannot access site-scoped resources. */
  siteIds?: readonly string[];
}

/** Check a previously authenticated principal against exact tenant, permission and optional site claims. Role names and browser-submitted claims are not authentication.
 * @param {TenantPrincipal | null | undefined} principal - Previously verified unexpired server principal, or absence.
 * @param {{
    tenantId: string | number;
    permission: string;
    siteId?: string;
  }} scope - Required tenant/permission and optional explicit site.
 * @param {string|number} scope.tenantId - Exact verified target tenant; numeric zero is valid.
 * @param {string} scope.permission - Explicit bounded permission name without wildcard expansion.
 * @param {string|undefined} scope.siteId - Optional exact site requiring a principal allowlist.
 * @returns {boolean} True only for explicit matching claims; no wildcard/admin bypass.
 */
export function hasTenantPermission(
  principal: TenantPrincipal | null | undefined,
  scope: {
    /** Exact verified tenant identifier; no coercion between strings/numbers. */
    tenantId: string | number;
    /** Required bounded exact permission name. */
    permission: string;
    /** Optional exact site ID, requiring an explicit principal site allowlist. */
    siteId?: string;
  }
): boolean {
  if (
    !principal ||
    typeof principal !== 'object' ||
    !(typeof principal.userId === 'string'
      ? principal.userId.length > 0
      : Number.isSafeInteger(principal.userId)) ||
    !(
      (typeof scope.tenantId === 'string' && scope.tenantId.length > 0) ||
      (typeof scope.tenantId === 'number' &&
        Number.isSafeInteger(scope.tenantId))
    ) ||
    principal.tenantId !== scope.tenantId ||
    typeof scope.permission !== 'string' ||
    !/^[a-z0-9][a-z0-9:_-]{0,99}$/.test(scope.permission) ||
    !Array.isArray(principal.permissions) ||
    !principal.permissions.includes(scope.permission)
  ) {
    return false;
  }
  if (
    scope.siteId !== undefined &&
    (!/^[A-Za-z0-9_-]{1,128}$/.test(scope.siteId) ||
      !Array.isArray(principal.siteIds) ||
      !principal.siteIds.includes(scope.siteId))
  ) {
    return false;
  }
  return true;
}

/** Require exact tenant/permission/site claims from a verified principal.
 * @param {TenantPrincipal | null | undefined} principal - Previously authenticated server principal.
 * @param {{
    tenantId: string | number;
    permission: string;
    siteId?: string;
  }} scope - Explicit target tenant/permission/site.
 * @param {string|number} scope.tenantId - Exact verified target tenant; numeric zero is valid.
 * @param {string} scope.permission - Explicit bounded permission name without wildcard expansion.
 * @param {string|undefined} scope.siteId - Optional exact site requiring a principal allowlist.
 * @returns {void} Throws a fixed denial when the check fails.
 */
export function requireTenantPermission(
  principal: TenantPrincipal | null | undefined,
  scope: {
    /** Exact verified tenant identifier; no coercion between strings/numbers. */
    tenantId: string | number;
    /** Required bounded exact permission name. */
    permission: string;
    /** Optional exact site ID, requiring an explicit principal site allowlist. */
    siteId?: string;
  }
): void {
  if (!hasTenantPermission(principal, scope)) {
    throw new Error('Tenant permission denied');
  }
}
