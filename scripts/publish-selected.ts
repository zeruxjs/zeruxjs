#!/usr/bin/env node
/** Explicit terminal-owned manual publication; importing helpers never authorizes registry writes. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { npmCommand } from './npm-command.ts';
import { inspectNpmSession } from './npm-publish-session.ts';
import { discoverWorkspaces, planWorkspaces } from './workspace-graph.ts';
import {
  parseSelectedPublish,
  packageName,
  publishSelected,
  type SelectedPackage,
  type RegistryIdentity,
  type PackedRelease,
} from './selected-publish.ts';

/** Fixed public registry; neither flags nor package metadata can supply another upload endpoint. */
const registry = 'https://registry.npmjs.org/';
/** Source-owned repository identity, independent of the caller's working directory. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run a literal subprocess with inherited terminal support and actual-close cleanup.
 * @param {string} command - Trusted executable, never interpolated into a shell.
 * @param {string[]} args - Literal arguments.
 * @param {string} cwd - Validated repository or package directory.
 * @param {AbortSignal} signal - Cancellation stops this operation; unknown uploads are not retried.
 * @param {boolean} capture - Capture bounded stdout only for noninteractive operations.
 * @param {number} timeoutMs - Finite operation budget, default ten minutes.
 * @returns {Promise<{code:number|null;output:string}>} Exit receipt; callers must check nonzero status.
 */
export function releaseProcess(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  capture = false,
  timeoutMs = 600_000
): Promise<{ code: number | null; output: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    /** Captured commands never handle authentication; interactive commands inherit the real TTY. */
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: false,
      detached: capture && process.platform !== 'win32',
    });
    /** Retained output is bounded to two MiB and never written to a release report. */
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    /** Terminate the child, then wait for close; detached noninteractive descendants share its group.
     * @returns {void} Native process termination request, not an upload rollback receipt.
     */
    const stop = () => {
      if (escalation) {
        return;
      }
      /** Signal only this operation's child/process group.
       * @param {NodeJS.Signals} kind - Graceful or final termination signal.
       * @returns {void} Native termination request; actual close still settles the operation.
       */
      const kill = (kind: NodeJS.Signals) => {
        try {
          if (capture && process.platform !== 'win32' && child.pid) {
            process.kill(-child.pid, kind);
          } else {
            child.kill(kind);
          }
        } catch {
          /* Already closed child; close remains the settlement owner. */
        }
      };
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 5000);
    };
    /** A timeout during upload leaves registry acceptance uncertain. */
    const timer = setTimeout(() => {
      failure = new Error('Release subprocess deadline exceeded');
      stop();
    }, timeoutMs);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) {
      stop();
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2_097_152) {
        failure = new Error('Release subprocess output limit');
        stop();
        return;
      }
      chunks.push(chunk);
    });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal.removeEventListener('abort', stop);
      if (signal.aborted) {
        reject(signal.reason);
      } else if (failure) {
        reject(failure);
      } else {
        resolve({ code, output: Buffer.concat(chunks).toString('utf8') });
      }
    });
  });
}
/** Read bounded exact-version public metadata without following registry redirects.
 * @param {SelectedPackage} item - Exact validated identity.
 * @param {AbortSignal} signal - Abort current body reading and future requests.
 * @returns {Promise<RegistryIdentity|undefined>} Valid identity or genuine missing-version 404.
 */
