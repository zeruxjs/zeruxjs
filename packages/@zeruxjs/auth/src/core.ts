import crypto from 'node:crypto';

export type AuthDbAdapter = {
  insert(operation: Record<string, unknown>): Promise<Record<string, any>>;
  select(operation: Record<string, unknown>): Promise<Record<string, any>>;
  update(operation: Record<string, unknown>): Promise<Record<string, any>>;
  delete(operation: Record<string, unknown>): Promise<Record<string, any>>;
};

export type AuthConfig = {
  /** Legacy table/field mappings, not a connection or tenant authorization. */
  db: {
    /** Validated users-table identifier. */
    usersTable: string;
    /** Validated legacy role-table identifier. */
    rolesTable: string;
    /** Validated user metadata table. */
    usermetaTable: string;
    /** Set false on engines (e.g. MySQL) without INSERT .. RETURNING; inspect insertedIds instead. */
    supportsReturning?: boolean;
    /** Validated mapped storage column identifiers. */
    fields: {
      /** Mapped authenticated user primary key. */
      userId: string;
      /** Mapped normalized account-label column. */
      email: string;
      /** Mapped private encoded password-hash column. */
      passwordHash: string;
      /** Mapped host-approved role column. */
      role: string;
    };
  };
  /** Legacy encrypted-session policy; shared opaque sessions are separate. */
  session: {
    /** Validated configured cookie label; no cookie is automatically sent. */
    cookieName: string;
    /** Server session lifetime seconds, default 86400 and maximum one year. */
    expiresIn: number;
  };
};

/** Process-global legacy mappings retained for compatibility; do not mutate them per concurrent tenant request. */
let globalConfig: AuthConfig = {
  db: {
    usersTable: 'users',
    rolesTable: 'groups',
    usermetaTable: 'usermeta',
    fields: {
      userId: 'id',
      email: 'email',
      passwordHash: 'password',
      role: 'role',
    },
  },
  session: {
    cookieName: 'proworkspace_session',
    expiresIn: 86400,
  },
};

/** Derive compatibility key material from explicitly configured private host secrets; production rejects fallback defaults.
 * @param {string} purpose - Fixed internal domain separator, not request-controlled algorithm choice.
 * @returns {Buffer} Owned 32-byte derived material; never log or expose it. */
const keyMaterial = (purpose: string) => {
  /** Private session-key configuration; never include it in logs or client data. */
  const key =
    process.env.SECURITY_SESSION_KEY ||
    process.env.SECURITY_ENCRYPTION_KEY ||
    'change-me-session-key';
  /** Random per-password salt or configured session derivation salt; ownership follows the enclosing crypto operation. */
  const salt =
    process.env.SECURITY_SESSION_SALT ||
    process.env.SECURITY_ENCRYPTION_SALT ||
    'change-me-session-salt';

  if (
    process.env.NODE_ENV === 'production' &&
    (key === 'change-me-session-key' || salt === 'change-me-session-salt')
  ) {
    throw new Error(
      'Set SECURITY_SESSION_KEY and SECURITY_SESSION_SALT before using sessions in production'
    );
  }
  return crypto.scryptSync(`${key}:${purpose}`, salt, 32);
};

/** Compare equal-length byte spellings without exposing secret values.
 * @param {string} left - Private expected spelling.
 * @param {string} right - Private candidate spelling.
 * @returns {boolean} Whether lengths and bytes match; this is not authorization alone. */
const timingSafeEqualText = (left: string, right: string) => {
  /** Private expected UTF-8 bytes, used only for length/constant-time comparison. */
  const leftBuffer = Buffer.from(left);
  /** Private candidate UTF-8 bytes, never logged. */
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

/** Validate table/column identifiers before configuration mutation.
 * @param {unknown} value - Untrusted configured identifier.
 * @returns {boolean} Whether the SQL identifier grammar and reserved-key policy pass. */
const safeIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value.toLowerCase());

