/** Narrow bridge to npm's installed interactive session/2FA owner; never reads or prints tokens. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  packageName,
  configurePublisher,
  PublisherSetupError,
} from './selected-publish.ts';

/** Fixed official registry; local npm configuration cannot redirect trust writes elsewhere. */
const registry = 'https://registry.npmjs.org/';
/** Reject foreign authentication challenges before npm can offer their browser links.
 * @param {unknown} error - Private native registry error, never logged verbatim.
 * @returns {void} Safe challenge or a generic rejection; credentials remain inside npm.
 */
export function validateNpmChallenge(error: unknown): void {
  /** Native npm authentication errors carry a small parsed challenge envelope. */
  const body = (
    error as { body?: { authUrl?: unknown; doneUrl?: unknown } } | null
  )?.body;
  if (!body?.authUrl && !body?.doneUrl) {
    return;
  }
  /** Both endpoints must belong to npm before handing the challenge to npm's opener. */
  const auth = new URL(String(body.authUrl));
  /** Completion receipts are polled only on the official registry endpoint. */
  const done = new URL(String(body.doneUrl));
  if (
    auth.origin !== 'https://www.npmjs.com' ||
    !auth.pathname.startsWith('/auth/cli/') ||
    done.origin !== 'https://registry.npmjs.org' ||
    done.pathname !== '/-/v1/done' ||
    auth.username ||
    auth.password ||
    done.username ||
    done.password
  ) {
    throw new PublisherSetupError('Untrusted npm authentication challenge');
  }
}
/** Validate the deliberately private native npm bridge before any release writes.
 * @param {string} cli - Installed npm-cli.js, never a registry-supplied executable.
 * @returns {object} Installed native npm constructor, authentication helper and registry request owner.
 */
export function inspectNpmSession(cli: string) {
  /** The installed npm distribution owns credential loading and interactive browser/OTP challenges. */
  const resolved = fs.realpathSync(cli);
  if (path.basename(resolved) !== 'npm-cli.js') {
    throw new PublisherSetupError('Cannot locate supported npm CLI');
  }
  /** Resolve npm's own bundled dependencies, not similarly named repository packages. */
  const requireNpm = createRequire(resolved);
  /** Installed distribution identity bounds this deliberately private compatibility bridge. */
  const npmRoot = path.dirname(path.dirname(resolved));
  /** No dependency code is downloaded or installed by this bridge. */
  const version = JSON.parse(
    fs.readFileSync(path.join(npmRoot, 'package.json'), 'utf8')
  ).version as string;
  if (!/^(?:11\.(?:1[5-9]|[2-9]\d)|12\.\d+)\./.test(version)) {
    throw new PublisherSetupError(
      'Interactive trust bridge requires npm 11.15+ or npm 12.x; review compatibility before newer majors'
    );
  }
  /** Internal constructors remain confined to this child; no installed source is patched. */
  const Npm = requireNpm(path.join(npmRoot, 'lib/npm.js'));
  /** Native npm helper owns web authentication and any manually entered OTP. */
  const { otplease } = requireNpm(path.join(npmRoot, 'lib/utils/auth.js'));
  /** Registry requests use the same credentials npm login manages. */
  const npmFetch = requireNpm('npm-registry-fetch');
  if (
    typeof Npm !== 'function' ||
    typeof otplease !== 'function' ||
    typeof npmFetch !== 'function'
  ) {
    throw new PublisherSetupError(
      'Installed npm interactive API is incompatible'
    );
  }
  return { Npm, otplease, npmFetch };
}
/** Inspect then create the exact trusted publisher through npm-owned session authentication.
 * @param {string} cli - Validated installed npm-cli.js path selected by the parent command.
 * @param {string} name - Exact selected public npm package name.
 * @returns {Promise<void>} Resolves only after a fresh registry read verifies all permissions.
 */
export async function ensureNpmPublisher(
  cli: string,
  name: string
): Promise<void> {
  packageName(name);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PublisherSetupError(
      'Trusted-publisher setup requires an interactive terminal'
    );
  }
  /** Compatibility is checked before creating the npm session or making requests. */
  const { Npm, otplease, npmFetch } = inspectNpmSession(cli);
  /** This process owns the loaded npm display, log and timer lifecycle. */
  const npm = new Npm({
    argv: ['--registry=' + registry, '--auth-type=web', 'trust'],
  });
  try {
    await npm.load();
    /** Request one bounded trust response through native npm authentication.
     * @param {'GET'|'POST'} method - Exact allowlisted registry operation.
     * @param {unknown} [body] - Inert trust configuration for POST only.
     * @returns {Promise<unknown[]>} Bounded parsed registry trust records; no credentials escape.
     */
    const request = async (
      method: 'GET' | 'POST',
      body?: unknown
    ): Promise<unknown[]> => {
      /** Return only bounded parsed trust records, never authentication credentials. */
      const response = await otplease(
        npm,
        npm.flatOptions,
        async (options: Record<string, unknown>) => {
          try {
            return await npmFetch(
              `/-/package/${encodeURIComponent(name)}/trust`,
              {
                ...options,
                registry,
                authType: 'web',
                npmCommand: 'trust',
                method,
                body,
                redirect: 'error',
                retry: { retries: 0 },
                timeout: 30_000,
              }
            );
          } catch (error) {
            validateNpmChallenge(error);
            throw error;
          }
        }
      );
      /** Registry trust configurations are small; abort oversized/changed responses before parsing. */
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          /** Native body chunks are bounded cumulatively before retaining them. */
          const data = Buffer.from(chunk);
          bytes += data.length;
          if (bytes > 262_144) {
            throw new PublisherSetupError('Oversized npm trust response');
          }
          chunks.push(data);
        }
      } finally {
        response.body?.destroy?.();
      }
      /** Unknown response shapes fail closed rather than implying missing permissions. */
      const records: unknown = JSON.parse(
        Buffer.concat(chunks).toString('utf8')
      );
      if (!Array.isArray(records) || records.length > 100) {
        throw new PublisherSetupError('Invalid npm trust response');
      }
      return records;
    };
    await configurePublisher(request);
    console.log(
      `[trust] ${name}: createPackage, createStagedPackage and manageDistTags verified`
    );
  } finally {
    npm.unload();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 4) {
      throw new PublisherSetupError(
        'Internal trust bridge expects npm CLI and exact package identity'
      );
    }
    await ensureNpmPublisher(process.argv[2]!, process.argv[3]!);
  } catch (error) {
    /** Native request bodies can contain private authentication state; emit only fixed/native error codes. */
    const code = (error as { code?: unknown })?.code;
    let message = 'NPM_TRUST_FAILED';
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) {
      message = code;
    } else if (error instanceof PublisherSetupError) {
      message = error.message;
    }
    console.error(`[trust] ${message}`);
    process.exitCode = 1;
  }
}
