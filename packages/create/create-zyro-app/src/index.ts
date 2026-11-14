#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CommandRegistry,
  parseArguments,
  registerGeneratorCommand,
  createTerminalGeneratorPrompt,
  type GeneratorPrompt,
} from 'zclivo';
import { createZyroProjectGenerator, validateBasePath } from './templates.js';
export {
  planZyroApp,
  zyroAppGenerator,
  createZyroProjectGenerator,
  validateBasePath,
} from './templates.js';
export type { ZyroMode } from './templates.js';
/** CLI compatibility version; release metadata remains unchanged. */
export const version = '0.0.4';
/** Invoke safe standalone generation with a creator-owned validated public mount.
 * @param {readonly string[]} argv - Explicit CLI argument data, never executable commands.
 * @param {object} options - Host invocation context and callbacks.
 * @param {AbortSignal} options.signal - Optional cooperative invocation cancellation.
 * @param {string} options.cwd - Explicit new-project parent directory.
 * @param {(message: string) => void} options.out - Public help/plan output callback.
 * @param {(message: string) => void} options.err - Fixed usage/dependency diagnostics.
 * @param {() => GeneratorPrompt} options.prompt - Optional factory transferring prompt cleanup to zclivo.
 * @returns {Promise<number>} Shared command exit status; invalid mount arguments return two.
 */
export async function runCreateZyro(
  argv: readonly string[],
  options: {
    signal?: AbortSignal;
    cwd?: string;
    out?: (message: string) => void;
    err?: (message: string) => void;
    prompt?: () => GeneratorPrompt;
  } = {}
): Promise<number> {
  /** Host public output callback used by the shared command engine. */
  const out = options.out ?? console.log;
  /** Host usage/dependency diagnostics callback; no private app settings are printed. */
  const err = options.err ?? console.error;
  if (
    Array.isArray(argv) &&
    argv.length === 1 &&
    ['--version', '-v'].includes(argv[0])
  ) {
    out(version);
    return 0;
  }
  let basePath = '/';
  /** Arguments forwarded after consuming the creator-owned fixed base-path option. */
  const rest: string[] = [];
  try {
    parseArguments(argv);
    let found = false,
      separated = false;
    for (let i = 0; i < argv.length; i++) {
      /** Current argument inspected as data rather than executable input. */
      // parseArguments validated the string array, and this loop proves the index is in bounds.
      const arg = argv[i]!;
      if (arg === '--') {
        separated = true;
      }
      if (
        !separated &&
        (arg === '--base-path' || arg.startsWith('--base-path='))
      ) {
        if (found) {
          throw Error('Base path may not repeat');
        }
        found = true;
        /** Explicit base-path value validated before generating any file plan. */
        const value =
          arg === '--base-path' ? argv[++i] : arg.slice('--base-path='.length);
        basePath = validateBasePath(value);
      } else {
        rest.push(arg);
      }
    }
  } catch {
    err('Invalid arguments/base path. Use --base-path /public-prefix.');
    return 2;
  }
  /** Invocation-local registry with no import-time resources. */
  const commands = new CommandRegistry();
  registerGeneratorCommand(commands, {
    keyword: 'create-zyro-app',
    generator: createZyroProjectGenerator(basePath),
    ...options,
  });
  /** Legacy create/help/interactive forms normalized for the shared safe command. */
  let args;
  if (!rest.length) {
    if (options.prompt) {
      args = ['create', '--interactive'];
    } else {
      args = ['create', '--help'];
    }
  } else {
    if (['--help', '-h', '--docs'].includes(rest[0]!)) {
      args = ['create', ...rest];
    } else {
      if (rest[0] === 'create') {
        args = rest;
      } else {
        args = ['create', ...rest];
      }
    }
  }
  /** Shared engine completion status; no generated app is installed or executed. */
  const result = await commands.dispatch('create-zyro-app', args, out, {
    signal: options.signal,
  });
  if (
    rest.includes('--help') ||
    rest.includes('-h') ||
    (!rest.length && !options.prompt)
  ) {
    out(
      '--base-path /prefix  Public mount (default /); selective hydration is unavailable.'
    );
  }
  if (result.exitCode && result.message) {
    err(result.message);
  }
  return result.exitCode;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  /** Executable-owned cancellation controller; signal listeners are removed on exit. */
  const c = new AbortController();
  /** Cancel this CLI invocation cooperatively without touching other applications.
   * @returns {void} Aborts the invocation signal.
   */
  const interrupt = () => c.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    process.exitCode = await runCreateZyro(process.argv.slice(2), {
      signal: c.signal,
      ...(process.stdin.isTTY && process.stdout.isTTY
        ? {
            prompt: () =>
              createTerminalGeneratorPrompt({
                input: process.stdin,
                output: process.stdout,
                onInterrupt: interrupt,
              }),
          }
        : {}),
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