export async function lookupRelease(
  item: SelectedPackage,
  signal: AbortSignal
): Promise<RegistryIdentity | undefined> {
  /** Every request/body owns a finite deadline even inside the longer propagation window. */
  const response = await fetch(
    `${registry}${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}`,
    {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    }
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Public npm registry lookup unavailable');
  }
  /** Read public metadata only; no authentication session is exposed to this code. */
  const reader = response.body.getReader();
  /** Large registry bodies fail before JSON parsing. */
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      /** Await one bounded native Web Stream chunk. */
      const part = await reader.read();
      if (part.done) {
        break;
      }
      bytes += part.value.byteLength;
      if (bytes > 1_048_576) {
        throw new Error('Registry metadata exceeds release budget');
      }
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  /** Validate identities instead of interpreting any successful JSON as publication. */
  const metadata = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    name?: unknown;
    version?: unknown;
    dist?: { integrity?: unknown };
  };
  if (metadata.name !== item.name || metadata.version !== item.version) {
    throw new Error('Registry returned a different package identity');
  }
  return {
    name: item.name,
    version: item.version,
    integrity:
      typeof metadata.dist?.integrity === 'string'
        ? metadata.dist.integrity
        : undefined,
  };
}
/** Resolve only real repository packages; reject applications, aliases, symlinks and private examples.
 * @param {string[]} names - Exact user selections.
 * @returns {object} Complete package build scopes and dependency-ordered selected records.
 */
