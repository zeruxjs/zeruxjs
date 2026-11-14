import fs from 'node:fs';
import path from 'node:path';
import { resolveLimits } from './safety.js';
import {
  createProjectScanner,
  buildFromFiles,
  buildStylesheetFromFiles,
  outputPath,
} from './node-build.js';
import type { ZuixConfig, GenerateResult } from './types.js';

export interface ZuixWatchOptions {
  /** Project-relative directory roots; default ['.']. Scheduling identity alone is shared. */
  roots?: readonly string[];
  /** Project-relative path prefixes, never glob evaluation. */
  ignored?: readonly string[];
  /** Build scheduling debounce in integer milliseconds, default sixty. */
  debounceMs?: number;
  /** Periodic scan interval in integer milliseconds, default five hundred. */
  pollIntervalMs?: number;
  /** Explicitly suppress native notifications while keeping polling. */
  pollingOnly?: boolean;
  /** Maximum directory entries per shared zlook scan. */
  maxEntries?: number;
  /** Maximum retained scan changes; overflow requests full reconciliation. */
  maxPendingEvents?: number;
  /** Host cancellation closing this watch owner independently. */
  signal?: AbortSignal;
  /** Optional trusted authored CSS entry relative to the project root. */
  input?: string;
  /** Declared trusted config path watched for explicit reloads. */
  configFile?: string;
  /** Trusted configuration loader, invoked only after that declared file changes. */
  loadConfig?: (context: {
    /** Host cancellation closing this watch owner independently. */
    signal: AbortSignal;
  }) => Promise<ZuixConfig>;
  /** Bounded loader invocations, default128; recreate after exhaustion. */
  maxConfigReloads?: number;
}
/** Callable legacy disposer, with explicit awaitable startup/drain and host-driven reload. */
export interface ZuixWatchHandle {
  (): void;
  /** Startup and post-baseline reconciliation completion. */
  readonly ready: Promise<void>;
  /** Actual subscription/config-loader/build drain after disposal. */
  readonly closed: Promise<void>;
  /** Request full reconciliation after watcher readiness without growing the internal work queue.
   * @returns {Promise<void>} Owned reconciliation completion.
   */
  flush(): Promise<void>;
  /** Stage an explicit trusted config candidate before activating it.
   * @param {ZuixConfig} config - Application-owned next configuration.
   * @returns {Promise<void>} Commit/activation completion; failure preserves prior active config.
   */
  reload(config: ZuixConfig): Promise<void>;
}

/** Copy bounded plain configuration data while borrowing explicitly trusted plugin functions.
 * @param {T} value - Application configuration; accessors and prototype mutation keys reject.
 * @returns {T} Frozen data copy with borrowed function closures.
 */
function snapshot<T>(value: T): T {
  let count = 0;
  /** Clone bounded plain config data while retaining explicitly trusted function references.
   * @param {unknown} input - Current config node.
   * @param {number} depth - Current nesting depth.
   * @returns {unknown} Frozen copy, or a declared validation error.
   */
  const copy = (input: unknown, depth: number): unknown => {
    if (++count > 100000 || depth > 24) {
      throw new Error('zuix: configuration bounds exceeded');
    }
    if (input === null || typeof input !== 'object') {
      return input;
    }
    if (
      !Array.isArray(input) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
      throw new Error('zuix: configuration must be plain data/functions');
    }
    /** Fresh array/plain record; accessors and dangerous property names reject before copying. */
    const result: Record<string, unknown> | unknown[] = Array.isArray(input)
      ? []
      : Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(input)
    )) {
      if (key === 'length' && Array.isArray(input)) {
        continue;
      }
      if (
        !Object.hasOwn(descriptor, 'value') ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        throw new Error('zuix: invalid configuration property');
      }
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
      });
    }
    return Object.freeze(result);
  };
  return copy(value, 0) as T;
}

/** Own explicit optional-zlook source subscriptions; initial build stays synchronous and closed drains actual owned work.
 * @param {string} root - Existing trusted project directory.
 * @param {ZuixConfig} initial - Initial trusted compiler/scanner configuration.
 * @param {(result: GenerateResult) => void} onBuild - Postcommit observer; its failure does not roll back committed CSS.
 * @param {(error: unknown) => void} onError - Private failure observer isolated from internal cleanup.
 * @param {ZuixWatchOptions} options - Explicit roots, resource limits, cancellation and trusted config loader.
 * @returns {ZuixWatchHandle} Callable disposer with ready, closed, flush and reload contracts.
 */
