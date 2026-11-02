import { loginDenied, loginText } from './provider-store.js';
export type ProviderProfile = 'google' | 'microsoft' | 'github' | 'discord' | 'custom';
export interface ProviderProfileClaims { subject: string; name?: string; email?: string; emailVerified?: boolean }
/** Explicit claim mappings; no email-based identity key, role import or unverified account linking. */
export function mapProviderProfile(profile: ProviderProfile, value: Record<string, unknown>, custom?: (value: Readonly<Record<string, unknown>>) => ProviderProfileClaims): ProviderProfileClaims {
  let mapped: ProviderProfileClaims;
  if (profile === 'custom') { if (!custom) throw loginDenied(); mapped = custom(Object.freeze({ ...value })); }
  else if (profile === 'google') mapped = { subject: value.sub as string, name: value.name as string, email: value.email as string, emailVerified: value.email_verified === true };
  else if (profile === 'microsoft') mapped = { subject: value.sub as string, name: value.name as string, emailVerified: false }; // email/preferred_username is not verified identity
  else if (profile === 'github') mapped = { subject: Number.isSafeInteger(value.id) && (value.id as number) > 0 ? String(value.id) : '', name: value.name as string, emailVerified: false }; // /user does not prove email verification
  else if (profile === 'discord') mapped = { subject: typeof value.id === 'string' && /^[0-9]{1,32}$/.test(value.id) ? value.id : '', name: value.global_name as string ?? value.username as string, email: value.email as string, emailVerified: value.verified === true };
  else throw loginDenied();
  if (!mapped || !loginText(mapped.subject) || mapped.name !== undefined && mapped.name !== null && !loginText(mapped.name, 256) || mapped.emailVerified !== undefined && typeof mapped.emailVerified !== 'boolean') throw loginDenied();
  if (mapped.emailVerified === true && (!loginText(mapped.email, 320) || !mapped.email.includes('@'))) throw loginDenied();
  return { subject: mapped.subject, ...(mapped.name ? { name: mapped.name } : {}), ...(mapped.emailVerified === true ? { email: mapped.email, emailVerified: true } : { emailVerified: false }) };
}
/** Documentation metadata only; not registered providers or proof of live interoperability. */
export const providerProtocolInformation = Object.freeze({
  linkedin: Object.freeze({ protocol: 'oidc', documentation: 'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2', status: 'documentation-reviewed; explicit custom configuration required' }),
  x: Object.freeze({ protocol: 'oauth2-pkce', documentation: 'https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code', status: 'documentation-reviewed; explicit custom configuration required' }),
  facebook: Object.freeze({ protocol: 'unverified', documentation: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/', status: 'unverified; no provider profile implemented' })
});
