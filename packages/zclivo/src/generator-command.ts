import { createInterface, type Interface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { basename, resolve } from 'node:path';
import { CommandRegistry } from './commands.js';
import { stripTerminalCodes } from './format.js';
import { OptionError } from './options.js';
import { minimalProjectGenerator } from './scaffold.js';
import {
  writeProjectPlanAsync,
  type ProjectGenerator,
  type ProjectLanguage,
  type ProjectOptions,
} from './generator.js';
export interface GeneratorQuestion {
  name:
    | 'name'
    | 'destination'
    | 'language'
    | 'port'
    | 'mode'
    | 'renderer'
    | 'template';
  message: string;
  defaultValue: string;
  choices?: readonly string[];
}
export interface GeneratorPrompt {
  ask(
    question: Readonly<GeneratorQuestion>,
    signal: AbortSignal,
  ): Promise<string>;
  close(): void | Promise<void>;
}
/** Lazy terminal owner; reusable imports do not install process signal listeners. */
export function createTerminalGeneratorPrompt(options: {
  input: Readable;
  output: Writable;
  onInterrupt: () => void;
}): GeneratorPrompt {
  let terminal: Interface | undefined;
  let closed = false;
  const interrupt = () => options.onInterrupt();
  return {
    async ask(q, signal) {
      if (closed) throw new Error('Generator prompt closed');
      signal.throwIfAborted();
      if (!terminal) {
        terminal = createInterface({
          input: options.input,
          output: options.output,
          terminal: true,
        });
        terminal.on('SIGINT', interrupt);
      }
      const rl = terminal;
      let ended!: () => void;
      const endedPromise = new Promise<never>((_, reject) => {
        ended = () => reject(new Error('Generator input closed'));
        rl.once('close', ended);
      });
      try {
        const answer = await Promise.race([
          rl.question(
            `${q.message}${q.choices ? ' [' + q.choices.join('|') + ']' : ''} (${q.defaultValue}): `,
            { signal },
          ),
          endedPromise,
        ]);
        signal.throwIfAborted();
        return answer || q.defaultValue;
      } finally {
        rl.off('close', ended);
      }
    },
    close() {
      closed = true;
      terminal?.off('SIGINT', interrupt);
      terminal?.close();
      terminal = undefined;
    },
  };
}
/** Explicit registration shared by creator packages; no template package discovery. */
export function registerGeneratorCommand(
  commands: CommandRegistry,
  options: {
    keyword?: string;
    command?: string;
    generator?: ProjectGenerator;
    prompt?: () => GeneratorPrompt;
    cwd?: string;
    out?: (message: string) => void;
  } = {},
) {
  const generator = options.generator ?? minimalProjectGenerator,
    all = generator.capabilities(),
    templateIds = all.map((t) => t.id),
    modes = [...new Set(all.flatMap((t) => t.capabilities.map((c) => c.mode)))],
    renderers = [
      ...new Set(all.flatMap((t) => t.capabilities.map((c) => c.renderer))),
    ];
  commands.register(
    options.keyword ?? 'zclivo',
    options.command ?? 'create',
    async (args, context) => {
      const values = context.options!,
        positionals = args.positionalArgs;
      if (
        positionals.length > 1 ||
        (positionals.length && values.destination !== undefined)
      )
        throw new OptionError(
          'Choose one destination positional or --destination',
        );
      for (const v of Object.values(values))
        if (Array.isArray(v))
          throw new OptionError('Generator flags may not repeat');
      let prompt: GeneratorPrompt | undefined;
      if (values.interactive) {
        if (!options.prompt)
          throw new OptionError(
            'Interactive input requires a terminal; use --yes or explicit flags',
          );
        prompt = options.prompt();
        context.onDispose(() => prompt!.close());
      }
      const ask = async (q: GeneratorQuestion) =>
        prompt ? prompt.ask(Object.freeze(q), context.signal) : q.defaultValue;
      const template =
        typeof values.template === 'string'
          ? values.template
          : await ask({
              name: 'template',
              message: 'Template',
              defaultValue: templateIds[0],
              choices: templateIds,
            });
      const t = all.find((t) => t.id === template);
      if (!t) throw new OptionError('Unknown registered template');
      const supplied = String(positionals[0] ?? values.destination ?? ''),
        name =
          typeof values.name === 'string'
            ? values.name
            : await ask({
                name: 'name',
                message: 'Project name',
                defaultValue: supplied
                  ? basename(resolve(options.cwd ?? process.cwd(), supplied))
                  : 'my-app',
              });
      const destination =
        supplied ||
        (await ask({
          name: 'destination',
          message: 'Destination',
          defaultValue: name,
        }));
      const mode =
        typeof values.mode === 'string'
          ? values.mode
          : await ask({
              name: 'mode',
              message: 'Mode',
              defaultValue: t.capabilities[0].mode,
              choices: [...new Set(t.capabilities.map((c) => c.mode))],
            });
      const compatible = t.capabilities.filter((c) => c.mode === mode);
      if (!compatible.length)
        throw new OptionError('Unsupported template mode');
      const renderer =
        typeof values.renderer === 'string'
          ? values.renderer
          : await ask({
              name: 'renderer',
              message: 'Renderer',
              defaultValue: compatible[0].renderer,
              choices: compatible.map((c) => c.renderer),
            });
      const capability = compatible.find((c) => c.renderer === renderer);
      if (!capability) throw new OptionError('Unsupported mode/renderer');
      const languages = capability.languages,
        language = (
          values.js
            ? 'javascript'
            : values.ts
              ? 'typescript'
              : typeof values.language === 'string'
                ? values.language
                : await ask({
                    name: 'language',
                    message: 'Language',
                    defaultValue: languages.includes('typescript')
                      ? 'typescript'
                      : languages[0],
                    choices: languages,
                  })
        ) as ProjectLanguage;
      const port =
        values.port === undefined
          ? Number(
              await ask({
                name: 'port',
                message: 'Port',
                defaultValue: '3000',
              }),
            )
          : Number(values.port);
      if (!prompt && !supplied && values.name === undefined)
        throw new OptionError(
          'A destination or --name is required without --interactive',
        );
      context.signal.throwIfAborted();
      let plan;
      try {
        plan = generator.plan({
          template,
          name,
          destination: resolve(options.cwd ?? process.cwd(), destination),
          mode,
          renderer,
          language,
          port,
        });
      } catch (error) {
        if (error instanceof TypeError) throw new OptionError(error.message);
        throw error;
      }
      if (!values['dry-run'])
        await writeProjectPlanAsync(plan, { signal: context.signal });
      (options.out ?? console.log)(
        stripTerminalCodes(
          `${values['dry-run'] ? 'Would create' : 'Created'} ${plan.options.destination} (${Object.keys(plan.files).length} files)\n${Object.keys(plan.files).join('\n')}\nSHA-256 ${plan.digest}`,
        ),
      );
    },
    {
      description:
        'Plan or create a new project; never install dependencies or run generated code.',
      usage:
        '<folder> [--name name] [--destination path] [--interactive|--yes] [--language typescript|javascript] [--js|--ts] [--port 3000] [--mode mode] [--renderer renderer] [--template template] [--dry-run]',
      flags: {
        name: { type: 'string' },
        destination: { type: 'string' },
        template: {
          type: 'string',
          choices: templateIds,
          description: 'Registered templates: ' + templateIds.join(', '),
        },
        language: {
          type: 'string',
          choices: ['typescript', 'javascript'],
          conflicts: ['js', 'ts'],
        },
        js: { type: 'boolean', conflicts: ['ts', 'language'] },
        ts: { type: 'boolean', conflicts: ['js', 'language'] },
        port: { type: 'number' },
        mode: {
          type: 'string',
          choices: modes,
          description: 'Supported modes: ' + modes.join(', '),
        },
        renderer: {
          type: 'string',
          choices: renderers,
          description: 'Supported renderers: ' + renderers.join(', '),
        },
        interactive: { type: 'boolean', conflicts: ['yes'] },
        yes: { type: 'boolean', conflicts: ['interactive'] },
        'dry-run': { type: 'boolean' },
      },
      docs: all
        .map(
          (t) =>
            t.id +
            ': ' +
            t.capabilities
              .map((c) => `${c.mode}/${c.renderer} (${c.languages.join(',')})`)
              .join('; '),
        )
        .join('\n'),
    },
  );
}
export async function runGeneratorCli(
  argv: readonly string[],
  options: {
    signal?: AbortSignal;
    prompt?: () => GeneratorPrompt;
    out?: (message: string) => void;
    err?: (message: string) => void;
    cwd?: string;
    generator?: ProjectGenerator;
  } = {},
): Promise<number> {
  const commands = new CommandRegistry();
  registerGeneratorCommand(commands, options);
  const effective =
    Array.isArray(argv) && (!argv.length || ['--help', '-h'].includes(argv[0]))
      ? ['create', '--help']
      : argv;
  const result = await commands.dispatch(
    'zclivo',
    effective,
    options.out ?? console.log,
    { signal: options.signal },
  );
  if (result.exitCode && result.message)
    (options.err ?? console.error)(result.message);
  return result.exitCode;
}
