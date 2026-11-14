import {
  readSync,
  realpathSync,
  openSync,
  fstatSync,
  closeSync,
  constants,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { resolvePluginEntry } from './plugins.js';
import type { CommandRegistry } from './commands.js';
import { ResourceScope, type Disposer } from './lifecycle.js';
/** Trusted explicit registration context; schemas and path checks are not execution sandboxing. */
export interface PluginContext {
  /** Staging registry usable only during trusted plugin registration. */
  commands: CommandRegistry;
  /** Optional host keyword hint; no caller role or authorization claim. */
  keyword?: string;
  /** Owned plugin lifetime signal; commands must cooperate and retain their promise until done. */
  signal: AbortSignal;
  /** Transfer resource cleanup into the plugin lifetime before awaiting more work. */
  onDispose: (dispose: Disposer) => void;
}
/** Host cancellation policy for explicit plugin activation. */
export interface PluginLoadOptions {
  /** Owned plugin lifetime signal; commands must cooperate and retain their promise until done. */
  signal?: AbortSignal;
}
/** Owned plugin registration and lifetime; callers must await dispose. */
export interface LoadedPlugin {
  /** Explicit validated configured package name. */
  name: string;
  /** Canonical explicit module URL retained for operator inspection. */
  entry: string;
  /** Plugin lifetime used by owned command invocations; abort is cooperative. */
  signal: AbortSignal;
  /** Abort active commands, remove registrations, await cooperative completion and cleanup. */ dispose: () => Promise<void>;
}
/** Read bounded manifest JSON through an owned descriptor without executing a package.
 * @param {string} file - Trusted selected manifest path.
 * @returns {Record<string, unknown>} Parsed object metadata; closes its descriptor before returning or throwing.
 */
function readManifest(file: string): Record<string, unknown> {
  /** Owned no-follow nonblocking manifest descriptor; finally closes it on parse/read failure. */
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  let raw;
  try {
    /** Regular-file metadata bounded before allocating the manifest read buffer. */
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 256 * 1024) {
      throw new Error('Plugin manifest too large');
    }
    /** Bounded manifest buffer with one extra byte detecting growth during reading. */
    const buffer = Buffer.alloc(info.size + 1);
    /** Actual bytes read; a grown manifest rejects before parsing. */
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    if (size > info.size) {
      throw new Error('Plugin manifest changed');
    }
    raw = JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally {
    closeSync(fd);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Invalid package.json');
  }
  return raw as Record<string, unknown>;
}
/** Locate manifests even when package.json is blocked by the exports map.
 * @param {string} name - Explicit allowlisted package name.
 * @param {ReturnType<typeof createRequire>} require - Borrowed host-scoped resolver.
 * @returns {string} Matching installed manifest path; never imports discovered ancestors.
 */
function locateManifest(
  name: string,
  require: ReturnType<typeof createRequire>
): string {
  try {
    return require.resolve(`${name}/package.json`);
  } catch (error) {
    /** Explicit trusted module entry or public package entry used for manifest resolution. */
    const entry = require.resolve(name);
    let cursor = dirname(realpathSync(entry));
    while (true) {
      /** Local manifest candidate inspected as JSON without importing its package code. */
      const candidate = join(cursor, 'package.json');
      try {
        if (readManifest(candidate).name === name) {
          return candidate;
        }
      } catch {
        /* This optional failure is intentionally ignored. */
      }
      /** Next ancestor; reaching the filesystem root terminates manifest discovery. */
      const parent = dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
    throw new Error(`Unable to locate package manifest for ${name}`);
  }
}
/** Plugin activation is opt-in; never execute every node_modules package.
 * @param {readonly string[]} specifiers - Explicit trusted package allowlist, validated before activation.
 * @param {CommandRegistry} registry - Borrowed live registry receiving staged command registrations.
 * @param {string} fromDirectory - Explicit host resolution directory.
 * @param {PluginLoadOptions} options - Borrowed cancellation policy; disposal still requires awaiting each owner.
 * @returns {Promise<LoadedPlugin[]>} Owned records; dispose each in the host's lifecycle, preferably in reverse order.
 */
export async function loadPlugins(
  specifiers: readonly string[],
  registry: CommandRegistry,
  fromDirectory = process.cwd(),
  options: PluginLoadOptions = {}
): Promise<LoadedPlugin[]> {
  if (!Array.isArray(specifiers) || specifiers.length > 100) {
    throw new TypeError('Plugin allowlist must contain at most 100 names');
  }
  if (
    !options ||
    typeof options !== 'object' ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  ) {
    throw new TypeError('Invalid plugin load options');
  }
  options.signal?.throwIfAborted();
  // Validate the complete allowlist before executing even its first entry.
  for (const name of specifiers) {
    if (
      typeof name !== 'string' ||
      name.length > 214 ||
      !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ||
      name.startsWith('.') ||
      name.includes('..')
    ) {
      throw new TypeError('Invalid plugin package');
    }
  }
  /** Resolver scoped to the explicit host directory, never a scan of installed packages. */
  const require = createRequire(join(resolve(fromDirectory), 'package.json'));
  /** Owned loaded plugin records accumulated for reverse rollback if a later activation fails. */
  const loaded: LoadedPlugin[] = [];
  /** Canonical explicit entry identities preventing duplicate activation within this batch. */
  const seen = new Set<string>();
  try {
    for (const name of specifiers) {
      options.signal?.throwIfAborted();
      /** Explicit configured package manifest; no directory scan is performed. */
      const manifest = locateManifest(name, require);
      /** Canonical owning package directory used to constrain its declared JavaScript entry. */
      const root = realpathSync(dirname(manifest));
      /** Parsed bounded package metadata checked against the explicit allowlisted name. */
      const pkg = readManifest(manifest);
      if (pkg.name !== name) {
        throw new Error(`Plugin package mismatch: ${name}`);
      }
      if (!pkg.zerux) {
        throw new Error(`No zerux entry for ${name}`);
      }
      /** Explicit trusted module entry or public package entry used for manifest resolution. */
      const entry = resolvePluginEntry(root, pkg.zerux);
      if (seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      /** Trusted explicitly selected module namespace; import-time effects cannot be rolled back. */
      const plugin = (await import(entry)) as {
        register?: (ctx: PluginContext) => unknown;
        default?: (ctx: PluginContext) => unknown;
      };
      options.signal?.throwIfAborted();
      /** Trusted explicit register/default callback; templates or model strings cannot replace it. */
      const register = plugin.register ?? plugin.default;
      if (typeof register !== 'function') {
        throw new Error(
          `Plugin ${name} does not export a registration function`
        );
      }
      /** Owned plugin lifetime; registrations transfer their resource cleanup here. */
      const scope = new ResourceScope([options.signal]);
      let remove: Disposer;
      try {
        remove = await registry.transaction(async (commands) => {
          /** Optional trusted disposer returned by registration and transferred into the plugin scope. */
          const dispose = await register({
            commands,
            signal: scope.signal,
            onDispose: scope.onDispose,
          });
          if (typeof dispose === 'function') {
            scope.onDispose(dispose as Disposer);
          }
        }, scope.signal);
      } catch (error) {
        /** Private cleanup failures retained alongside the original registration/load failure. */
        const errors = await scope.close();
        if (errors.length) {
          throw new AggregateError(
            [error, ...errors],
            'Plugin registration and cleanup failed',
            { cause: error }
          );
        }
        throw error;
      }
      let disposal: Promise<void> | undefined;
      loaded.push({
        name,
        entry,
        signal: scope.signal,
        dispose: () =>
          (disposal ??= (async () => {
            scope.abort();
            await remove();
            /** Private cleanup failures retained alongside the original registration/load failure. */
            const errors = await scope.close();
            if (errors.length) {
              throw new AggregateError(
                errors,
                'Plugin resource cleanup failed'
              );
            }
          })()),
      });
    }
    return loaded;
  } catch (error) {
    /** Private cleanup failures retained alongside the original registration/load failure. */
    const errors: unknown[] = [];
    for (const plugin of loaded.reverse()) {
      try {
        await plugin.dispose();
      } catch (failure) {
        errors.push(failure);
      }
    }
    if (errors.length) {
      throw new AggregateError(
        [error, ...errors],
        'Plugin loading and rollback failed',
        { cause: error }
      );
    }
    throw error;
  }
}
/** Explicit workspace configuration: package.json > zeruxCli > plugins.
 * @param {CommandRegistry} registry - Borrowed live registry for staged registrations.
 * @param {string} fromDirectory - Host project whose bounded manifest provides the explicit allowlist.
 * @param {PluginLoadOptions} options - Explicit cooperative cancellation policy.
 * @returns {Promise<LoadedPlugin[]>} Owned plugin disposal records; no configured section returns an empty list.
 */
export async function loadConfiguredPlugins(
  registry: CommandRegistry,
  fromDirectory = process.cwd(),
  options: PluginLoadOptions = {}
): Promise<LoadedPlugin[]> {
  /** Explicit configured package manifest; no directory scan is performed. */
  const manifest = readManifest(join(resolve(fromDirectory), 'package.json'));
  /** Explicit zeruxCli configuration; absent section activates no plugins. */
  const section = manifest.zeruxCli;
  if (section === undefined) {
    return [];
  }
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new TypeError('zeruxCli must be an object');
  }
  /** Validated explicit configured package list, bounded before module activation. */
  const names = (section as { plugins?: unknown }).plugins ?? [];
  if (
    !Array.isArray(names) ||
    names.length > 100 ||
    names.some((name) => typeof name !== 'string')
  ) {
    throw new TypeError('zeruxCli.plugins must contain package names');
  }
  return loadPlugins(names as string[], registry, fromDirectory, options);
}
