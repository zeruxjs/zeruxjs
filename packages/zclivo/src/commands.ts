import { ArgumentError, parseArguments, type ParsedArgs } from './args.js';
import {
  OptionError,
  validateOptions,
  validateOptionSchema,
  type OptionSchema,
  type ValidatedOptions,
} from './options.js';
import { stripTerminalCodes, suggest } from './format.js';
import { ResourceScope, type Disposer } from './lifecycle.js';
/** Trusted handler whose Promise must cover its whole resource lifetime. */
export type CommandHandler = (
  args: ParsedArgs,
  context: CommandContext
) => void | number | Promise<void | number>;
/** Registration-time trusted command policy snapshotted before publication. */
/** Validated immutable registration record with trusted executable handler. */
export interface CommandOptions {
  /** Retained compatibility flag; validated but does not add a runtime lifecycle policy. */
  rea?: boolean;
  /** Help description sanitized at display time. */
  description?: string;
  /** Legacy argument help entries; display strings only. */
  help?: { arg: string; 'its description': string }[];
  /** Optional authored documentation text; never evaluated. */
  docs?: string;
  /** Optional authored example display text; never executed. */
  example?: string;
  /** Explicit bounded alternative command spellings. */
  aliases?: string[];
  /** Authored usage display text. */
  usage?: string;
  /** Hide this command from listing/completion without granting authorization. */
  hidden?: boolean;
  /** Optional strict scalar option schema. */
  flags?: OptionSchema;
  /** Explicit legacy opt-in for unrecognized flags under a schema. */
  allowUnknownFlags?: boolean;
}
/** Invocation-local context; identity/authorization remain host responsibilities. */
export interface CommandContext {
  /** Validated literal namespace for this registration/invocation. */
  keyword: string;
  /** Canonical command name selected for this invocation. */
  command: string;
  /** Inert argument snapshot after command selection. */
  rawArgs: string[];
  /** Converted options or trusted registration policy according to this interface. */
  options?: ValidatedOptions;
  /** Cooperative lifetime owned by the invocation or supplied by its host. */
  signal: AbortSignal;
  /** Register trusted cleanup immediately after acquiring a resource. */
  onDispose: (dispose: Disposer) => void;
}
/** Explicit cooperative cancellation without global process listeners. */
export interface DispatchOptions {
  /** Cooperative lifetime owned by the invocation or supplied by its host. */
  signal?: AbortSignal;
}
export interface Command {
  /** Validated literal namespace for this registration/invocation. */
  keyword: string;
  /** Canonical validated command name. */
  name: string;
  /** Converted options or trusted registration policy according to this interface. */
  options: CommandOptions;
  /** Trusted executable application callback, never client-supplied text. */
  handler: CommandHandler;
}
/** Explicit dispatch receipt; raw failures and cleanup causes stay private. */
export interface CommandResult {
  /** Explicit integer process status; reusable dispatch never sets process.exitCode. */
  exitCode: number;
  /** Canonical command name selected for this invocation. */
  command?: string;
  /** Terminal-safe public diagnostic, without automatic credential redaction. */
  message?: string;
  /** Whether cooperative cancellation selected the outcome. */
  cancelled?: boolean;
  /** Internal details: never print/serialize automatically. */ error?: unknown;
  /** Private bounded cleanup failures; never serialize automatically. */
  cleanupErrors?: readonly unknown[];
}
/** Require a bounded literal keyword/command/alias identifier.
 * @param {string} value - Candidate registration identifier.
 * @param {string} label - Trusted diagnostic category, not executable input.
 * @returns {void} Returns after validation or throws before registry mutation.
 */
