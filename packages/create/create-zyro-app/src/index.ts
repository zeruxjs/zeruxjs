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
export const version = '0.0.4';
export async function runCreateZyro(
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
  let basePath = '/',
    rest: string[] = [];
  try {
    parseArguments(argv);
    let found = false,
      separated = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--') separated = true;
      if (
        !separated &&
        (arg === '--base-path' || arg.startsWith('--base-path='))
      ) {
        if (found) throw Error('Base path may not repeat');
        found = true;
        const value =
          arg === '--base-path' ? argv[++i] : arg.slice('--base-path='.length);
        basePath = validateBasePath(value);
      } else rest.push(arg);
    }
  } catch {
    err('Invalid arguments/base path. Use --base-path /public-prefix.');
    return 2;
  }
  const commands = new CommandRegistry();
  registerGeneratorCommand(commands, {
    keyword: 'create-zyro-app',
    generator: createZyroProjectGenerator(basePath),
    ...options,
  });
  const args = !rest.length
    ? options.prompt
      ? ['create', '--interactive']
      : ['create', '--help']
    : ['--help', '-h', '--docs'].includes(rest[0])
      ? ['create', ...rest]
      : rest[0] === 'create'
        ? rest
        : ['create', ...rest];
  const result = await commands.dispatch('create-zyro-app', args, out, {
    signal: options.signal,
  });
  if (
    rest.includes('--help') ||
    rest.includes('-h') ||
    (!rest.length && !options.prompt)
  )
    out(
      '--base-path /prefix  Public mount (default /); selective hydration is unavailable.',
    );
  if (result.exitCode && result.message) err(result.message);
  return result.exitCode;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const c = new AbortController(),
    interrupt = () => c.abort();
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
