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
export const version = '0.0.4';
/** Reusable import has no process listeners, prompts, writes or installs. */
export async function runCreateZerux(
  argv: readonly string[],
  options: {
    signal?: AbortSignal;
    cwd?: string;
    out?: (message: string) => void;
    err?: (message: string) => void;
    prompt?: () => GeneratorPrompt;
  } = {},
): Promise<number> {
  const out = options.out ?? console.log,
    err = options.err ?? console.error;
  if (
    Array.isArray(argv) &&
    argv.length === 1 &&
    ['--version', '-v'].includes(argv[0])
  ) {
    out(version);
    return 0;
  }
  const registry = new CommandRegistry();
  registerGeneratorCommand(registry, {
    keyword: 'create-zerux-js',
    generator: zeruxAppGenerator,
    ...options,
  });
  const args = Array.isArray(argv)
    ? !argv.length
      ? options.prompt
        ? ['create', '--interactive']
        : ['create', '--help']
      : ['--help', '-h', '--docs'].includes(argv[0])
        ? ['create', ...argv]
        : argv[0] === 'create'
          ? argv
          : ['create', ...argv]
    : argv;
  const result = await registry.dispatch('create-zerux-js', args, out, {
    signal: options.signal,
  });
  if (result.exitCode && result.message) err(result.message);
  return result.exitCode;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController(),
    interrupt = () => controller.abort();
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
