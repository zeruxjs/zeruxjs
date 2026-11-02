#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTerminalCodes, suggest } from './format.js';
import {
  runGeneratorCli,
  createTerminalGeneratorPrompt,
} from './generator-command.js';
import { createZeruxProject } from './scaffold.js';

export function runZcli(
  argv: readonly string[],
  out: (message: string) => void = console.log,
  err: (message: string) => void = console.error,
): number {
  const writeOutput = out;
  out = (message) => writeOutput(stripTerminalCodes(message));
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
      'zclivo create <folder> [--js|--ts] [--dry-run]\nCreates a minimal ZeruxJS application without overwriting files.',
    );
    return 0;
  }
  if (argv[0] !== 'create') {
    err(`Unknown command: ${argv[0]}.${suggest(argv[0], ['create'])}`);
    return 2;
  }
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
    const result = createZeruxProject(argv[1], {
      language: flags.includes('--js') ? 'javascript' : 'typescript',
      dryRun: flags.includes('--dry-run'),
    });
    out(
      `${result.created ? 'Created' : 'Would create'} ${result.directory} (${result.files.length} files)`,
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
  const controller = new AbortController(),
    interrupt = () => controller.abort();
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