/** Validate before updating the process-global legacy auth mappings. Scoped shared/passkey/provider APIs keep separate explicit configuration.
 * @param {Partial<AuthConfig>} config - Trusted host mappings/session policy, never arbitrary browser configuration.
 * @returns {void} Invalid configuration throws before changing the previous settings. */
export const setAuthConfig = (config: Partial<AuthConfig>) => {
  // Validate before modifying the active configuration: table/column names are SQL identifiers,
  // not values, and parameter binding cannot make an unsafe identifier safe.
  if (config.db) {
    // Validate every configured table/column name before changing the process-global mappings.
    for (const name of [
      config.db.usersTable,
      config.db.rolesTable,
      config.db.usermetaTable,
      ...Object.values(config.db.fields ?? {}),
    ]) {
      if (name !== undefined && !safeIdentifier(name)) {
        throw new Error('Unsafe authentication database identifier');
      }
    }
  }
  if (
    config.db?.supportsReturning !== undefined &&
    typeof config.db.supportsReturning !== 'boolean'
  ) {
    throw new Error('Invalid auth returning capability');
  }
  if (
    config.session?.cookieName !== undefined &&
    !/^(__Host-|__Secure-)?[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(
      config.session.cookieName
    )
  ) {
    throw new Error('Invalid session cookie name');
  }
  if (
    config.session?.expiresIn !== undefined &&
    (!Number.isSafeInteger(config.session.expiresIn) ||
      config.session.expiresIn < 1 ||
      config.session.expiresIn > 86400 * 365)
  ) {
    throw new Error('Invalid session duration');
  }
  globalConfig = {
    ...globalConfig,
    ...config,
    db: {
      ...globalConfig.db,
      ...config.db,
      fields: {
        ...globalConfig.db.fields,
        ...config.db?.fields,
      },
    },
    session: {
      ...globalConfig.session,
      ...config.session,
    },
  };
};

/** Read detached compatibility configuration without leaking secret environment values.

 * @returns {AuthConfig} Deep copy of current mapping/session settings. */
export const getAuthConfig = (): AuthConfig => structuredClone(globalConfig);

/** Hash a private bounded password using Node scrypt, random per-password salt and configured host pepper.
 * @param {string} password - Private candidate from a bounded trusted server form; password policy is a separate explicit call.
 * @returns {string} Encoded hash; production missing pepper throws. */
export const hashPassword = (password: string) => {
  if (
    typeof password !== 'string' ||
    Buffer.byteLength(password, 'utf8') > 4096
  ) {
    throw new Error('Invalid password size');
  }
  /** Random per-password salt or configured session derivation salt; ownership follows the enclosing crypto operation. */
  const salt = crypto.randomBytes(16).toString('hex');
  /** Private configured password pepper; production rejects the compatibility fallback. */
  const pepper =
    process.env.SECURITY_PASSWORD_SALT || 'change-me-password-salt';
  if (
    process.env.NODE_ENV === 'production' &&
    pepper === 'change-me-password-salt'
  ) {
    throw new Error('SECURITY_PASSWORD_SALT must be configured in production');
  }
  /** Private encoded digest or keyed comparison target. */
  const hash = crypto
    .scryptSync(password, `${pepper}:${salt}`, 64)
    .toString('hex');

  return `scrypt:${salt}:${hash}`;
};

/** Verify supported current/legacy scrypt formats without upgrading or changing stored credentials automatically.
 * @param {string} password - Private candidate, bounded to 4096 UTF-8 bytes.
 * @param {string} storedHash - Stored current or compatible legacy encoded hash.
 * @returns {boolean} Whether a supported hash matches; production key-policy errors remain explicit. */
export const verifyPassword = (password: string, storedHash: string) => {
  if (
    typeof password !== 'string' ||
    Buffer.byteLength(password, 'utf8') > 4096
  ) {
    return false;
  }
  /** Bounded candidate encoded-hash components; supported formats are checked explicitly. */
  const parts = String(storedHash || '').split(':');
  if (storedHash?.length > 512) {
    return false;
  }
  /** Private configured password pepper; production rejects the compatibility fallback. */
  const pepper =
    process.env.SECURITY_PASSWORD_SALT || 'change-me-password-salt';
  if (
    process.env.NODE_ENV === 'production' &&
    pepper === 'change-me-password-salt'
  ) {
    throw new Error('SECURITY_PASSWORD_SALT must be configured in production');
  }

  if (parts.length === 3 && parts[0] === 'scrypt') {
    /** Validated current-format salt/hash components; original wire spelling remains compatible. */
    const [, salt, hash] = parts;
    if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) {
      return false;
    }
    /** Locally computed expected scrypt digest, never exposed in diagnostics. */
    const expectedHash = crypto
      .scryptSync(password, `${pepper}:${salt}`, 64)
      .toString('hex');
    /** Compatible historical derivation retained only for verification of existing records. */
    const legacyExpectedHash = crypto
      .scryptSync(password, salt, 64)
      .toString('hex');

    return (
      timingSafeEqualText(hash, expectedHash) ||
      timingSafeEqualText(hash, legacyExpectedHash)
    );
  }

  if (parts.length === 2) {
    /** Validated legacy salt/hash pair. */
    const [salt, hash] = parts;
    if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) {
      return false;
    }
    /** Locally computed expected scrypt digest, never exposed in diagnostics. */
    const expectedHash = crypto
      .scryptSync(password, `${pepper}${salt}`, 64)
      .toString('hex');

    return timingSafeEqualText(hash, expectedHash);
  }

  return false;
};

