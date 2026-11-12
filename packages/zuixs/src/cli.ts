#!/usr/bin/env node
import path from 'node:path';
import { readProjectFile } from './outputs.js';
import { outputPath } from './node-build.js';
import 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildZuix, watchZuix, buildZuixStylesheet } from './node.js';
import type { ZuixConfig } from './types.js';
/** Validate explicit CLI arguments before building or owning a watch lifecycle; never installs dependencies or runs generated code.
 * @param {string[]} args - Argument vector, defaulting to process arguments after the binary.
 * @returns {Promise<void>} Build completion or watch startup; watch owns signal-based teardown.
 */
export async function runCli(
  args: string[] = process.argv.slice(2)
): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'zuix [build|watch] [-c zuix.config.mjs] [-i src/styles.css] [-o output.css] [--cwd directory] [--per-file] [--per-file-dir directory]'
    );
    return;
  }
  /** Explicit build/watch command, defaulting to build when flags lead the invocation. */
  const command = args[0] && !args[0].startsWith('-') ? args[0] : 'build';
  if (command !== 'build' && command !== 'watch') {
    throw new Error(`unknown command: ${command}`);
  }
  /** Validated valued options; duplicate spellings reject before writing output. */
  const opts = new Map<string, string>();
  /** Recognized Boolean flags, separate from valued options. */
  const flags = new Set<string>();
  /** Exact supported valued flags; unknown options fail rather than being ignored. */
  const valid = new Set([
    '-c',
    '--config',
    '-o',
    '--output',
    '--cwd',
    '--per-file-dir',
    '-i',
    '--input',
  ]);
  for (let i = args[0] === command ? 1 : 0; i < args.length; i++) {
    // The loop bound guarantees this argument exists.
    /** Current argument proven present by the bounded loop index. */
    const arg = args[i]!;
    if (arg === '--watch' || arg === '--per-file') {
      flags.add(arg);
      continue;
    }
    if (!valid.has(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (
      opts.has(arg) ||
      i + 1 >= args.length ||
      args[i + 1]!.startsWith('--') ||
      args[i + 1] === '-o' ||
      args[i + 1] === '-c'
    ) {
      throw new Error(`missing or repeated value: ${arg}`);
    }
    // Missing-value checks above guarantee the incremented argument.
    opts.set(arg, args[++i]!);
  }
  /** Resolved explicit project directory, defaulting to the caller’s working directory. */
  const root = path.resolve(opts.get('--cwd') ?? process.cwd());
  /** Optional trusted executable configuration path; no arbitrary package discovery. */
  const configPath = opts.get('-c') ?? opts.get('--config');
  /** Load one trusted content-addressed config module and reapply CLI overrides.
   * @returns {Promise<ZuixConfig>} Application config or a reported import/validation failure.
   */
  const loadConfig = async (): Promise<ZuixConfig> => {
    let loaded: ZuixConfig = {};
    if (configPath) {
      /** Validated project-contained config path. */
      const file = outputPath(root, configPath);
      /** Content hash used as an ESM revision key; imported dependencies are not evicted. */
      const revision = createHash('sha256')
        .update(readProjectFile(file, 1024 * 1024))
        .digest('hex');
      /** Trusted application config namespace, executed only because the CLI user selected it. */
      const mod = await import(pathToFileURL(file).href + '?zuix=' + revision);
      loaded = { ...(mod.default ?? mod.config ?? {}) };
    }
    if (flags.has('--per-file')) {
      loaded.perFile = true;
    }
    if (opts.has('--per-file-dir')) {
      loaded.perFile = { dir: opts.get('--per-file-dir') };
    }
    if (opts.has('-o') || opts.has('--output')) {
      loaded.output = opts.get('--output') ?? opts.get('-o');
    }
    return loaded;
  };
  /** Initial effective application config after explicit CLI overrides. */
  const config = await loadConfig();
  /** Report compilation counts without invoking generated code.
   * @param {{classes: string[], unmatched: string[]}} result - Compiler diagnostics.
   * @param {string[]} result.classes - All unique compiled/input tokens.
   * @param {string[]} result.unmatched - Unsupported/rejected tokens.
   * @returns {void} Prints one build status line.
   */
  const report = (result: { classes: string[]; unmatched: string[] }) =>
    console.log(
      `[zuix] compiled ${result.classes.length - result.unmatched.length} utilities -> ${config.output ?? 'zuix.css'}`
    );
  /** Optional authored CSS entry, kept separate from generated output. */
  const input = opts.get('-i') ?? opts.get('--input');
  /** Whether this invocation explicitly requested the watch lifecycle. */
  const watching = command === 'watch' || flags.has('--watch');
  if (input && config.perFile) {
    throw new Error('zuix: CSS entries do not support per-file output');
  }
  if (watching) {
    /** Owned callable watcher disposer with awaitable startup and actual-settlement cleanup. */
    const stop = watchZuix(
      root,
      config,
      report,
      (error) => console.error('[zuix] watch:', error),
      {
        ...(input ? { input } : {}),
        ...(configPath ? { configFile: configPath, loadConfig } : {}),
      }
    );
    /** Stop this CLI-owned watcher and detach only its signal listeners.
     * @returns {void} Immediate fence; watcher.closed tracks asynchronous settlement.
     */
    const shutdown = () => {
      stop();
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    try {
      await stop.ready;
    } catch (error) {
      shutdown();
      await stop.closed;
      throw error;
    }
    void stop.closed.then(shutdown);
    console.log('[zuix] watching for changes');
  } else {
    report(
      input ? buildZuixStylesheet(root, input, config) : buildZuix(root, config)
    );
  }
}
// Importable CLI entry for validation without executing from a package consumer.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli().catch((error) => {
    console.error('[zuix]', error);
    process.exitCode = 1;
  });
}
