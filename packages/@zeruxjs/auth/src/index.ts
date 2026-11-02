/** Server-side authentication primitives. */
export * from "./core.js";
export * from "./password-policy.js";
export * from "./totp.js";
export * from "./token-store.js";
export * from "./session-store.js";
export * from "./oauth.js";

export { hasTenantPermission, requireTenantPermission } from "./tenant-authorization.js";
export type { TenantPrincipal } from "./tenant-authorization.js";

export * from "./shared-auth.js";

export * from "./passkeys.js";
export { createMemoryPasskeyStore, PasskeyError } from "./passkey-store.js";
export type { PasskeyScope, PasskeyStore, PasskeyCredential, PasskeyChallenge } from "./passkey-store.js";
export type { ExternalStepUpIdentity, ClientCertificateIdentityAdapter, EnterpriseSsoIdentityAdapter } from "./step-up.js";

export * from "./provider-login.js";
export { createMemoryProviderLoginStore, ProviderLoginError } from "./provider-store.js";
export type { ProviderIdentity, ProviderAttempt, ProviderLoginStore } from "./provider-store.js";
export { providerProtocolInformation } from "./provider-profiles.js";
export type { ProviderProfile, ProviderProfileClaims } from "./provider-profiles.js";