/** Create a legacy encrypted bearer session with protected server user/ID/expiry claims. This does not create shared revocation state.
 * @param {string|number} userId - Host-authenticated user identity.
 * @param {Record<string, unknown>} additionalData - Trusted bounded/serializable claims; host authorization and size policy remain required.
 * @returns {string} Private AES-GCM encrypted bearer; do not log it or treat arbitrary extra roles as authenticated input. */
export const createSession = (
  userId: string | number,
  additionalData: Record<string, unknown> = {}
) => {
  if (
    !Number.isSafeInteger(globalConfig.session.expiresIn) ||
    globalConfig.session.expiresIn < 1 ||
    globalConfig.session.expiresIn > 86400 * 365
  ) {
    throw new RangeError('Invalid session duration');
  }
  /** Server-derived Unix-second session expiry overriding any supplied extra expiry. */
  const expiresAt =
    Math.floor(Date.now() / 1000) + globalConfig.session.expiresIn;
  if (
    additionalData === null ||
    typeof additionalData !== 'object' ||
    Array.isArray(additionalData) ||
    Object.keys(additionalData).some((key) =>
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
  ) {
    throw new Error('Invalid session claims');
  }
  /** Inert serialized trusted session claims with protected server user/ID/expiry. */
  const payload = JSON.stringify({
    ...additionalData,
    userId,
    jti: crypto.randomBytes(16).toString('base64url'),
    expiresAt,
  });
  /** Fresh 96-bit AES-GCM nonce per encrypted session. */
  const iv = crypto.randomBytes(12);
  /** One-shot authenticated session cipher using configured private domain-separated material. */
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    keyMaterial('session'),
    iv
  );
  /** Ciphertext bytes; plaintext is never returned by the issuance helper. */
  const encrypted = Buffer.concat([
    cipher.update(payload, 'utf8'),
    cipher.final(),
  ]);
  /** Authenticated GCM tag carried in the unchanged compatibility wire layout. */
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
};

/** Authenticate/decrypt a supported legacy session and check required identity, ID and expiry fields.
 * @param {string} token - Private untrusted bearer spelling.
 * @returns {{expiresAt?: number, userId?: string|number}|null} Parsed private claims or denial; no shared revocation check is implicit. */
