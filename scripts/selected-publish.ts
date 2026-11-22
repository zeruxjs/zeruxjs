/** Explicit manual-release contracts; importing this module performs no I/O. */
export interface SelectedPackage {
  /** Exact public npm package name from the repository manifest. */
  name: string;
  /** Immutable version, never incremented by the release command. */
  version: string;
  /** Canonical repository-owned package directory. */
  dir: string;
}
export interface RegistryIdentity {
  /** Exact registry package identity. */
  name: string;
  /** Exact registry version. */
  version: string;
  /** Published archive integrity, required after an upload. */
  integrity?: string;
}
export interface PackedRelease {
  /** Owned local archive filename, never a URL supplied by the registry. */
  file: string;
  /** SHA-512 SRI of the bytes that will be uploaded. */
  integrity: string;
}
export interface ReleaseOperations {
  /** Build every package before acquiring archives or registry write credentials. */
  build(signal: AbortSignal): Promise<void>;
  /** Read exact public version metadata; only a real 404 returns undefined. */
  lookup(
    item: SelectedPackage,
    signal: AbortSignal
  ): Promise<RegistryIdentity | undefined>;
  /** Prepare an immutable archive with the package's normal prepack hooks. */
  pack(item: SelectedPackage, signal: AbortSignal): Promise<PackedRelease>;
  /** Upload once with interactive inherited terminal ownership; false is an uncertain outcome. */
  publish(
    item: SelectedPackage,
    archive: PackedRelease,
    signal: AbortSignal
  ): Promise<boolean>;
  /** Verify or create the exact host publisher with all three permissions. */
  trust(item: SelectedPackage, signal: AbortSignal): Promise<void>;
  /** Await a cancellable interval; tests inject a virtual clock. */
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
  /** Monotonic milliseconds for the publication visibility deadline. */
  now(): number;
  /** Emit fixed operational text without authentication output or registry bodies. */
  log(message: string): void;
}
/** Validated explicit command selection and finite polling budget. */
export interface SelectedPublishOptions {
  /** Unique requested names, bounded to 256. */
  names: string[];
  /** Public registry propagation budget per uploaded package, default 15 minutes. */
  timeoutMs: number;
  /** Plan only: no build, authentication, registry reads or writes. */
  dryRun: boolean;
  /** Display usage without acquiring resources. */
  help: boolean;
}
/** Validate a literal npm name before selection or URL construction.
 * @param {unknown} value - Requested name, never a version spec or filesystem path.
 * @returns {string} Validated scoped or unscoped public identity.
 */
export function packageName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 214 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
  ) {
    throw new TypeError('Expected an exact npm package name');
  }
  return value;
}
/** Parse repeatable package flags without shell interpolation or version mutation.
 * @param {string[]} args - Forwarded arguments after npm run publish --.
 * @returns {SelectedPublishOptions} Validated names, help/plan policy and deadline.
 */
export function parseSelectedPublish(args: string[]): SelectedPublishOptions {
  /** Selection is deduplicated without changing the user's declared order. */
  const options: SelectedPublishOptions = {
    names: [],
    timeoutMs: 900_000,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < args.length; index++) {
    /** Each flag owns exactly its declared following value. */
    const flag = args[index];
    if (flag === '-p' || flag === '--package') {
      options.names.push(packageName(args[++index]));
    } else if (flag === '--timeout-ms') {
      /** Integer-only syntax rejects coercion, fractions and omitted values. */
      const value = args[++index];
      if (!value || !/^[0-9]+$/.test(value)) {
        throw new TypeError('Invalid --timeout-ms');
      }
      options.timeoutMs = Number(value);
      if (
        !Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs < 15_000 ||
        options.timeoutMs > 3_600_000
      ) {
        throw new RangeError('Publication timeout must be 15000–3600000ms');
      }
    } else if (flag === '--dry-run') {
      options.dryRun = true;
    } else if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else {
      throw new TypeError(
        'Unknown release option; use npm run publish -- --help'
      );
    }
  }
  if (options.names.length > 256 || (!options.help && !options.names.length)) {
    throw new RangeError('Select 1–256 packages with repeated -p flags');
  }
  options.names = [...new Set(options.names)];
  return options;
}
/** Verify registry identity and, after upload, the exact archive bytes.
 * @param {SelectedPackage} item - Requested immutable package/version.
 * @param {RegistryIdentity} identity - Public registry evidence.
 * @param {string} [integrity] - Expected SHA-512 SRI for a newly uploaded archive.
 * @returns {void} Matching evidence or an explicit failure before trust setup.
 */
function assertPublication(
  item: SelectedPackage,
  identity: RegistryIdentity,
  integrity?: string
): void {
  if (identity.name !== item.name || identity.version !== item.version) {
    throw new Error('Registry identity mismatch');
  }
  if (integrity !== undefined && identity.integrity !== integrity) {
    throw new Error(
      `${item.name}: published archive integrity mismatch; trust setup stopped`
    );
  }
}
/** Run sequential explicit releases, retaining unknown upload outcomes without replay.
 * @param {SelectedPackage[]} items - Validated dependency-ordered public packages.
 * @param {ReleaseOperations} operations - Host-owned build, npm, registry and authentication boundaries.
 * @param {AbortSignal} signal - Cancellation prevents further writes and stops polling.
 * @param {number} timeoutMs - Finite per-package registry visibility budget in milliseconds.
 * @returns {Promise<void>} Completion only after every exact version and publisher is verified.
 */
