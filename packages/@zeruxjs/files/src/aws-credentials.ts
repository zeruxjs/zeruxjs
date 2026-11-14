/** AWS credential selection. An IAM role ARN names a role; STS is what issues credentials. */
export interface AwsKeyCredentials {
  /** Private AWS access-key identifier; never include it in diagnostics. */
  accessKeyId: string;
  /** Private AWS signing secret; never ship it to a browser. */
  secretAccessKey: string;
  /** Optional private temporary-session token. */
  sessionToken?: string;
  /** Optional credential expiry; monitored refresh results reject elapsed/invalid dates. */
  expiration?: Date;
}
export type AwsCredentialProvider = () => Promise<AwsKeyCredentials>;
export interface AssumeRoleOptions {
  /** Target role ARN; STS/provider authority is still required to assume it. */
  roleArn: string;
  /** Optional validated role-session name; provider default is zerux-files. */
  sessionName?: string;
  /** Optional host-configured external identity binding, not a public user identifier. */
  externalId?: string;
  /** Optional STS duration from 900–43200 seconds; actual role limits remain provider-owned. */
  durationSeconds?: number;
  /** MFA code and serial (when trust policy demands MFA). Prefer short-lived credentials. */
  mfa?: {
    /** Trusted MFA device ARN when required by the role trust policy. */
    serial: string;
    /** Current MFA code; do not log it or persist it as application metadata. */
    tokenCode: string;
  };
  /** Source identity: explicit credentials, profile, or the default AWS credential chain. */
  sourceCredentials?: AwsKeyCredentials | AwsCredentialProvider;
  /** Optional trusted source profile, exclusive with explicit sourceCredentials. */
  sourceProfile?: string;
  /** Region for STS; defaults to the S3 region. */
  stsRegion?: string;
}
export interface WebIdentityOptions {
  /** Target role ARN; STS/provider authority is still required to assume it. */
  roleArn: string;
  /** Trusted local OIDC token path; never accept arbitrary request paths. */
  tokenFile: string;
  /** Optional validated role-session name; provider default is zerux-files. */
  sessionName?: string;
  /** Optional STS region; defaults to the configured S3 region. */
  stsRegion?: string;
}
export interface AwsCredentialOptions {
  /** Explicit trusted shared-config profile running the official Roles Anywhere signing helper. */
  rolesAnywhere?: {
    /** Trusted AWS shared-config profile name; profile contents may include executable process-provider configuration. */
    profile: string;
  };
  /** Fixed, value-free provider diagnostics; exceptions from observers are isolated. */
  onCredentialStatus?: (
    status: Readonly<{
      /** Fixed diagnostic category only: valid, expiring within five minutes, expired or failed. */
      status: 'valid' | 'expiring' | 'expired' | 'failed';
      /** Optional credential expiry in epoch milliseconds; no credential values accompany it. */
      expiresAt?: number;
    }>
  ) => void;
  /** Private static credentials or borrowed provider; exclusive with other top-level modes. */
  credentials?: AwsKeyCredentials | AwsCredentialProvider;
  /** Trusted AWS shared-config profile name; profile contents may include executable process-provider configuration. */
  profile?: string;
  /** Optional STS role configuration, exclusive with other top-level modes. */
  assumeRole?: AssumeRoleOptions;
  /** Optional token-file/role configuration, exclusive with other top-level modes. */
  webIdentity?: WebIdentityOptions;
}
/** Supported IAM role ARN syntax only; matching does not establish permission. */
const rolePattern =
  /^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]{1,512}$/;
/** Validate a role identifier without assuming it or contacting STS.
 * @param {string} value - IAM role ARN in the supported AWS partitions.
 * @returns {void} Invalid role syntax throws TypeError; an ARN is not itself a credential.
 */
