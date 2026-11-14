#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTerminalCodes, suggest } from './format.js';
import {
  runGeneratorCli,
  createTerminalGeneratorPrompt,
} from './generator-command.js';
import { createZeruxProject } from './scaffold.js';

/** Preserve the synchronous minimal-starter CLI without starting generated apps.
 * @param {readonly string[]} argv - Explicit bounded legacy create arguments.
 * @param {(message: string) => void} out - Borrowed output callback, terminal-sanitized before invocation.
 * @param {(message: string) => void} err - Borrowed diagnostics callback; callers separately redact sensitive content.
 * @returns {number} Zero for success/help, two for usage, one for creation failure.
 */
export function runZcli(
  argv: readonly string[],
  out: (message: string) => void = console.log,
  err: (message: string) => void = console.error
): number {
  /** Borrowed host output callback wrapped with terminal-control sanitization. */
  const writeOutput = out;
  out = (message) => writeOutput(stripTerminalCodes(message));
  /** Borrowed host diagnostic callback; sanitization is not secret redaction. */
  const writeError = err;
  err = (message) => writeError(stripTerminalCodes(message));
  if (
    !Array.isArray(argv) ||
    argv.length > 1024 ||
    argv.some((value) => typeof value !== 'string' || value.length > 8192) ||
    argv.reduce((size, value) => size + value.length, 0) > 65536
  ) {
    err('Invalid argument list');
    return 2;
  }
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    out(
      'zclivo create <folder> [--js|--ts] [--dry-run]\nCreates a minimal ZeruxJS application without overwriting files.'
    );
    return 0;
  }
  if (argv[0] !== 'create') {
    err(`Unknown command: ${argv[0]}.${suggest(argv[0], ['create'])}`);
    return 2;
  }
  /** Explicit legacy short-form starter options after the new destination. */
  const flags = argv.slice(2);
  if (
    !argv[1] ||
    flags.some((f) => !['--js', '--ts', '--dry-run'].includes(f)) ||
    (flags.includes('--js') && flags.includes('--ts'))
  ) {
    err('Usage: zclivo create <folder> [--js|--ts] [--dry-run]');
    return 2;
  }
  try {
    /** Owned starter write/dry-run receipt; no dependencies or generated code are executed. */
    const result = createZeruxProject(argv[1], {
      language: flags.includes('--js') ? 'javascript' : 'typescript',
      dryRun: flags.includes('--dry-run'),
    });
    out(
      `${result.created ? 'Created' : 'Would create'} ${result.directory} (${result.files.length} files)`
    );
    return 0;
  } catch (error) {
    err(`zclivo: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
/** Modern cancellable entry; legacy synchronous runZcli remains compatible. */
export const runZcliAsync = runGeneratorCli;
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  /** Executable-owned cooperative lifetime; terminal handlers removed in finally. */
  const controller = new AbortController();
  /** Forward an executable terminal interrupt without installing global library hooks.
   * @returns {void} Aborts this invocation only.
   */
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    process.exitCode = await runZcliAsync(process.argv.slice(2), {
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