export function watchZuix(
  root = process.cwd(),
  initial: ZuixConfig = {},
  onBuild?: (result: GenerateResult) => void,
  onError?: (error: unknown) => void,
  options: ZuixWatchOptions = {}
): ZuixWatchHandle {
  /** Canonical existing trusted project directory owning this subscription. */
  const absolute = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(absolute).isDirectory()) {
    throw new Error('zuix: watch root must be a directory');
  }
  if (
    (options.roots !== undefined && !Array.isArray(options.roots)) ||
    (options.ignored !== undefined && !Array.isArray(options.ignored))
  ) {
    throw new Error('zuix: invalid watch roots/ignores');
  }
  /** Snapshotted watch settings with independent root/ignore arrays. */
  const settings = {
    ...options,
    roots: [...(options.roots ?? ['.'])],
    ignored: [...(options.ignored ?? [])],
  };
  if (
    !settings.roots.length ||
    settings.roots.length > 32 ||
    settings.ignored.length > 128
  ) {
    throw new Error('zuix: invalid watch roots/ignores');
  }
  /** Validated build scheduling debounce, distinct from shared scan identity. */
  const debounce = settings.debounceMs ?? 60;
  /** Validated periodic source reconciliation interval. */
  const poll = settings.pollIntervalMs ?? 500;
  /** Finite configuration-module reload allowance before recreating this owner. */
  const reloadLimit = settings.maxConfigReloads ?? 128;
  if (
    !Number.isInteger(debounce) ||
    debounce < 0 ||
    debounce > 600000 ||
    !Number.isInteger(poll) ||
    poll < 100 ||
    poll > 600000 ||
    !Number.isInteger(reloadLimit) ||
    reloadLimit < 1 ||
    reloadLimit > 1024
  ) {
    throw new Error('zuix: invalid watch scheduling limits');
  }
  for (const [name, maximum] of [
    ['maxEntries', 1000000],
    ['maxPendingEvents', 100000],
  ] as const) {
    /** Optional explicit resource ceiling, validated before watcher startup. */
    const value = settings[name];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 1 || value > maximum)
    ) {
      throw new Error('zuix: invalid watch resource limit');
    }
  }
  if (
    settings.pollingOnly !== undefined &&
    typeof settings.pollingOnly !== 'boolean'
  ) {
    throw new Error('zuix: invalid pollingOnly');
  }
  if (
    settings.signal !== undefined &&
    !(settings.signal instanceof AbortSignal)
  ) {
    throw new Error('zuix: invalid watch signal');
  }
  if (
    settings.loadConfig !== undefined &&
    typeof settings.loadConfig !== 'function'
  ) {
    throw new Error('zuix: invalid config loader');
  }
  if (Boolean(settings.configFile) !== Boolean(settings.loadConfig)) {
    throw new Error(
      'zuix: configFile and loadConfig must be supplied together'
    );
  }
  /** Resolve only existing project roots or contained configuration/output paths.
   * @param {string} name - Project-relative path or dot for the root.
   * @returns {string} Validated absolute path.
   */
  const resolve = (name: string) =>
    name === '.' ? absolute : outputPath(absolute, name);
  /** Unique explicit existing directories subscribed through zlook. */
  const roots = [...new Set(settings.roots.map((name) => resolve(name)))];
  for (const location of roots) {
    if (!fs.statSync(location).isDirectory()) {
      throw new Error('zuix: watch roots must be existing directories');
    }
  }
  /** Project-relative ignored prefixes resolved independently for this subscriber. */
  const ignored = settings.ignored.map((name) => resolve(name));
  /** Optional declared config file; only this file can trigger the trusted loader. */
  const configPath = settings.configFile
    ? resolve(settings.configFile)
    : undefined;
  /** Optional authored CSS entry that must be covered by a declared watch root. */
  const input = settings.input ? resolve(settings.input) : undefined;
  for (const file of [configPath, input]) {
    if (file && !roots.some((dir) => file.startsWith(dir + path.sep))) {
      throw new Error('zuix: config/input must be covered by watch roots');
    }
  }
  let config = snapshot(initial),
    scanner = createProjectScanner(absolute, config),
    previous = '',
    closed = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  let work: Promise<void> = Promise.resolve(),
    reloads = 0,
    configDirty = false;
  /** Owner cancellation for watcher subscriptions and cooperative config loading. */
  const controller = new AbortController();
  /** Owned zlook subscriptions, closed before draining configuration/build work. */
  const handles: import('zlook').WatchHandle[] = [];
  /** Current and historical generated file paths excluded from self-triggering notifications. */
  const outputFiles = new Set<string>();
  /** Current and historical generated subtrees excluded from this subscriber’s notifications. */
  const outputDirs = new Set<string>();
  /** Retain generated exclusions before a candidate can trigger its own watcher.
   * @param {ZuixConfig} candidate - Candidate build configuration.
   * @returns {void} Extends this owner’s output exclusions only.
   */
  const rememberOutputs = (candidate: ZuixConfig) => {
    /** Validated shared output candidate whose CSS and map paths must be ignored. */
    const output = outputPath(absolute, candidate.output ?? 'zuix.css');
    outputFiles.add(output);
    outputFiles.add(output + '.map');
    if (candidate.buildManifest) {
      outputFiles.add(outputPath(absolute, candidate.buildManifest.file));
    }
    if (candidate.perFile) {
      outputDirs.add(
        outputPath(
          absolute,
          typeof candidate.perFile === 'object'
            ? (candidate.perFile.dir ?? 'zuix-files')
            : 'zuix-files'
        )
      );
    }
  };
  /** Isolate the host’s error observer from internal scheduling cleanup.
   * @param {unknown} error - Private build/loader/watcher cause.
   * @returns {void} Reports without rethrowing observer failures.
   */
  const report = (error: unknown) => {
    try {
      if (onError) {
        onError(error);
      } else {
        console.error('[zuix] watch:', error);
      }
    } catch (callbackError) {
      console.error('[zuix] watch error callback:', callbackError);
    }
  };
  /** Compile a complete candidate and notify observers only after output commit.
   * @param {ZuixConfig} candidate - Candidate immutable configuration.
   * @param {ReturnType<typeof createProjectScanner>} candidateScanner - Independent candidate source cache.
   * @param {boolean} [force] - Recompile even when source signatures match.
   * @returns {void} Commits output or throws before activation.
   */
  const build = (
    candidate: ZuixConfig,
    candidateScanner: ReturnType<typeof createProjectScanner>,
    force = false
  ) => {
    if (input && candidate.perFile) {
      throw new Error('zuix: CSS entries do not support per-file output');
    }
    rememberOutputs(candidate);
    /** Complete bounded source/token candidate from the selected scanner. */
    const files = candidateScanner.scan();
    if (
      input &&
      fs.statSync(input).size > resolveLimits(candidate.limits).maxFileBytes
    ) {
      throw new Error('zuix: invalid CSS entry size');
    }
    /** Authored CSS text contributing to the rebuild signature, never executed. */
    const entry = input ? fs.readFileSync(input, 'utf8') : '';
    /** Source-token and entry-text identity; unchanged inputs skip redundant generation. */
    const signature = JSON.stringify([...files]) + entry;
    if (!force && signature === previous) {
      return;
    }
    /** Fresh array/plain record; accessors and dangerous property names reject before copying. */
    const result = input
      ? buildStylesheetFromFiles(
          absolute,
          path.relative(absolute, input),
          candidate,
          files
        )
      : buildFromFiles(absolute, candidate, files);
    previous = signature;
    try {
      onBuild?.(result);
    } catch (error) {
      report(error);
    }
  };
  rememberOutputs(config);
  /** Build before swapping active configuration/scanner; failures retain the previous owner.
   * @param {ZuixConfig} candidate - Explicit trusted reload configuration.
   * @returns {void} Activates only a successfully committed candidate.
   */
  const activate = (candidate: ZuixConfig) => {
    /** Frozen candidate config or fresh scan result, independent of active mutable state. */
    const next = snapshot(candidate);
    /** Independent candidate cache, committed only after successful output generation. */
    const nextScanner = createProjectScanner(absolute, next);
    build(next, nextScanner, true);
    scanner.clear();
    config = next;
    scanner = nextScanner;
  };
  /** Process one config reload or current-source build while the owner remains open.
   * @returns {Promise<void>} Actual loader/build completion; late results cannot commit after close.
   */
  const reconcile = async () => {
    if (closed) {
      return;
    }
    if (configDirty && settings.loadConfig) {
      configDirty = false;
      if (++reloads > reloadLimit) {
        throw new Error('zuix: config reload limit exceeded; recreate watcher');
      }
      /** Trusted loader output held until cancellation and compilation checks pass. */
      const candidate = await settings.loadConfig({
        signal: controller.signal,
      });
      if (closed) {
        return;
      }
      activate(candidate);
    } else {
      build(config, scanner);
    }
  };
  let queued = false,
    trailing = false;
  /** Coalesce scheduling into one worker plus one trailing request.
   * @returns {Promise<void>} Current owned build chain, retaining actual settlement.
   */
  const enqueue = () => {
    if (queued) {
      trailing = true;
      return work;
    }
    queued = true;
    work = work
      .then(async () => {
        do {
          trailing = false;
          await reconcile();
        } while (trailing && !closed);
      })
      .catch(report)
      .finally(() => {
        queued = false;
      });
    return work;
  };
  /** Debounce source notifications without allocating unbounded build promises.
   * @returns {void} One owner-held timer requests reconciliation.
   */
  const schedule = () => {
    if (closed) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void enqueue();
    }, debounce);
  };
  let finishClosed!: () => void;
  /** Owner cleanup promise resolved after startup, work and every subscription settle. */
  const settled = new Promise<void>((resolve) => {
    finishClosed = resolve;
  });
  /** Fence work, abort cooperative loaders and drain actual owned settlement.
   * @returns {void} Immediate disposal; the attached closed promise tracks settlement.
   */
  const stop = (() => {
    if (closed) {
      return;
    }
    closed = true;
    controller.abort();
    if (timer) {
      clearTimeout(timer);
    }
    timer = undefined;
    settings.signal?.removeEventListener('abort', stop);
    for (const handle of handles) {
      handle.close();
    }
    scanner.clear();
    void Promise.allSettled([
      ready,
      work,
      ...handles.map((handle) => handle.closed),
    ]).then(() => finishClosed());
  }) as ZuixWatchHandle;
  /** Lazy optional-peer startup plus fresh reconciliation after shared baselines are ready. */
  const ready = Promise.resolve().then(async () => {
    if (controller.signal.aborted) {
      return;
    }
    /** Explicit optional peer loaded only when a watch owner is requested. */
    const { watchDirectory } = await import('zlook');
    if (closed) {
      return;
    }
    try {
      for (const location of roots) {
        /** Owned subscription for one configured root, released even on partial startup failure. */
        const handle = watchDirectory(
          location,
          (event) => {
            /** Absolute changed/ignored candidate path within its subscribed root. */
            const file = path.join(location, event.file);
            /** Forward-slash project-relative cache identity, distinct from public asset URLs. */
            const relative = path
              .relative(absolute, file)
              .split(path.sep)
              .join('/');
            scanner.invalidate(relative);
            if (file === configPath) {
              configDirty = true;
            }
            schedule();
          },
          {
            debounceMs: debounce,
            pollIntervalMs: poll,
            pollingOnly: settings.pollingOnly ?? false,
            maxEntries: settings.maxEntries ?? 100000,
            maxPendingEvents: settings.maxPendingEvents ?? 4096,
            signal: controller.signal,
            ignored: (relative) => {
              /** Absolute changed/ignored candidate path within its subscribed root. */
              const file = path.join(location, relative);
              if (file === configPath || file === input) {
                return false;
              }
              return (
                relative
                  .split('/')
                  .some(
                    (part) =>
                      [
                        'node_modules',
                        '.git',
                        '.svn',
                        'dist',
                        'build',
                        '.zerux',
                        '.cache',
                        '.zuix',
                        '.output',
                        'coverage',
                        '.next',
                        '.nuxt',
                      ].includes(part) ||
                      part.startsWith('.env') ||
                      part.startsWith('.zuix-')
                  ) ||
                outputFiles.has(file) ||
                [...outputDirs, ...ignored].some(
                  (dir) => file === dir || file.startsWith(dir + path.sep)
                )
              );
            },
            onError: (error) => {
              scanner.clear();
              report(error);
              schedule();
            },
          }
        );
        handles.push(handle);
      }
      await Promise.all(handles.map((handle) => handle.ready));
      if (!closed) {
        scanner.clear();
        await enqueue();
      }
    } catch (error) {
      for (const handle of handles) {
        handle.close();
      }
      throw error;
    }
  });
  void ready.catch((error) => {
    report(error);
    stop();
  });
  Object.defineProperties(stop, {
    ready: { value: ready },
    closed: { value: settled },
    flush: {
      value: async () => {
        await ready;
        if (closed) {
          return;
        }
        await Promise.all(handles.map((handle) => handle.flush()));
        if (timer) {
          clearTimeout(timer);
        }
        timer = undefined;
        await enqueue();
      },
    },
    reload: {
      value: (candidate: ZuixConfig) => {
        /** Serialized explicit reload, rejecting after close and never auto-replaying failures. */
        const job = work.then(() => {
          if (closed) {
            throw new Error('zuix: watcher closed');
          }
          activate(candidate);
        });
        work = job.catch(() => {});
        return job;
      },
    },
  });
  // Aborted startup does not compile or allocate an underlying subscription.
  if (settings.signal?.aborted) {
    stop();
  } else {
    settings.signal?.addEventListener('abort', stop, { once: true });
    try {
      build(config, scanner);
    } catch (error) {
      report(error);
    }
  }
  return stop;
}