function releaseSelection(names: string[]) {
  /** Existing discovery and dependency planning remain the single workspace graph owner. */
  const entries = discoverWorkspaces(root);
  /** Only packages/ is built; sample-packages and applications are not release build targets. */
  const scopes: string[] = [];
  for (const [name, entry] of entries) {
    /** Path membership is checked before relying on copied manifest names. */
    const relative = path.relative(path.join(root, 'packages'), entry.dir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    if (
      fs.realpathSync(entry.dir) !== entry.dir ||
      fs.lstatSync(path.join(entry.dir, 'package.json')).isSymbolicLink()
    ) {
      throw new Error('Symlinked release package rejected');
    }
    scopes.push(name);
  }
  for (const name of names) {
    /** A package must be explicitly present, public and publishable under its actual npm name. */
    const entry = entries.get(name);
    if (!entry || !scopes.includes(name) || entry.pkg.private === true) {
      throw new Error(`${name}: not a public repository package`);
    }
    packageName(entry.pkg.name);
    if (
      entry.pkg.publishConfig?.access !== undefined &&
      entry.pkg.publishConfig.access !== 'public'
    ) {
      throw new Error(
        'Selected package does not explicitly permit public publication'
      );
    }
    if (
      entry.pkg.publishConfig &&
      Object.keys(entry.pkg.publishConfig).some(
        (key) => !['access', 'registry'].includes(key)
      )
    ) {
      throw new Error(
        'Manual publishing supports only public access and official-registry publishConfig; review additional release settings separately'
      );
    }
    if (
      typeof entry.pkg.version !== 'string' ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(
        entry.pkg.version
      ) ||
      entry.pkg.version.length > 128
    ) {
      throw new Error('Invalid release version');
    }
    if (
      entry.pkg.publishConfig?.registry &&
      new URL(entry.pkg.publishConfig.registry).href !== registry
    ) {
      throw new Error(
        'Package publication registry conflicts with official npm'
      );
    }
  }
  /** Existing cycle/finalization handling supplies dependency order without publishing implicit dependencies. */
  const plan = planWorkspaces(entries, { scopes: names, requireBuild: false });
  return {
    scopes,
    items: plan.ordered
      .filter((name: string) => names.includes(name))
      .map(
        (name: string): SelectedPackage => ({
          name,
          version: entries.get(name).pkg.version,
          dir: entries.get(name).dir,
        })
      ),
  };
}
/** Build, publish, poll and authorize only explicitly selected packages.
 * @param {string[]} args - Literal repeated -p selections and optional plan/deadline flags.
 * @returns {Promise<void>} Complete verified release or an actionable failure; never bumps versions.
 */
export async function runSelectedPublish(args: string[]): Promise<void> {
  /** Help and dry-run must not acquire credentials, locks or output resources. */
  const options = parseSelectedPublish(args);
  if (options.help) {
    console.log(
      'npm run publish -- -p @zeruxjs/docs -p zuixs [--dry-run] [--timeout-ms 900000]\nBuilds every package, publishes only selections, polls every 15s and verifies all three trusted-publisher permissions. Interactive terminal required. Existing versions are never overwritten.'
    );
    return;
  }
  /** All names are validated before builds or authentication start. */
  const selection = releaseSelection(options.names);
  console.log(
    `[publish] Plan: build ${selection.scopes.length} packages; release ${selection.items.map((item) => item.name + '@' + item.version).join(', ')}`
  );
  if (options.dryRun) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Use a real terminal for npm browser/2FA verification; do not pipe or redirect this command'
    );
  }
  /** Resolve npm once, preserving the user's installed/session-owning CLI. */
  const npm = npmCommand([]);
  if (npm.command !== process.execPath || !npm.args[0]) {
    throw new Error('Cannot resolve npm-cli.js; run through npm run publish');
  }
  inspectNpmSession(npm.args[0]);
  /** A private process-local directory owns immutable archives until final settlement. */
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerux-publish-'));
  /** Existing release tooling uses this ignored directory; no report or credential is written. */
  const lockDirectory = path.join(root, '.npm-release');
  let lock: Awaited<ReturnType<typeof fsp.open>> | undefined;
  /** SIGINT/SIGTERM stop new uploads and cancel current waits; no automatic upload replay occurs. */
  const controller = new AbortController();
  /** Native signal ownership is limited to this invocation.
   * @returns {void} Cancel accepted local work without claiming registry rollback.
   */
  const cancel = () =>
    controller.abort(
      new Error(
        'Release interrupted; registry outcomes may be uncertain. Rerun to inspect.'
      )
    );
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    await fsp.mkdir(lockDirectory, { recursive: true });
    if ((await fsp.lstat(lockDirectory)).isSymbolicLink()) {
      throw new Error('Unsafe release lock directory');
    }
    lock = await fsp.open(
      path.join(lockDirectory, 'manual-publish.lock'),
      'wx',
      0o600
    );
    await lock.writeFile(String(process.pid));
    /** Every npm operation is shell-free and scoped to the official registry.
     * @param {string[]} callArgs - Trusted literal npm arguments.
     * @param {string} cwd - Repository or selected package directory.
     * @param {AbortSignal} signal - Parent interruption signal.
     * @param {boolean} [capture] - Capture only noninteractive machine-readable output.
     * @param {number} [timeoutMs] - Operation budget in milliseconds.
     * @returns {Promise<{code:number|null;output:string}>} Actual child exit receipt.
     */
    const invoke = (
      callArgs: string[],
      cwd: string,
      signal: AbortSignal,
      capture = false,
      timeoutMs = 600_000
    ) =>
      releaseProcess(
        npm.command,
        [...npm.args, ...callArgs],
        cwd,
        signal,
        capture,
        timeoutMs
      );
    await publishSelected(
      selection.items,
      {
        build: async (signal) => {
          /** All package scopes, with existing dependency ordering and post-build export verification. */
          const result = await invoke(
            [
              'run',
              'build:scope',
              '--',
              '--verify',
              ...selection.scopes.flatMap((name) => ['--scope', name]),
            ],
            root,
            signal,
            false,
            3_600_000
          );
          if (result.code !== 0) {
            throw new Error('Package build failed; nothing was published');
          }
          // Scope registry settings take precedence inside npm; reject a conflicting destination before authentication/upload.
          for (const scope of new Set(
            selection.items
              .filter((item) => item.name.startsWith('@'))
              .map((item) => item.name.split('/')[0]!)
          )) {
            /** Query only the public endpoint setting, never credential-related configuration keys. */
            const scoped = await invoke(
              ['config', 'get', scope + ':registry'],
              root,
              signal,
              true,
              30_000
            );
            if (
              scoped.code !== 0 ||
              ![
                'undefined',
                'null',
                '',
                registry,
                registry.slice(0, -1),
              ].includes(scoped.output.trim())
            ) {
              throw new Error(
                'Scoped npm registry conflicts with the official public release destination'
              );
            }
          }
          /** Native login is deferred until builds succeed and owns browser/OTP prompts itself. */
          const session = await invoke(
            ['whoami', '--registry=' + registry],
            root,
            signal,
            true,
            30_000
          );
          if (session.code !== 0) {
            /** The operator authenticates in their browser; no token is requested or parsed here. */
            const login = await invoke(
              ['login', '--auth-type=web', '--registry=' + registry],
              root,
              signal
            );
            if (login.code !== 0) {
              throw new Error('npm login did not complete');
            }
          }
        },
        lookup: lookupRelease,
        pack: async (item, signal) => {
          /** Detect concurrent version/name edits before selecting archive bytes. */
          const current = JSON.parse(
            await fsp.readFile(path.join(item.dir, 'package.json'), 'utf8')
          );
          if (
            current.name !== item.name ||
            current.version !== item.version ||
            current.private === true
          ) {
            throw new Error('Selected package manifest changed during release');
          }
          /** Prepack hooks run normally, including private Stylelint bundle preparation/integrity hooks. */
          const packed = await invoke(
            ['pack', '--json', '--pack-destination', temporary],
            item.dir,
            signal,
            true
          );
          if (packed.code !== 0) {
            throw new Error(`${item.name}: npm pack failed`);
          }
          /** npm versions return an array or a name-keyed workspace object. */
          const output: unknown = JSON.parse(packed.output);
          /** Exactly one record is required; never select an arbitrary workspace archive. */
          const records = Array.isArray(output)
            ? output
            : Object.values(output as Record<string, unknown>);
          if (records.length !== 1) {
            throw new Error('Unexpected package archive count');
          }
          /** Native npm's archive identity is still validated before resolving a local path. */
          const record = records[0] as {
            name?: unknown;
            version?: unknown;
            filename?: unknown;
          };
          if (
            record.name !== item.name ||
            record.version !== item.version ||
            typeof record.filename !== 'string' ||
            path.basename(record.filename) !== record.filename ||
            !record.filename.endsWith('.tgz')
          ) {
            throw new Error('Unexpected packed archive identity');
          }
          /** Private staging prevents other users replacing the artifact before upload. */
          const file = path.join(temporary, record.filename);
          /** Hash only a bounded regular local archive, never symlinks or remote addresses. */
          const stat = await fsp.lstat(file);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size > 268_435_456
          ) {
            throw new Error('Invalid release archive');
          }
          /** Streaming hash avoids buffering a large archive just for integrity verification. */
          const hash = crypto.createHash('sha512');
          for await (const chunk of fs.createReadStream(file, { signal })) {
            hash.update(chunk);
          }
          return {
            file,
            integrity: 'sha512-' + hash.digest('base64'),
          } satisfies PackedRelease;
        },
        publish: async (item, archive, signal) => {
          try {
            /** Packed archives cannot execute a second set of package lifecycle scripts during upload. */
            const result = await invoke(
              [
                'publish',
                archive.file,
                '--ignore-scripts',
                '--access=public',
                '--registry=' + registry,
                '--auth-type=web',
              ],
              root,
              signal
            );
            return result.code === 0;
          } catch {
            signal.throwIfAborted();
            return false;
          }
        },
        trust: async (item, signal) => {
          /** Dedicated child retains a real terminal for native npm browser prompts; no installation is patched. */
          const result = await releaseProcess(
            process.execPath,
            [
              '--experimental-strip-types',
              fileURLToPath(
                new URL('./npm-publish-session.ts', import.meta.url)
              ),
              npm.args[0]!,
              item.name,
            ],
            root,
            signal
          );
          if (result.code !== 0) {
            throw new Error(
              `${item.name}: version exists but publisher setup is incomplete; rerun after resolving the npm diagnostic`
            );
          }
        },
        wait: async (milliseconds, signal) => {
          await delay(milliseconds, undefined, { signal });
        },
        now: () => performance.now(),
        log: (message) => console.log('[publish] ' + message),
      },
      controller.signal,
      options.timeoutMs
    );
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    try {
      if (lock) {
        await lock.close();
        await fsp.unlink(path.join(lockDirectory, 'manual-publish.lock'));
      }
    } finally {
      await fsp.rm(temporary, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runSelectedPublish(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[publish] ${error instanceof Error ? error.message : 'Manual release failed'}`
    );
    process.exitCode = 1;
  }
}
