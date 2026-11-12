#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CommandRegistry,
  registerGeneratorCommand,
  createTerminalGeneratorPrompt,
  type GeneratorPrompt,
} from 'zclivo';
import { zenixAppGenerator } from './templates.js';
export { zenixAppGenerator, planZenixApp } from './templates.js';
/** Published CLI compatibility version; this readability pass does not change release metadata. */
export const version = '0.0.4';
/** Reusable import has no process listeners, prompts, writes or installs.
 * @param {readonly string[]} argv - Explicit CLI argument data, without executable interpolation.
 * @param {object} options - Host-owned invocation context.
 * @param {AbortSignal} options.signal - Optional cooperative cancellation signal.
 * @param {string} options.cwd - Optional generation working directory.
 * @param {(message: string) => void} options.out - Public CLI output callback.
 * @param {(message: string) => void} options.err - Diagnostic output callback.
 * @param {() => GeneratorPrompt} options.prompt - Optional factory transferring prompt cleanup to the shared engine.
 * @returns {Promise<number>} Shared-engine exit status; unsupported CMS providers return two.
 */
export async function runCreateZenix(
  argv: readonly string[],
  options: {
    signal?: AbortSignal;
    cwd?: string;
    out?: (message: string) => void;
    err?: (message: string) => void;
    prompt?: () => GeneratorPrompt;
  } = {}
): Promise<number> {
  /** Host output callback, defaulting to the CLI console; never given private environment values. */
  const out = options.out ?? console.log;
  /** Host diagnostic callback for fixed prerequisite or shared-engine failures. */
  const err = options.err ?? console.error;
  if (
    Array.isArray(argv) &&
    argv.length === 1 &&
    ['--version', '-v'].includes(argv[0])
  ) {
    out(version);
    return 0;
  }
  // Provider choices are deliberately fixed until another durable adapter is qualified.
  /** Arguments forwarded to the shared safe generator after fixed CMS provider options are consumed. */
  const remaining: string[] = [];
  try {
    if (!Array.isArray(argv)) {
      throw Error();
    }
    /** Fixed provider switches already consumed; duplicates reject instead of silently overriding. */
    const seen = new Set<string>();
    let separated = false;
    for (let i = 0; i < argv.length; i++) {
      /** Current argument inspected as data; never interpolated into a shell command. */
      const arg = argv[i];
      if (arg === '--') {
        separated = true;
      }
      /** Only the two supported CMS provider switches are recognized here. */
      const option = ['--database', '--storage'].find(
        (key) => !separated && (arg === key || arg.startsWith(key + '='))
      );
      if (!option) {
        remaining.push(arg);
        continue;
      }
      if (seen.has(option)) {
        throw Error();
      }
      seen.add(option);
      /** Explicit provider value from an equals form or the next argument. */
      const value = arg === option ? argv[++i] : arg.slice(option.length + 1);
      if (value !== (option === '--database' ? 'sqlite' : 'none')) {
        throw Error();
      }
    }
  } catch {
    err(
      'Supported CMS setup: --database sqlite --storage none. No React/Vue CMS or media upload template is available.'
    );
    return 2;
  }
  argv = remaining;
  /** Invocation-local command registry; importing the package creates no CLI owner. */
  const registry = new CommandRegistry();
  registerGeneratorCommand(registry, {
    keyword: 'create-zenix-js',
    generator: zenixAppGenerator,
    ...options,
    ...(options.prompt
      ? {
          prompt: () => {
            /** Owned prompt supplied by the host factory; shared generator orchestration closes it. */
            const prompt = options.prompt!();
            let initialized = false;
            return {
              async ask(
                question: Parameters<GeneratorPrompt['ask']>[0],
                signal: AbortSignal
              ) {
                if (!initialized) {
                  initialized = true;
                  for (const [message, choice] of [
                    ['Database adapter', 'sqlite'],
                    ['Binary storage (uploads unavailable)', 'none'],
                  ] as const) {
                    /** Explicit fixed provider choice; unsupported answers fail before project generation. */
                    const answer = await prompt.ask(
                      {
                        name: 'template',
                        message,
                        defaultValue: choice,
                        choices: [choice],
                      },
                      signal
                    );
                    if (answer !== choice) {
                      throw new TypeError(
                        'Unsupported CMS provider configuration'
                      );
                    }
                  }
                }
                return prompt.ask(question, signal);
              },
              close: () => prompt.close(),
            };
          },
        }
      : {}),
  });
  /** Normalized command arguments retaining the existing create/help/interactive invocation forms. */
  let args = argv;
  if (Array.isArray(argv)) {
    if (!argv.length) {
      args = options.prompt
        ? ['create', '--interactive']
        : ['create', '--help'];
    } else if (['--help', '-h', '--docs'].includes(argv[0])) {
      args = ['create', ...argv];
    } else if (argv[0] !== 'create') {
      args = ['create', ...argv];
    }
  }
  /** Shared engine completion result; its exit code remains the CLI contract. */
  const result = await registry.dispatch('create-zenix-js', args, out, {
    signal: options.signal,
  });
  if (
    argv.includes('--help') ||
    argv.includes('-h') ||
    (!argv.length && !options.prompt)
  ) {
    out(
      '--database sqlite --storage none; host session/CSRF/setup policy required before startup.'
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
  /** Owned executable-only cancellation controller removed with process listeners in finally. */
  const controller = new AbortController();
  /** Forward a terminal interrupt cooperatively without stopping any external application.
   * @returns {void} Aborts this CLI invocation only.
   */
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    process.exitCode = await runCreateZenix(process.argv.slice(2), {
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
