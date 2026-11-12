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
/** Explicit single prompt; supported choices come from registered template capabilities. */
export interface GeneratorQuestion {
  /** Fixed supported project field being requested. */
  name:
    | 'name'
    | 'destination'
    | 'language'
    | 'port'
    | 'mode'
    | 'renderer'
    | 'template';
  /** Authored terminal display text; no arbitrary code is interpreted. */
  message: string;
  /** Trusted explicit default used only when no answer is supplied. */
  defaultValue: string;
  /** Optional finite supported literals; host validates the selected capability. */
  choices?: readonly string[];
}
/** Owned prompt interface; host orchestration must close it after invocation. */
export interface GeneratorPrompt {
  /** Ask one declared question with cooperative cancellation.
   * @param {Readonly<GeneratorQuestion>} question - Trusted question and explicit supported choices.
   * @param {AbortSignal} signal - Borrowed invocation lifetime.
   * @returns {Promise<string>} Literal answer; no unbounded reprompt loop is implied.
   */
  ask(
    question: Readonly<GeneratorQuestion>,
    signal: AbortSignal
  ): Promise<string>;
  /** Release owned terminal listeners/interfaces; importing creates none. */
  close(): void | Promise<void>;
}
/** Lazy terminal owner; reusable imports do not install process signal listeners.
 * @param {object} options - Explicit borrowed streams and host interruption callback.
 * @param {Readable} options.input - Borrowed input stream; readline is created lazily for ask.
 * @param {Writable} options.output - Borrowed terminal output stream.
 * @param {() => void} options.onInterrupt - Trusted host cancellation callback.
 * @returns {GeneratorPrompt} Owned lazy prompt; shared invocation cleanup must close it.
 */
