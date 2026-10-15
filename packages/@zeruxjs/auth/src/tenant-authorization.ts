/** Host must obtain this principal only after verifying an authenticated, unexpired session. */
export interface TenantPrincipal {
    userId: string | number;
    tenantId: string | number;
    permissions: readonly string[];
    /** Optional site allowlist; omitted means this principal cannot access site-scoped resources. */
    siteIds?: readonly string[];
}

/** Role names alone are not authorization; check explicit tenant and permission claims. */
export function hasTenantPermission(principal: TenantPrincipal | null | undefined, scope: {
    tenantId: string | number;
    permission: string;
    siteId?: string;
}): boolean {
    if (!principal || typeof principal !== "object" ||
        !(typeof principal.userId === "string" ? principal.userId.length > 0 : Number.isSafeInteger(principal.userId)) ||
        !((typeof scope.tenantId === "string" && scope.tenantId.length > 0) || (typeof scope.tenantId === "number" && Number.isSafeInteger(scope.tenantId))) ||
        principal.tenantId !== scope.tenantId ||
        typeof scope.permission !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,99}$/.test(scope.permission) ||
        !Array.isArray(principal.permissions) || !principal.permissions.includes(scope.permission)) return false;
    if (scope.siteId !== undefined && (!/^[A-Za-z0-9_-]{1,128}$/.test(scope.siteId) || !Array.isArray(principal.siteIds) || !principal.siteIds.includes(scope.siteId))) return false;
    return true;
}

export function requireTenantPermission(principal: TenantPrincipal | null | undefined, scope: {
    tenantId: string | number;
    permission: string;
    siteId?: string;
}): void {
    if (!hasTenantPermission(principal, scope)) throw new Error("Tenant permission denied");
}