export const verifySession = (token: string) => {
  try {
    if (
      typeof token !== 'string' ||
      token.length > 8192 ||
      !/^[A-Za-z0-9_-]+$/.test(token)
    ) {
      return null;
    }
    /** Bounded candidate encrypted token bytes checked before deciphering. */
    const raw = Buffer.from(token, 'base64url');
    if (raw.length <= 28) {
      return null;
    }

    /** Fresh 96-bit AES-GCM nonce per encrypted session. */
    const iv = raw.subarray(0, 12);
    /** Authenticated GCM tag carried in the unchanged compatibility wire layout. */
    const tag = raw.subarray(12, 28);
    /** Ciphertext bytes; plaintext is never returned by the issuance helper. */
    const encrypted = raw.subarray(28);
    /** One-shot authenticated decryptor; failed tags never expose plaintext claims. */
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyMaterial('session'),
      iv
    );
    decipher.setAuthTag(tag);
    /** Private authenticated UTF-8 JSON, parsed without evaluating code. */
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
    /** Private verified parsed claims; host must reauthorize sensitive work and sanitize public views. */
    const session = JSON.parse(decrypted) as {
      expiresAt?: number;
      /** Mapped authenticated user primary key. */
      userId?: string | number;
    };

    if (
      (!(
        typeof session.userId === 'string' &&
        session.userId.length > 0 &&
        session.userId.length <= 512
      ) &&
        !(
          typeof session.userId === 'number' &&
          Number.isSafeInteger(session.userId)
        )) ||
      typeof session.expiresAt !== 'number' ||
      !Number.isSafeInteger(session.expiresAt) ||
      typeof (session as { jti?: unknown }).jti !== 'string' ||
      !/^[A-Za-z0-9_-]{22}$/.test((session as { jti: string }).jti) ||
      Math.floor(Date.now() / 1000) >= session.expiresAt
    ) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
};

/** Insert a legacy user using validated host mappings and a freshly hashed password. The host owns authorization, tenant scope, uniqueness and transaction policy.
 * @param {string} email - Host-validated account label; normalized to lowercase.
 * @param {string} passwordPlain - Private password; enforce strength policy separately.
 * @param {string} role - Host-approved role, default employee; never copy browser role claims.
 * @param {AuthDbAdapter} dbAdapter - Borrowed tenant-bound database facade.
 * @param {Record<string, unknown>} extraValues - Trusted extra insert values, not an authorization source.
 * @returns {Promise<Record<string, any>>} Raw adapter receipt, with configured returning behavior; sanitize before client use. */
export const createUser = async (
  email: string,
  passwordPlain: string,
  role = 'employee',
  dbAdapter: AuthDbAdapter,
  extraValues: Record<string, unknown> = {}
) => {
  /** Detached validated legacy table/field/session mappings. */
  const config = getAuthConfig();

  return dbAdapter.insert({
    table: config.db.usersTable,
    values: {
      ...extraValues,
      [config.db.fields.email]: email.toLowerCase(),
      [config.db.fields.passwordHash]: hashPassword(passwordPlain),
      [config.db.fields.role]: role,
    },
    ...(config.db.supportsReturning === false
      ? {}
      : { returning: [config.db.fields.userId] }),
  });
};

/** Look up one legacy account and compare its password. Returned raw database data stays private.
 * @param {string} email - Host-validated account label normalized for lookup.
 * @param {string} passwordPlain - Private candidate password.
 * @param {AuthDbAdapter} dbAdapter - Borrowed host-scoped database facade.
 * @returns {Promise<Record<string, any>|false>} Raw internal user row or false; the row may include password hashes and must not be serialized to clients. */