export function createTerminalGeneratorPrompt(options: {
  input: Readable;
  output: Writable;
  onInterrupt: () => void;
}): GeneratorPrompt {
  let terminal: Interface | undefined;
  let closed = false;
  /** Forward this owned terminal prompt interrupt to its trusted host callback.
   * @returns {void} Invokes the explicit interruption policy without installing a process listener.
   */
  const interrupt = () => options.onInterrupt();
  return {
    async ask(q, signal) {
      if (closed) {
        throw new Error('Generator prompt closed');
      }
      signal.throwIfAborted();
      if (!terminal) {
        terminal = createInterface({
          input: options.input,
          output: options.output,
          terminal: true,
        });
        terminal.on('SIGINT', interrupt);
      }
      /** Owned readline interface for this prompt; close removes its interrupt handler. */
      const rl = terminal;
      let ended!: () => void;
      /** Per-question terminal-close rejection barrier; its listener is removed in finally. */
      const endedPromise = new Promise<never>((_, reject) => {
        ended = () => reject(new Error('Generator input closed'));
        rl.once('close', ended);
      });
      try {
        /** Explicit user input; an empty answer selects only the trusted declared default. */
        const answer = await Promise.race([
          rl.question(
            `${q.message}${q.choices ? ' [' + q.choices.join('|') + ']' : ''} (${q.defaultValue}): `,
            { signal }
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
/** Explicit registration shared by creator packages; no template package discovery.
 * @param {CommandRegistry} commands - Borrowed registry receiving the explicit create command.
 * @param {object} options - Trusted template engine, invocation and prompt/output settings.
 * @param {string} options.keyword - Optional registered namespace, default zclivo.
 * @param {string} options.command - Optional command name, default create.
 * @param {ProjectGenerator} options.generator - Explicit supported engine; defaults to the minimal starter.
 * @param {() => GeneratorPrompt} options.prompt - Optional factory transferring prompt lifetime to invocation cleanup.
 * @param {string} options.cwd - Explicit parent for resolving a requested new destination.
 * @param {(message: string) => void} options.out - Public plan/write receipt callback.
 * @returns {void} Registers only; no handler, prompt, template render or write is run here.
 */
export function registerGeneratorCommand(
  commands: CommandRegistry,
  options: {
    keyword?: string;
    command?: string;
    generator?: ProjectGenerator;
    prompt?: () => GeneratorPrompt;
    cwd?: string;
    out?: (message: string) => void;
  } = {}
) {
  /** Explicit host generator or built-in minimal engine; no installed template scanning occurs. */
  const generator = options.generator ?? minimalProjectGenerator;
  /** Declared validated template capability snapshots driving flags and prompt choices. */
  const all = generator.capabilities();
  /** Explicit registered template names; defaults select only the first validated registration. */
  const templateIds = all.map((t) => t.id);
  /** Unique declared modes used for strict shared flag validation. */
  const modes = [
    ...new Set(all.flatMap((t) => t.capabilities.map((c) => c.mode))),
  ];
  /** Unique declared renderers; unavailable choices reject before planning. */
  const renderers = [
    ...new Set(all.flatMap((t) => t.capabilities.map((c) => c.renderer))),
  ];
  commands.register(
    options.keyword ?? 'zclivo',
    options.command ?? 'create',
    async (args, context) => {
      /** Shared schema-converted flags; repeated creator flags reject before planning. */
      const values = context.options!;
      /** Inert positional choices checked against explicit destination flags. */
      const positionals = args.positionalArgs;
      if (
        positionals.length > 1 ||
        (positionals.length && values.destination !== undefined)
      ) {
        throw new OptionError(
          'Choose one destination positional or --destination'
        );
      }
      for (const v of Object.values(values)) {
        if (Array.isArray(v)) {
          throw new OptionError('Generator flags may not repeat');
        }
      }
      let prompt: GeneratorPrompt | undefined;
      if (values.interactive) {
        if (!options.prompt) {
          throw new OptionError(
            'Interactive input requires a terminal; use --yes or explicit flags'
          );
        }
        prompt = options.prompt();
        context.onDispose(() => prompt!.close());
      }
      /** Ask only through the explicit owned prompt, otherwise select the declared default.
       * @param {GeneratorQuestion} q - Trusted bounded question and explicit choices.
       * @returns {Promise<string>} User-selected or default literal value; invalid choices are not silently retried.
       */
      const ask = async (q: GeneratorQuestion) =>
        prompt ? prompt.ask(Object.freeze(q), context.signal) : q.defaultValue;
      /** Explicit or prompted registered template identifier. */
      const template =
        typeof values.template === 'string'
          ? values.template
          : await ask({
              name: 'template',
              message: 'Template',
              // Registered generators expose at least one validated template.
              defaultValue: templateIds[0]!,
              choices: templateIds,
            });
      /** Exact registered template; unsupported choices reject visibly. */
      const t = all.find((t) => t.id === template);
      if (!t) {
        throw new OptionError('Unknown registered template');
      }
      /** Explicit positional/flag destination string without shell evaluation. */
      const supplied = String(positionals[0] ?? values.destination ?? '');
      /** Explicit/prompted project display name validated by the selected engine. */
      const name =
        typeof values.name === 'string'
          ? values.name
          : await ask({
              name: 'name',
              message: 'Project name',
              defaultValue: supplied
                ? basename(resolve(options.cwd ?? process.cwd(), supplied))
                : 'my-app',
            });
      /** Explicit or prompted new target; shared engine performs canonical ownership checks. */
      const destination =
        supplied ||
        (await ask({
          name: 'destination',
          message: 'Destination',
          defaultValue: name,
        }));
      /** Explicit/prompted supported mode from this exact template. */
      const mode =
        typeof values.mode === 'string'
          ? values.mode
          : await ask({
              name: 'mode',
              message: 'Mode',
              // Template construction validates nonempty capability lists.
              defaultValue: t.capabilities[0]!.mode,
              choices: [...new Set(t.capabilities.map((c) => c.mode))],
            });
      /** Declared capabilities matching the selected mode; empty choices reject. */
      const compatible = t.capabilities.filter((c) => c.mode === mode);
      if (!compatible.length) {
        throw new OptionError('Unsupported template mode');
      }
      /** Explicit/prompted renderer from the nonempty compatible capability set. */
      const renderer =
        typeof values.renderer === 'string'
          ? values.renderer
          : await ask({
              name: 'renderer',
              message: 'Renderer',
              // The empty compatible list was rejected immediately above.
              defaultValue: compatible[0]!.renderer,
              choices: compatible.map((c) => c.renderer),
            });
      /** Exact declared mode/renderer combination; no runtime dependency is auto-loaded. */
      const capability = compatible.find((c) => c.renderer === renderer);
      if (!capability) {
        throw new OptionError('Unsupported mode/renderer');
      }
      /** Nonempty declared language choices for the exact supported combination. */
      const languages = capability.languages;
      /** Explicit aliases/string or one bounded prompt choice, validated again during planning. */
      let language: ProjectLanguage;
      if (values.js) {
        language = 'javascript';
      } else if (values.ts) {
        language = 'typescript';
      } else if (typeof values.language === 'string') {
        language = values.language as ProjectLanguage;
      } else {
        language = (await ask({
          name: 'language',
          message: 'Language',
          defaultValue: languages.includes('typescript')
            ? 'typescript'
            : languages[0]!,
          choices: languages,
        })) as ProjectLanguage;
      }
      /** Explicit numeric flag or parsed prompt result; shared engine validates integer range. */
      const port =
        values.port === undefined
          ? Number(
              await ask({
                name: 'port',
                message: 'Port',
                defaultValue: '3000',
              })
            )
          : Number(values.port);
      if (!prompt && !supplied && values.name === undefined) {
        throw new OptionError(
          'A destination or --name is required without --interactive'
        );
      }
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
        if (error instanceof TypeError) {
          throw new OptionError(error.message);
        }
        throw error;
      }
      if (!values['dry-run']) {
        await writeProjectPlanAsync(plan, { signal: context.signal });
      }
      (options.out ?? console.log)(
        stripTerminalCodes(
          `${values['dry-run'] ? 'Would create' : 'Created'} ${plan.options.destination} (${Object.keys(plan.files).length} files)\n${Object.keys(plan.files).join('\n')}\nSHA-256 ${plan.digest}`
        )
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
              .join('; ')
        )
        .join('\n'),
    }
  );
}
/** Invoke the explicit default-keyword generator command without process signal listeners.
 * @param {readonly string[]} argv - Bounded literal command input.
 * @param {object} options - Explicit host generator/prompt/lifetime configuration.
 * @param {AbortSignal} options.signal - Borrowed cooperative cancellation signal.
 * @param {() => GeneratorPrompt} options.prompt - Optional owned prompt factory disposed by invocation cleanup.
 * @param {(message: string) => void} options.out - Public output callback.
 * @param {(message: string) => void} options.err - Diagnostic callback receiving fixed/sanitized failure text.
 * @param {string} options.cwd - Trusted generation parent directory.
 * @param {ProjectGenerator} options.generator - Explicit capability-validated engine.
 * @returns {Promise<number>} Shared command status; does not install dependencies or start generated apps.
 */
export async function runGeneratorCli(
  argv: readonly string[],
  options: {
    signal?: AbortSignal;
    prompt?: () => GeneratorPrompt;
    out?: (message: string) => void;
    err?: (message: string) => void;
    cwd?: string;
    generator?: ProjectGenerator;
  } = {}
): Promise<number> {
  /** Invocation-local registry owned by this explicit async CLI call. */
  const commands = new CommandRegistry();
  registerGeneratorCommand(commands, options);
  /** Legacy help/default invocation forms; no command is executed merely by import. */
  const effective =
    Array.isArray(argv) && (!argv.length || ['--help', '-h'].includes(argv[0]))
      ? ['create', '--help']
      : argv;
  /** Shared engine completion receipt; only this CLI convenience writes diagnostics/status. */
  const result = await commands.dispatch(
    'zclivo',
    effective,
    options.out ?? console.log,
    { signal: options.signal }
  );
  if (result.exitCode && result.message) {
    (options.err ?? console.error)(result.message);
  }
  return result.exitCode;
}