export function assertRoleArn(value: string): void {
  if (typeof value !== 'string' || !rolePattern.test(value)) {
    throw new TypeError('A valid IAM role ARN is required');
  }
}
/** Reject conflicting credential modes and malformed role/profile options before constructing a provider.
 * @param {AwsCredentialOptions} input - Trusted server configuration; absent modes select the SDK default chain.
 * @returns {void} Accepted configuration remains unchanged; no credential file/provider is evaluated here.
 */
export function validateAwsCredentialOptions(
  input: AwsCredentialOptions
): void {
  if (!input || typeof input !== 'object') {
    throw new TypeError('AWS credential options required');
  }
  // Reject malformed selected modes before any provider factory or shared configuration is loaded.
  for (const key of [
    'credentials',
    'assumeRole',
    'webIdentity',
    'rolesAnywhere',
  ] as const) {
    if (
      input[key] !== undefined &&
      (!input[key] ||
        (typeof input[key] !== 'object' &&
          !(key === 'credentials' && typeof input[key] === 'function')))
    ) {
      throw new TypeError('Invalid AWS credential mode');
    }
  }
  /** Presence flags used to reject multiple top-level credential modes. */
  const choices = [
    input.credentials !== undefined,
    input.profile !== undefined,
    input.assumeRole !== undefined,
    input.webIdentity !== undefined,
    input.rolesAnywhere !== undefined,
  ];
  if (choices.filter(Boolean).length > 1) {
    throw new TypeError('Choose exactly one top-level AWS credential mode');
  }
  if (
    input.rolesAnywhere &&
    (typeof input.rolesAnywhere.profile !== 'string' ||
      !/^[A-Za-z0-9_+=,.@-]{1,128}$/.test(input.rolesAnywhere.profile))
  ) {
    throw new TypeError('Invalid Roles Anywhere profile');
  }
  if (
    input.onCredentialStatus !== undefined &&
    typeof input.onCredentialStatus !== 'function'
  ) {
    throw new TypeError('Invalid credential observer');
  }
  if (
    input.profile !== undefined &&
    !/^[A-Za-z0-9_+=,.@-]{1,128}$/.test(input.profile)
  ) {
    throw new TypeError('Invalid AWS profile');
  }
  if (input.assumeRole) {
    /** Borrowed role configuration; source credentials and STS region remain explicitly host-selected. */
    const role = input.assumeRole;
    assertRoleArn(role.roleArn);
    if (role.sourceCredentials && role.sourceProfile) {
      throw new TypeError('Choose one role source credential mode');
    }
    if (
      role.sourceProfile &&
      !/^[A-Za-z0-9_+=,.@-]{1,128}$/.test(role.sourceProfile)
    ) {
      throw new TypeError('Invalid source profile');
    }
    if (
      role.externalId !== undefined &&
      (!role.externalId || role.externalId.length > 1224)
    ) {
      throw new TypeError('Invalid role external ID');
    }
    if (
      role.durationSeconds !== undefined &&
      (!Number.isSafeInteger(role.durationSeconds) ||
        role.durationSeconds < 900 ||
        role.durationSeconds > 43200)
    ) {
      throw new RangeError('Invalid STS role duration');
    }
    if (
      role.mfa &&
      (!/^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:mfa\/[A-Za-z0-9_+=,.@/-]{1,512}$/.test(
        role.mfa.serial
      ) ||
        !/^[0-9]{6,8}$/.test(role.mfa.tokenCode))
    ) {
      throw new TypeError('Invalid role MFA details');
    }
  }
  if (input.webIdentity) {
    assertRoleArn(input.webIdentity.roleArn);
    if (
      !input.webIdentity.tokenFile ||
      input.webIdentity.tokenFile.includes('\0')
    ) {
      throw new TypeError('Invalid OIDC token file');
    }
  }
  // Check both possible explicit credential sources without invoking borrowed providers.
  for (const credentials of [
    input.credentials,
    input.assumeRole?.sourceCredentials,
  ]) {
    if (
      credentials &&
      typeof credentials !== 'function' &&
      (typeof credentials.accessKeyId !== 'string' ||
        !credentials.accessKeyId ||
        typeof credentials.secretAccessKey !== 'string' ||
        !credentials.secretAccessKey)
    ) {
      throw new TypeError('Invalid AWS access key credentials');
    }
  }
  // Apply identical role-session syntax to assumed-role and web-identity modes.
  for (const name of [
    input.assumeRole?.sessionName,
    input.webIdentity?.sessionName,
  ]) {
    if (name !== undefined && !/^[A-Za-z0-9_+=,.@-]{2,64}$/.test(name)) {
      throw new TypeError('Invalid AWS role session name');
    }
  }
}
/** Select official lazy providers. Trusted process profiles may execute host-configured helpers when the provider is subsequently invoked; this is not an HTTP input boundary.
 * @param {AwsCredentialOptions} input - Exactly one explicit mode or the default chain.
 * @param {string} region - Configured S3 signing region used unless an STS region override is present.
 * @returns {Promise<AwsKeyCredentials | AwsCredentialProvider | undefined>} Static credentials, lazy SDK provider, or undefined to preserve the S3 default chain.
 */