export const verifyUser = async (
  email: string,
  passwordPlain: string,
  dbAdapter: AuthDbAdapter
) => {
  /** Detached validated legacy table/field/session mappings. */
  const config = getAuthConfig();
  /** Raw borrowed adapter result; never automatically safe for client serialization. */
  const result = await dbAdapter.select({
    table: config.db.usersTable,
    where: {
      field: config.db.fields.email,
      operator: 'eq',
      value: email.toLowerCase(),
    },
    limit: 1,
  });
  /** Internal selected user row, potentially including password hashes/private columns. */
  const user = Array.isArray(result.rows)
    ? (result.rows[0] as Record<string, any> | undefined)
    : undefined;

  if (
    !user ||
    !verifyPassword(
      passwordPlain,
      String(user[config.db.fields.passwordHash] || '')
    )
  ) {
    return false;
  }

  return user;
};

/** Read one metadata field through the host-scoped legacy facade.
 * @param {string|number} userId - Verified target user; this helper does not authorize it.
 * @param {string} key - Explicit metadata key.
 * @param {AuthDbAdapter} dbAdapter - Borrowed authorized database facade.
 * @returns {Promise<unknown>} Stored value or null; storage failures propagate. */
export const getUsermeta = async (
  userId: string | number,
  key: string,
  dbAdapter: AuthDbAdapter
) => {
  /** Detached validated legacy table/field/session mappings. */
  const config = getAuthConfig();
  /** Raw borrowed adapter result; never automatically safe for client serialization. */
  const result = await dbAdapter.select({
    table: config.db.usermetaTable,
    where: {
      and: [
        { field: 'user_id', operator: 'eq', value: userId },
        { field: 'key', operator: 'eq', value: key },
      ],
    },
    limit: 1,
  });
  /** Bounded selected metadata/capability row from the borrowed adapter. */
  const row = Array.isArray(result.rows)
    ? (result.rows[0] as { value?: unknown } | undefined)
    : undefined;

  return row?.value ?? null;
};

/** Update or insert one legacy metadata value. Lookup and mutation are separate, not an atomic upsert.
 * @param {string|number} userId - Verified authorized target user.
 * @param {string} key - Explicit metadata key.
 * @param {unknown} value - Trusted inert serializable metadata.
 * @param {AuthDbAdapter} dbAdapter - Borrowed host-scoped database facade.
 * @returns {Promise<Record<string, any>>} Raw adapter result; host owns uniqueness, races and transaction boundaries. */
export const updateUsermeta = async (
  userId: string | number,
  key: string,
  value: unknown,
  dbAdapter: AuthDbAdapter
) => {
  /** Detached validated legacy table/field/session mappings. */
  const config = getAuthConfig();
  /** Prior metadata lookup; this is not a pinned atomic upsert. */
  const existing = await getUsermeta(userId, key, dbAdapter);

  if (existing !== null) {
    return dbAdapter.update({
      table: config.db.usermetaTable,
      values: {
        value: typeof value === 'string' ? value : JSON.stringify(value),
      },
      where: {
        and: [
          { field: 'user_id', operator: 'eq', value: userId },
          { field: 'key', operator: 'eq', value: key },
        ],
      },
    });
  }

  return dbAdapter.insert({
    table: config.db.usermetaTable,
    values: {
      user_id: userId,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    },
  });
};

/** Read legacy role capabilities with optional exact organization scope, including numeric zero.
 * @param {string} role - Host-verified role label.
 * @param {AuthDbAdapter} dbAdapter - Borrowed database facade whose tenant scope is host-owned.
 * @param {number|undefined} orgId - Optional nonnegative organization ID; zero remains enforced.
 * @returns {Promise<string[]>} Configured legacy capabilities; explicit wildcard remains supported. */