export async function publishSelected(
  items: SelectedPackage[],
  operations: ReleaseOperations,
  signal: AbortSignal,
  timeoutMs: number
): Promise<void> {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 15_000 ||
    timeoutMs > 3_600_000 ||
    !Array.isArray(items) ||
    !items.length ||
    items.length > 256
  ) {
    throw new RangeError('Invalid release selection or polling budget');
  }
  signal.throwIfAborted();
  await operations.build(signal);
  for (const item of items) {
    signal.throwIfAborted();
    /** Initial outages are failures, never evidence that a version is available to overwrite. */
    const existing = await operations.lookup(item, signal);
    if (existing) {
      assertPublication(item, existing);
      operations.log(
        `${item.name}@${item.version}: already published; local changes are not uploaded`
      );
    } else {
      /** Packing precedes upload so subsequent verification refers to exact immutable bytes. */
      const archive = await operations.pack(item, signal);
      /** Never repeat an upload just because npm's final acknowledgement was lost. */
      const acknowledged = await operations.publish(item, archive, signal);
      operations.log(
        `${item.name}@${item.version}: ${acknowledged ? 'upload accepted' : 'upload outcome uncertain'}; verifying registry`
      );
      /** Propagation may take minutes; reads retry, writes do not. */
      const deadline = operations.now() + timeoutMs;
      while (true) {
        signal.throwIfAborted();
        let identity: RegistryIdentity | undefined;
        try {
          identity = await operations.lookup(item, signal);
        } catch {
          signal.throwIfAborted();
          operations.log(
            'Registry temporarily unavailable; verification remains pending'
          );
        }
        if (identity) {
          assertPublication(item, identity, archive.integrity);
          break;
        }
        /** A finite deadline avoids a permanently hung release on rejection or outage. */
        const remaining = deadline - operations.now();
        if (remaining <= 0) {
          throw new Error(
            `${item.name}@${item.version}: publication unconfirmed; rerun to inspect before uploading again`
          );
        }
        operations.log(
          `${item.name}@${item.version}: waiting for publication (15-second polling)`
        );
        await operations.wait(Math.min(15_000, remaining), signal);
      }
    }
    signal.throwIfAborted();
    await operations.trust(item, signal);
    operations.log(
      `${item.name}@${item.version}: published version and all three publisher permissions verified`
    );
  }
}
/** Required independent registry permissions; never inferred from a successful publish. */
export const TRUST_PERMISSIONS = Object.freeze([
  'createPackage',
  'createStagedPackage',
  'manageDistTags',
]);
/** Fixed source identity matches the existing GitHub publishing workflow, which has no environment. */
export const TRUST_REPOSITORY = 'zeruxjs/zeruxjs';
/** Only this real workflow receives manual setup authorization. */
export const TRUST_WORKFLOW = 'package-publish.yml';
/** Match one exact environment-free publisher without granting an unrelated workflow access.
 * @param {unknown} value - Registry-owned configuration candidate.
 * @returns {boolean} Whether repository, workflow, provider and environment match exactly.
 */
export function matchesPublisher(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  /** JSON response fields stay unknown until individually checked. */
  const config = value as {
    type?: unknown;
    claims?: {
      repository?: unknown;
      workflow_ref?: { file?: unknown };
      environment?: unknown;
    };
  };
  return (
    config.type === 'github' &&
    config.claims?.repository === TRUST_REPOSITORY &&
    config.claims.workflow_ref?.file === TRUST_WORKFLOW &&
    config.claims.environment === undefined
  );
}
/** Check all permissions independently rather than trusting cached browser approval.
 * @param {unknown} value - Registry-owned publisher record.
 * @returns {boolean} Exact publisher identity with all three required permissions.
 */
export function verifiedPublisher(value: unknown): boolean {
  if (!matchesPublisher(value)) {
    return false;
  }
  /** No secret values are present in this permission inventory. */
  const permissions = (value as { permissions?: unknown }).permissions;
  return (
    Array.isArray(permissions) &&
    TRUST_PERMISSIONS.every((permission) => permissions.includes(permission))
  );
}

/** Fixed actionable setup diagnostics are safe to display; native authentication errors remain private. */
export class PublisherSetupError extends Error {}

/** Inspect/create/read back one exact publisher without revoking any existing connection.
 * @param {(method:'GET'|'POST',body?:unknown)=>Promise<unknown[]>} request - npm-session-owned authenticated request; POST retries are forbidden except native 2FA challenges.
 * @returns {Promise<void>} Fresh registry evidence of all three independently granted permissions.
 */
export async function configurePublisher(
  request: (method: 'GET' | 'POST', body?: unknown) => Promise<unknown[]>
): Promise<void> {
  /** A five-minute browser approval does not replace this fresh permission check. */
  const before = await request('GET');
  if (before.some(verifiedPublisher)) {
    return;
  }
  if (before.some(matchesPublisher)) {
    throw new PublisherSetupError(
      'Matching publisher lacks permissions; update/recreate that connection in npm settings, then rerun. No existing publisher was revoked'
    );
  }
  await request('POST', [
    {
      type: 'github',
      claims: {
        repository: TRUST_REPOSITORY,
        workflow_ref: { file: TRUST_WORKFLOW },
      },
      permissions: [...TRUST_PERMISSIONS],
    },
  ]);
  /** A successful POST/browser approval alone is not proof of the saved capabilities. */
  const after = await request('GET');
  if (!after.some(verifiedPublisher)) {
    throw new PublisherSetupError(
      'Trusted-publisher verification failed; rerun inspection before changing permissions'
    );
  }
}