async function selectAwsCredentials(
  input: AwsCredentialOptions,
  region: string
): Promise<AwsKeyCredentials | AwsCredentialProvider | undefined> {
  validateAwsCredentialOptions(input);
  if (input.credentials) {
    return input.credentials;
  }
  if (input.rolesAnywhere) {
    /** Official lazy process-profile provider; invocation trusts the host shared configuration. */
    const { fromProcess } = await import('@aws-sdk/credential-providers');
    return fromProcess({ profile: input.rolesAnywhere.profile });
  }
  if (input.profile) {
    /** Official shared-config provider; does not turn a profile name into application authorization. */
    const { fromIni } = await import('@aws-sdk/credential-providers');
    return fromIni({ profile: input.profile, clientConfig: { region } });
  }
  if (input.assumeRole) {
    /** Borrowed role configuration; source credentials and STS region remain explicitly host-selected. */
    const role = input.assumeRole;
    /** Official STS and profile factories loaded only for the selected mode. */
    const { fromTemporaryCredentials, fromIni } =
      await import('@aws-sdk/credential-providers');
    /** Explicit source provider or approved profile; undefined delegates to the SDK default chain. */
    const masterCredentials =
      role.sourceCredentials ??
      (role.sourceProfile
        ? fromIni({
            profile: role.sourceProfile,
            clientConfig: { region: role.stsRegion ?? region },
          })
        : undefined);
    return fromTemporaryCredentials({
      clientConfig: { region: role.stsRegion ?? region },
      masterCredentials,
      params: {
        RoleArn: role.roleArn,
        RoleSessionName: role.sessionName ?? 'zerux-files',
        ExternalId: role.externalId,
        DurationSeconds: role.durationSeconds,
        ...(role.mfa
          ? { SerialNumber: role.mfa.serial, TokenCode: role.mfa.tokenCode }
          : {}),
      },
    });
  }
  if (input.webIdentity) {
    /** Borrowed role configuration; source credentials and STS region remain explicitly host-selected. */
    const role = input.webIdentity;
    /** Official lazy web-identity provider; token-file ownership remains with the host. */
    const { fromTokenFile } = await import('@aws-sdk/credential-providers');
    return fromTokenFile({
      roleArn: role.roleArn,
      webIdentityTokenFile: role.tokenFile,
      roleSessionName: role.sessionName ?? 'zerux-files',
      clientConfig: { region: role.stsRegion ?? region },
    });
  }
  return undefined;
}

/** Validate each provider result and report fixed expiry-only diagnostics. Raw failure causes remain private; observers cannot change signing.
 * @param {AwsCredentialProvider} provider - Borrowed credential source; its owner controls refresh and helper lifetime.
 * @param {AwsCredentialOptions['onCredentialStatus']} onStatus - Optional synchronous observer receiving no keys or token values.
 * @returns {AwsCredentialProvider} Wrapped provider with CREDENTIALS_EXPIRED/CREDENTIALS_FAILED errors; no background refresh timer.
 */