export const getCapabilities = async (
  role: string,
  dbAdapter: AuthDbAdapter,
  orgId?: number
) => {
  /** Detached validated legacy table/field/session mappings. */
  const config = getAuthConfig();
  if (orgId !== undefined && (!Number.isSafeInteger(orgId) || orgId < 0)) {
    throw new Error('Invalid organization identifier');
  }
  /** Structured role/organization predicates; a supplied organization zero remains included. */
  const where =
    orgId !== undefined
      ? {
          and: [
            { field: 'name', operator: 'eq', value: role },
            { field: 'org_id', operator: 'eq', value: orgId },
          ],
        }
      : { field: 'name', operator: 'eq', value: role };
  /** Raw borrowed adapter result; never automatically safe for client serialization. */
  const result = await dbAdapter.select({
    table: config.db.rolesTable,
    columns: ['capabilities'],
    where,
    limit: 1,
  });
  /** Bounded selected metadata/capability row from the borrowed adapter. */
  const row = Array.isArray(result.rows)
    ? (result.rows[0] as { capabilities?: unknown } | undefined)
    : undefined;
  /** Bounded candidate encrypted token bytes checked before deciphering. */
  const raw = String(row?.capabilities ?? '');

  if (raw === '*') {
    return ['*'];
  }

  return raw
    .split(/[,\n]+/)
    .map((capability) => capability.trim())
    .filter(Boolean);
};

/** Check legacy database role capabilities without changing tenant permission semantics.
 * @param {string} userRole - Host-verified role.
 * @param {string} capability - Required capability label.
 * @param {AuthDbAdapter} dbAdapter - Borrowed host-scoped database.
 * @param {number|undefined} orgId - Optional exact organization scope.
 * @returns {Promise<boolean>} Exact or legacy wildcard match; not a substitute for tenant authorization. */
export const hasCapability = async (
  userRole: string,
  capability: string,
  dbAdapter: AuthDbAdapter,
  orgId?: number
) => {
  /** Legacy configured capability list; explicit wildcard behavior stays compatible. */
  const capabilities = await getCapabilities(userRole, dbAdapter, orgId);

  return capabilities.includes('*') || capabilities.includes(capability);
};

/** Create challenge-shaped compatibility data only; this does not persist a ceremony or verify WebAuthn.
 * @param {string} userId - Trusted user handle input.
 * @param {string} rpId - Host-configured relying-party ID.
 * @param {string} displayName - Host-owned inert display label.
 * @returns {ReturnType<typeof createPasskeyChallenge>} Challenge/options data; use createPasskeyManager for a verified one-use ceremony. */
export const createPasskeyChallenge = (
  userId: string,
  rpId: string,
  displayName: string
) => ({
  challenge: crypto.randomBytes(32).toString('base64url'),
  rp: { name: 'ProWorkspace', id: rpId },
  user: {
    id: Buffer.from(userId).toString('base64url'),
    name: displayName,
    displayName,
  },
  pubKeyCredParams: [
    { type: 'public-key', alg: -7 },
    { type: 'public-key', alg: -257 },
  ],
  timeout: 60000,
  attestation: 'none',
  authenticatorSelection: {
    residentKey: 'preferred',
    userVerification: 'preferred',
  },
});

/** Generate a random compatibility six-digit secret without expiry, attempt or replay state.

 * @returns {string} Private code; use persisted challenges for one-time consumption. */
export const createOtp = () => crypto.randomInt(100000, 1000000).toString();

/** HMAC a compatibility OTP under configured domain-separated key material.
 * @param {string} otp - Private secret code, never logged.
 * @returns {string} Digest only; storing it alone does not enforce expiry or one-use semantics. */
export const hashOtp = (otp: string) =>
  crypto.createHmac('sha256', keyMaterial('otp')).update(otp).digest('hex');

/** Compare a compatibility OTP digest without consuming persisted state.
 * @param {string} otp - Private submitted code.
 * @param {string} hash - Expected keyed digest.
 * @returns {boolean} Digest match only; rate limits, purpose/account binding, expiry and replay protection remain separate. */
export const verifyOtp = (otp: string, hash: string) =>
  timingSafeEqualText(hashOtp(otp), hash);
