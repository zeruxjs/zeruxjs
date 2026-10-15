import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export interface OAuthAuthorizationOptions {
    authorizationEndpoint: string;
    clientId: string;
    redirectUri: string;
    allowedRedirectUris: readonly string[];
    scopes?: readonly string[];
    extra?: Record<string, string>;
}
/** OAuth 2.0 authorization-code PKCE parameters (RFC 7636). Store state/verifier server-side per initiating session. */
export function createOAuthAuthorization(options: OAuthAuthorizationOptions) {
    const endpoint = new URL(options.authorizationEndpoint), redirect = new URL(options.redirectUri);
    if (endpoint.protocol !== "https:" || !options.allowedRedirectUris.includes(redirect.href) || !options.clientId) throw new Error("Invalid OAuth endpoint, client or redirect allowlist");
    if (redirect.protocol !== "https:" && !(redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1")) throw new Error("OAuth redirect must use HTTPS outside localhost");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");
    const url = new URL(endpoint.href);
    if (Object.keys(options.extra ?? {}).some(k => ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope"].includes(k))) throw new Error("Reserved OAuth parameter");
    for (const [key, value] of Object.entries(options.extra ?? {})) url.searchParams.set(key, value);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", options.clientId);
    url.searchParams.set("redirect_uri", redirect.href);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (options.scopes?.length) url.searchParams.set("scope", options.scopes.join(" "));
    return { url: url.href, verifier, state, challenge };
}
/** The received callback state must exactly equal the state tied to the initiating session. */
export function verifyOAuthState(expected: string, received: string): boolean {
    if (typeof expected !== "string" || typeof received !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(expected)) return false;
    return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