function valid(value: string, label: string) {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) ||
    value.length > 128
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
}
/** Instance-scoped command registry with staged plugin registration and invocation cleanup ownership. */
export class CommandRegistry {
  /** Canonical per-keyword command records. */
  private commands = new Map<string, Map<string, Command>>();
  /** Per-keyword alias-to-canonical mappings. */
  private aliases = new Map<string, Map<string, string>>();
  /** Authored keyword display text. */
  private descriptions = new Map<string, string>();
  /** Command-to-plugin cancellation ownership, distinct from authentication. */
  private owners = new Map<Command, AbortSignal>();
  /** Actual owned invocation settlement promises grouped by plugin lifetime. */
  private active = new Map<AbortSignal, Set<Promise<void>>>();
  /** Monotonic process-local mutation fence, not distributed locking. */
  private revision = 0;
  /** Keywords pending removal once their last dependent registration is gone. */
  private retiredKeywords = new Set<string>();
  /** Whether this staging registry has committed or failed and must reject later registration. */
  private sealed = false;
  /** Borrowed plugin lifetime assigned only to new staged registrations. */
  private registrationSignal?: AbortSignal;
  /** Register a literal keyword without executing a command.
   * @param {string} keyword - Bounded namespace identifier.
   * @param {string} description - Authored display text.
   * @returns {this} This registry for explicit registration chaining.
   */
  registerKey(keyword: string, description = '') {
    if (this.sealed) {
      throw new Error('Registration transaction is closed');
    }
    valid(keyword, 'keyword');
    if (!this.registrationSignal) {
      this.retiredKeywords.delete(keyword);
    }
    if (typeof description !== 'string') {
      throw new TypeError('Invalid description');
    }
    if (!this.commands.has(keyword)) {
      this.commands.set(keyword, new Map());
      this.aliases.set(keyword, new Map());
      this.revision++;
    }
    if (description && this.descriptions.get(keyword) !== description) {
      this.descriptions.set(keyword, description);
      this.revision++;
    }
    return this;
  }
  /** Validate and snapshot a trusted handler/options record before publishing it.
   * @param {string} keyword - Bounded literal namespace.
   * @param {string} name - Bounded canonical command name.
   * @param {CommandHandler} handler - Trusted application callback, not executed here.
   * @param {CommandOptions} options - Registration-time aliases/help/schema policy.
   * @returns {this} This registry after successful publication.
   */
  register(
    keyword: string,
    name: string,
    handler: CommandHandler,
    options: CommandOptions = {}
  ) {
    if (this.sealed) {
      throw new Error('Registration transaction is closed');
    }
    valid(keyword, 'keyword');
    valid(name, 'command');
    if (typeof handler !== 'function') {
      throw new TypeError('Command handler must be a function');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Invalid command options');
    }
    for (const key of ['rea', 'hidden', 'allowUnknownFlags'] as const) {
      if (options[key] !== undefined && typeof options[key] !== 'boolean') {
        throw new TypeError('Invalid command flag policy');
      }
    }
    for (const key of ['description', 'docs', 'example', 'usage'] as const) {
      if (
        options[key] !== undefined &&
        (typeof options[key] !== 'string' || options[key]!.length > 65536)
      ) {
        throw new TypeError('Invalid command text');
      }
    }
    if (
      options.help !== undefined &&
      (!Array.isArray(options.help) ||
        options.help.length > 128 ||
        options.help.some(
          (item) =>
            !item ||
            typeof item.arg !== 'string' ||
            typeof item['its description'] !== 'string'
        ))
    ) {
      throw new TypeError('Invalid command help');
    }
    if (options.flags !== undefined) {
      validateOptionSchema(options.flags);
    }
    if (
      options.aliases !== undefined &&
      (!Array.isArray(options.aliases) || options.aliases.length > 128)
    ) {
      throw new TypeError('Invalid command aliases');
    }
    /** Current keyword command map; live mutation occurs only after validation. */
    const commands = this.commands.get(keyword);
    /** Current keyword alias map, separate from canonical command records. */
    const aliases = this.aliases.get(keyword);
    if (commands?.has(name) || aliases?.has(name)) {
      throw new Error(`Command already registered: ${keyword} ${name}`);
    }
    /** Canonical name and new aliases checked for conflicts before registration. */
    const names = new Set([name]);
    for (const alias of options.aliases ?? []) {
      valid(alias, 'alias');
      if (commands?.has(alias) || aliases?.has(alias) || names.has(alias)) {
        throw new Error(`Command alias conflicts: ${alias}`);
      }
      names.add(alias);
    }
    // Snapshot nested configuration so callers/plugins cannot mutate a live registry entry.
    /** Frozen nested flag policy preventing mutation of an installed command definition. */
    const flags =
      options.flags &&
      Object.fromEntries(
        Object.entries(options.flags).map(([key, flag]) => [
          key,
          Object.freeze({
            ...flag,
            ...(flag.choices && { choices: Object.freeze([...flag.choices]) }),
            ...(flag.conflicts && {
              conflicts: Object.freeze([...flag.conflicts]),
            }),
          }),
        ])
      );
    /** Shallow frozen command options with independently frozen nested registration data. */
    const snapshot = Object.freeze({
      ...options,
      ...(flags && { flags: Object.freeze(flags) }),
      ...(options.aliases && { aliases: Object.freeze([...options.aliases]) }),
      ...(options.help && {
        help: Object.freeze(
          options.help.map((item) => Object.freeze({ ...item }))
        ),
      }),
    }) as CommandOptions;
    /** Validated command record or exact command selected for a documentation lookup. */
    const command = Object.freeze({
      keyword,
      name,
      handler,
      options: snapshot,
    });
    this.registerKey(keyword);
    this.commands.get(keyword)!.set(name, command);
    for (const alias of snapshot.aliases ?? []) {
      this.aliases.get(keyword)!.set(alias, name);
    }
    if (this.registrationSignal) {
      this.owners.set(command, this.registrationSignal);
    }
    this.revision++;
    return this;
  }
  /** Stage registration, then atomically commit if the live registry has not changed.
   * Returns idempotent removal of this transaction's additions, waiting for owned runs.
   * Trusted plugin code can still have external side effects; use onDispose for those.
   * @param {(commands: CommandRegistry) => unknown} register - Trusted callback receiving only the staged registry.
   * @param {AbortSignal} signal - Optional borrowed plugin lifetime; abort before waiting for long-running owned commands.
   * @returns {Promise<Disposer>} Idempotent removal callback for this transaction's additions and actual owned settlement.
   */
  async transaction(
    register: (commands: CommandRegistry) => unknown,
    signal?: AbortSignal
  ): Promise<Disposer> {
    if (this.sealed) {
      throw new Error('Registration transaction is closed');
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError('Invalid registration signal');
    }
    /** Pinned live registry revision; concurrent mutation prevents staged commit. */
    const revision = this.revision;
    /** Isolated registry clone whose registrations seal after commit or failure. */
    const staged = new CommandRegistry();
    staged.commands = new Map(
      [...this.commands].map(([key, commands]) => [key, new Map(commands)])
    );
    staged.aliases = new Map(
      [...this.aliases].map(([key, aliases]) => [key, new Map(aliases)])
    );
    staged.descriptions = new Map(this.descriptions);
    staged.owners = new Map(this.owners);
    staged.registrationSignal = signal;
    /** Live keyword identities before this transaction added any registrations. */
    const oldKeys = new Set(this.commands.keys());
    /** Live descriptions retained so removal does not overwrite a later plugin change. */
    const oldDescriptions = new Map(this.descriptions);
    /** Existing command object identities used to identify only this transaction's additions. */
    const prior = new Set(
      [...this.commands.values()].flatMap((commands) => [...commands.values()])
    );
    try {
      signal?.throwIfAborted();
      await register(staged);
      signal?.throwIfAborted();
      if (this.revision !== revision) {
        throw new Error('Registry changed during plugin registration');
      }
      this.commands = staged.commands;
      this.aliases = staged.aliases;
      this.descriptions = staged.descriptions;
      this.owners = staged.owners;
      this.revision++;
    } finally {
      staged.sealed = true;
    }
    /** New command records owned by this transaction, excluding existing borrowed commands. */
    const additions = [...this.commands.values()]
      .flatMap((commands) => [...commands.values()])
      .filter((command) => !prior.has(command));
    /** Descriptions installed by this exact staged commit. */
    const committedDescriptions = new Map(staged.descriptions);
    let disposed: Promise<void> | undefined;
    return () =>
      (disposed ??= (async () => {
        for (const command of additions) {
          if (this.lookup(command.keyword, command.name) === command) {
            this.commands.get(command.keyword)!.delete(command.name);
            for (const alias of command.options.aliases ?? []) {
              this.aliases.get(command.keyword)!.delete(alias);
            }
            this.owners.delete(command);
          }
        }
        // A later plugin may still use a keyword introduced by this transaction.
        // Retire it now and remove it when the last dependent registration is disposed.
        for (const key of staged.commands.keys()) {
          if (!oldKeys.has(key)) {
            this.retiredKeywords.add(key);
          }
        }
        for (const key of this.retiredKeywords) {
          if (!this.commands.get(key)?.size) {
            this.commands.delete(key);
            this.aliases.delete(key);
            this.descriptions.delete(key);
            this.retiredKeywords.delete(key);
          }
        }
        for (const [key, description] of committedDescriptions) {
          if (
            this.descriptions.get(key) === description &&
            oldDescriptions.get(key) !== description
          ) {
            /** Prior description restored only while the transaction's committed value still matches. */
            const previous = oldDescriptions.get(key);
            if (previous === undefined) {
              this.descriptions.delete(key);
            } else {
              this.descriptions.set(key, previous);
            }
          }
        }
        this.revision++;
        if (signal) {
          await Promise.all(this.active.get(signal) ?? []);
        }
      })());
  }
  /** Resolve a canonical command or explicitly registered alias.
   * @param {string} keyword - Literal namespace to inspect.
   * @param {string} name - Canonical name or alias.
   * @returns {Command | undefined} Borrowed immutable command record, if registered.
   */
  lookup(keyword: string, name: string) {
    /** Canonical command name for an explicitly registered alias. */
    const alias = this.aliases.get(keyword)?.get(name);
    return this.commands.get(keyword)?.get(alias ?? name);
  }
  /** List visible canonical commands without executing them.
   * @param {string} keyword - Literal namespace to inspect.
   * @returns {Command[]} New array of borrowed immutable registrations.
   */
  list(keyword: string) {
    return [...(this.commands.get(keyword)?.values() ?? [])].filter(
      (command) => !command.options.hidden
    );
  }
  /** List currently registered namespaces.
   * @returns {string[]} New insertion-ordered namespace array.
   */
  keywords() {
    return [...this.commands.keys()];
  }
  /** Render sanitized help for a namespace or one command.
   * @param {string} keyword - Literal namespace.
   * @param {string} command - Optional canonical command or alias.
   * @returns {string} Terminal-safe display text, not an execution or authorization decision.
   */
  help(keyword: string, command?: string): string {
    return stripTerminalCodes(this.renderHelp(keyword, command));
  }
  /** Build help from trusted immutable registration metadata before terminal sanitization.
   * @param {string} keyword - Literal namespace.
   * @param {string} command - Optional canonical name or alias.
   * @returns {string} Raw authored help text, sanitized by the public help wrapper.
   */
  private renderHelp(keyword: string, command?: string): string {
    /** Exact registered command for this help lookup, if one exists. */
    const entry = command ? this.lookup(keyword, command) : undefined;
    if (command && !entry) {
      return `Unknown command: ${command}`;
    }
    if (entry) {
      /** Frozen trusted command options displayed through terminal-safe rendering. */
      const opts = entry.options;
      return [
        `${keyword} ${entry.name}${opts.usage ? ' ' + opts.usage : ''}`,
        opts.description ?? '',
        ...(opts.help ?? []).map(
          (v) => `  ${v.arg.padEnd(18)} ${v['its description']}`
        ),
        ...Object.entries(opts.flags ?? {}).map(
          ([name, flag]) =>
            `  --${name.padEnd(16)} ${flag.description ?? flag.type}`
        ),
        opts.example ? `Example: ${opts.example}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    return [
      `${keyword}${this.descriptions.get(keyword) ? ` — ${this.descriptions.get(keyword)}` : ''}`,
      'Commands:',
      ...this.list(keyword).map(
        (c) => `  ${c.name.padEnd(20)} ${c.options.description ?? ''}`
      ),
      'Use --help after a command for details.',
    ].join('\n');
  }
  /** Read authored documentation or fallback help without evaluating text.
   * @param {string} keyword - Literal namespace.
   * @param {string} name - Canonical command or alias.
   * @returns {string} Terminal-safe documentation or unknown-command diagnostic.
   */
  docs(keyword: string, name: string) {
    /** Validated command record or exact command selected for a documentation lookup. */
    const command = this.lookup(keyword, name);
    return stripTerminalCodes(
      command
        ? (command.options.docs ?? this.help(keyword, name))
        : `Unknown command: ${name}`
    );
  }
  /** Suggest visible names and aliases with deterministic ordering.
   * @param {string} keyword - Literal namespace.
   * @param {string} partial - Literal startsWith prefix; no regex evaluation occurs.
   * @returns {string[]} Sorted matching names without executing any handler.
   */
  complete(keyword: string, partial = '') {
    return this.list(keyword)
      .flatMap((c) => [c.name, ...(c.options.aliases ?? [])])
      .filter((s) => s.startsWith(partial))
      .sort();
  }
  /** Await cooperative completion and LIFO cleanup; choose process status at the entry point.
   * @param {string} keyword - Literal registered namespace.
   * @param {readonly string[]} args - Explicit bounded inert argv.
   * @param {(message: string) => void} output - Borrowed display callback receiving terminal-safe text.
   * @param {DispatchOptions} options - Explicit borrowed cancellation policy.
   * @returns {Promise<CommandResult>} Receipt after handler and owned cleanup actually settle; no forced cancellation is claimed.
   */
  async dispatch(
    keyword: string,
    args: readonly string[],
    output: (message: string) => void = () => {},
    options: DispatchOptions = {}
  ): Promise<CommandResult> {
    let command: Command | undefined;
    let scope: ResourceScope | undefined;
    let finish: (() => void) | undefined;
    let owner: AbortSignal | undefined;
    let completion: Promise<void> | undefined;
    let result: CommandResult;
    try {
      if (typeof keyword !== 'string' || keyword.length > 128) {
        throw new ArgumentError('Invalid CLI keyword');
      }
      if (!options || typeof options !== 'object') {
        throw new ArgumentError('Invalid dispatch options');
      }
      if (
        options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)
      ) {
        throw new ArgumentError('Invalid dispatch signal');
      }
      // Validate raw argv even on help/completion paths.
      if (
        !Array.isArray(args) ||
        args.length > 1024 ||
        args.some((arg) => typeof arg !== 'string' || arg.length > 8192) ||
        args.reduce((size, arg) => size + arg.length, 0) > 65536
      ) {
        throw new ArgumentError('Invalid or oversized argument list');
      }
      if (options.signal?.aborted) {
        return {
          exitCode: 130,
          cancelled: true,
          message: 'Command cancelled',
          error: options.signal.reason,
        };
      }
      /** Sanitize terminal controls before invoking the borrowed output callback.
       * @param {string} message - Trusted generated help/receipt text.
       * @returns {void} Invokes the host output callback without selecting a command.
       */
      const emit = (message: string) => output(stripTerminalCodes(message));
      if (!this.commands.has(keyword)) {
        return {
          exitCode: 2,
          message: stripTerminalCodes(
            `Unknown CLI keyword: ${keyword}.${suggest(keyword, this.keywords())}`
          ),
        };
      }
      /** Explicit command token and remaining inert arguments; no process globals are consulted. */
      const [first, ...rest] = args;
      if (!first || ['-h', '--help', '-l', '--list'].includes(first)) {
        emit(this.help(keyword));
        return { exitCode: 0 };
      }
      if (first === '--completion') {
        emit(this.complete(keyword, rest[0] ?? '').join('\n'));
        return { exitCode: 0 };
      }
      command = this.lookup(keyword, first);
      if (!command) {
        return {
          exitCode: 2,
          message: stripTerminalCodes(
            `Unknown command: ${first}.${suggest(first, this.complete(keyword))}`
          ),
        };
      }
      /** Only flags before -- can request help/docs; later values remain positional data. */
      const beforeSeparator = rest.slice(
        0,
        rest.indexOf('--') < 0 ? rest.length : rest.indexOf('--')
      );
      if (
        beforeSeparator.includes('--help') ||
        beforeSeparator.includes('-h')
      ) {
        emit(this.help(keyword, command.name));
        return { exitCode: 0, command: command.name };
      }
      if (
        beforeSeparator.includes('--docs') ||
        beforeSeparator.includes('-d')
      ) {
        emit(this.docs(keyword, command.name));
        return { exitCode: 0, command: command.name };
      }
      /** Declared canonical/alias boolean spellings controlling legacy parser value consumption. */
      const booleans = Object.entries(command.options.flags ?? {})
        .filter(([, flag]) => flag.type === 'boolean')
        .flatMap(([name, flag]) => [name, ...(flag.alias ? [flag.alias] : [])]);
      /** Bounded inert argument data, independent of schema conversion. */
      const parsed = parseArguments(rest, booleans);
      /** Explicit schema-converted values, or undefined for the legacy unschematized path. */
      const validated = command.options.flags
        ? validateOptions(
            parsed,
            command.options.flags,
            command.options.allowUnknownFlags
          )
        : undefined;
      owner = this.owners.get(command);
      scope = new ResourceScope([options.signal, owner]);
      scope.signal.throwIfAborted();
      if (owner) {
        completion = new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (!this.active.has(owner)) {
          this.active.set(owner, new Set());
        }
        this.active.get(owner)!.add(completion);
      }
      /** Actual handler settlement; finite integer status is validated before reporting success. */
      const code = await command.handler(parsed, {
        keyword,
        command: command.name,
        rawArgs: rest,
        options: validated,
        signal: scope.signal,
        onDispose: scope.onDispose,
      });
      if (
        code !== undefined &&
        (!Number.isInteger(code) || code < 0 || code > 255)
      ) {
        throw new TypeError(
          'Command exit status must be an integer from 0 to 255'
        );
      }
      result = scope.signal.aborted
        ? {
            exitCode: 130,
            cancelled: true,
            message: 'Command cancelled',
            error: scope.signal.reason,
          }
        : { exitCode: code ?? 0 };
    } catch (error) {
      /** Observed cooperative signal state; private abort reason is retained only internally. */
      const cancelled = scope?.signal.aborted === true;
      /** Preserve cancellation precedence over usage and ordinary handler failures. */
      let exitCode;
      if (cancelled) {
        exitCode = 130;
      } else if (
        error instanceof ArgumentError ||
        error instanceof OptionError
      ) {
        exitCode = 2;
      } else {
        exitCode = 1;
      }
      result = {
        exitCode,
        ...(cancelled && { cancelled: true }),
        error,
        message: cancelled
          ? 'Command cancelled'
          : stripTerminalCodes(
              error instanceof Error ? error.message : String(error)
            ),
      };
    }
    if (scope) {
      /** Private cleanup failures returned after every invocation disposer settles. */
      const errors = await scope.close();
      if (errors.length) {
        result = {
          ...result,
          exitCode: result.cancelled ? 130 : 1,
          message: 'Command resource cleanup failed',
          cleanupErrors: Object.freeze(errors),
        };
      }
    }
    if (owner && completion) {
      this.active.get(owner)?.delete(completion);
      if (!this.active.get(owner)?.size) {
        this.active.delete(owner);
      }
      finish?.();
    }
    return { ...result, ...(command && { command: command.name }) };
  }
}