export function monitorAwsCredentials(
  provider: AwsCredentialProvider,
  onStatus?: AwsCredentialOptions['onCredentialStatus']
): AwsCredentialProvider {
  if (
    typeof provider !== 'function' ||
    (onStatus !== undefined && typeof onStatus !== 'function')
  ) {
    throw new TypeError('Invalid credential monitor');
  }
  /** Isolated synchronous expiry observer; errors cannot change credential resolution.
   * @param {object} status - Fixed diagnostic status and optional expiry only; no key/token values.
   * @returns {void} Observer errors are isolated from signing.
   */
  const notify = (
    status: Parameters<
      NonNullable<AwsCredentialOptions['onCredentialStatus']>
    >[0]
  ) => {
    try {
      onStatus?.(Object.freeze(status));
    } catch {
      /* Diagnostics cannot change signing. */
    }
  };
  return async () => {
    let expired = false;
    try {
      /** Private refresh result validated before signing; never returned to diagnostics. */
      const credentials = await provider();
      if (
        !credentials ||
        typeof credentials.accessKeyId !== 'string' ||
        !credentials.accessKeyId ||
        typeof credentials.secretAccessKey !== 'string' ||
        !credentials.secretAccessKey ||
        (credentials.sessionToken !== undefined &&
          typeof credentials.sessionToken !== 'string')
      ) {
        throw new Error('Invalid credential result');
      }
      /** Parsed native Date expiry in epoch milliseconds, or absent for nonexpiring credentials. */
      const expiresAt =
        credentials.expiration instanceof Date
          ? credentials.expiration.getTime()
          : undefined;
      if (
        credentials.expiration !== undefined &&
        (!Number.isFinite(expiresAt) ||
          !(credentials.expiration instanceof Date))
      ) {
        throw new Error('Invalid credential expiration');
      }
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        expired = true;
        notify({ status: 'expired', expiresAt });
        throw Object.assign(new Error('AWS credentials expired'), {
          code: 'CREDENTIALS_EXPIRED',
        });
      }
      notify({
        status:
          expiresAt !== undefined && expiresAt - Date.now() <= 300000
            ? 'expiring'
            : 'valid',
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
      return { ...credentials };
    } catch (cause) {
      if (expired) {
        throw cause;
      }
      notify({ status: 'failed' });
      throw Object.assign(
        new Error('AWS credential resolution failed', { cause }),
        { code: 'CREDENTIALS_FAILED' }
      );
    }
  };
}
/** Resolve configuration into a static value or lazy monitored provider. The SDK owns on-demand memoization/refresh; importing this module starts no process.
 * @param {AwsCredentialOptions} input - Trusted server credential configuration; never application login credentials.
 * @param {string} region - Signing region forwarded to official provider client configuration.
 * @returns {Promise<AwsKeyCredentials | AwsCredentialProvider | undefined>} Preserved static credentials, selected lazy provider or undefined default-chain delegation.
 */
export async function resolveAwsCredentials(
  input: AwsCredentialOptions,
  region: string
): Promise<AwsKeyCredentials | AwsCredentialProvider | undefined> {
  let selected = await selectAwsCredentials(input, region);
  if (selected === undefined && !input.onCredentialStatus) {
    return undefined;
  }
  if (selected === undefined) {
    /** Official default chain loaded explicitly only when diagnostics require a wrapper. */
    const { fromNodeProviderChain } =
      await import('@aws-sdk/credential-providers');
    selected = fromNodeProviderChain({ clientConfig: { region } });
  }
  // Preserve the existing static-credential result when diagnostics are not requested.
  if (
    typeof selected !== 'function' &&
    !input.onCredentialStatus &&
    selected.expiration === undefined
  ) {
    return selected;
  }
  /** Stable selected credential value/provider captured by the lazy monitor closure. */
  const source = selected;
  return monitorAwsCredentials(
    typeof source === 'function' ? source : async () => source!,
    input.onCredentialStatus
  );
}
