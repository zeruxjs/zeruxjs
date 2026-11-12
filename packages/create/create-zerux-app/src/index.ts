#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CommandRegistry,
  registerGeneratorCommand,
  createTerminalGeneratorPrompt,
  type GeneratorPrompt,
} from 'zclivo';
import { zeruxAppGenerator } from './templates.js';
export {
  zeruxAppGenerator,
  planZeruxApp,
  templateVersions,
} from './templates.js';
/** CLI compatibility version; this pass preserves release metadata. */
export const version = '0.0.4';
/** Reusable import has no process listeners, prompts, writes or installs.
 * @param {readonly string[]} argv - Explicit arguments passed to the shared safe generator.
 * @param {object} options - Host invocation policy and callbacks.
 * @param {AbortSignal} options.signal - Optional cooperative cancellation.
 * @param {string} options.cwd - Explicit working directory for the new target.
 * @param {(message: string) => void} options.out - Public output callback.
 * @param {(message: string) => void} options.err - Fixed usage/dependency diagnostics.
 * @param {() => GeneratorPrompt} options.prompt - Optional prompt factory; shared orchestration owns cleanup.
 * @returns {Promise<number>} Shared generator exit code without running the generated app.
 */
export async function runCreateZerux(
  argv: readonly string[],
  options: {
    signal?: AbortSignal;
    cwd?: string;
    out?: (message: string) => void;
    err?: (message: string) => void;
    prompt?: () => GeneratorPrompt;
  } = {}
): Promise<number> {
  /** Host output callback; generation paths and diagnostics do not include private runtime settings. */
  const out = options.out ?? console.log;
  /** Host diagnostic callback retaining the shared command exit-code policy. */
  const err = options.err ?? console.error;
  if (
    Array.isArray(argv) &&
    argv.length === 1 &&
    ['--version', '-v'].includes(argv[0])
  ) {
    out(version);
    return 0;
  }
  /** Invocation-local command registry; imports register no process listeners. */
  const registry = new CommandRegistry();
  registerGeneratorCommand(registry, {
    keyword: 'create-zerux-js',
    generator: zeruxAppGenerator,
    ...options,
  });
  /** Normalized legacy create/help/interactive forms forwarded to the shared generator engine. */
  let args;
  if (Array.isArray(argv)) {
    if (!argv.length) {
      if (options.prompt) {
        args = ['create', '--interactive'];
      } else {
        args = ['create', '--help'];
      }
    } else {
      if (['--help', '-h', '--docs'].includes(argv[0])) {
        args = ['create', ...argv];
      } else {
        if (argv[0] === 'create') {
          args = argv;
        } else {
          args = ['create', ...argv];
        }
      }
    }
  } else {
    args = argv;
  }
  /** Shared generator completion; no generated app is installed or started here. */
  const result = await registry.dispatch('create-zerux-js', args, out, {
    signal: options.signal,
  });
  if (result.exitCode && result.message) {
    err(result.message);
  }
  return result.exitCode;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  /** Executable-owned cooperative cancellation controller; process listeners are removed in finally. */
  const controller = new AbortController();
  /** Forward terminal interruption to this invocation without stopping other apps.
   * @returns {void} Aborts this invocation cooperatively.
   */
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    process.exitCode = await runCreateZerux(process.argv.slice(2), {
      signal: controller.signal,
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
