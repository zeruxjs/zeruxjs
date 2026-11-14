import {
  CommandRegistry,
  type CommandOptions,
  type CommandHandler,
  type CommandResult,
  type DispatchOptions,
} from './commands.js';
import { color } from './colors.js';
import { join } from 'node:path';
import { ResourceScope } from './lifecycle.js';
import {
  loadPlugins,
  loadConfiguredPlugins,
  type LoadedPlugin,
} from './plugin-loader.js';
import { stripTerminalCodes } from './format.js';
import type { ParsedArgs } from './args.js';
/** Compatibility shim for ZeruxJS's existing addKey/addCommand API.
 * It schedules command dispatch after command registration, without process.exit().
 * Long-running development servers and async handlers remain alive naturally.
 */
export class ZeruxCLI {
  /** Explicit per-instance modern registry; command registration stays inert. */
  readonly registry = new CommandRegistry();
  /** Legacy keywords already scheduled for one later event-loop dispatch. */
  private scheduled = new Set<string>();
  /** Single shared dispatch settlement; repeated run returns the same invocation. */
  private execution?: Promise<CommandResult>;
  /** Explicit trusted allowlisted plugin names; no node_modules scan is performed. */
  private pluginNames: string[] = [];
  /** Owned loaded plugin records retained until actual disposal. */
  private plugins: LoadedPlugin[] = [];
  /** Owned cooperative lifetime shared by invocation and loaded plugins. */
  private lifetime: ResourceScope;
  /** Memoized actual-settlement cleanup promise. */
  private disposal?: Promise<void>;
  /** Private snapshot of CLI argv, never read again from changing process state. */
  private arguments: string[];
  /** Snapshot arguments and attach explicit cooperative lifetime policy.
   * @param {readonly string[]} argv - Explicit legacy input; defaults to the entry process arguments.
   * @param {DispatchOptions} dispatchOptions - Borrowed upstream cancellation policy.
   */
  constructor(
    argv: readonly string[] = process.argv.slice(2),
    private dispatchOptions: DispatchOptions = {}
  ) {
    this.arguments = [...argv];
    this.lifetime = new ResourceScope([dispatchOptions.signal]);
  }
  /** Register a keyword and schedule its one legacy dispatch after synchronous registration.
   * @param {string} keyword - Bounded literal CLI keyword.
   * @param {{description?: string, func?: () => void}} options - Legacy description and trusted synchronous registration callback.
   * @param {string} options.description - Display text sanitized when rendered.
   * @param {() => void} options.func - Trusted immediate registration callback, not user content.
   * @returns {this} This compatibility instance for chaining.
   */
  addKey(
    keyword: string,
    options: { description?: string; func?: () => void } = {}
  ) {
    this.registry.registerKey(keyword, options.description);
    options.func?.();
    if (!this.scheduled.has(keyword)) {
      this.scheduled.add(keyword);
      setImmediate(() => void this.run(keyword));
    }
    return this;
  }
  /** Register a compatible handler without replacing an existing command.
   * @param {string} keyword - Existing/new literal registry keyword.
   * @param {string} name - Literal bounded command name.
   * @param {(args: ParsedArgs) => void | Promise<void>} handler - Trusted application handler with legacy parsed arguments.
   * @param {CommandOptions | string} options - Modern command policy or legacy description text.
   * @returns {this} This compatibility instance for chaining.
   */
  addCommand(
    keyword: string,
    name: string,
    handler: (args: ParsedArgs) => void | Promise<void>,
    options: CommandOptions | string = {}
  ) {
    /** Legacy string descriptions normalize to the explicit modern command option object. */
    const settings =
      typeof options === 'string' ? { description: options } : options;
    if (this.registry.lookup(keyword, name)) {
      return this;
    }
    this.registry.register(keyword, name, handler as CommandHandler, settings);
    return this;
  }
  /** Snapshot an explicit package allowlist; actual validation/activation occurs during run.
   * @param {readonly string[]} packages - Trusted host-selected plugin names.
   * @returns {this} This instance; no module is imported here.
   */
  enablePlugins(packages: readonly string[]) {
    this.pluginNames = [...packages];
    return this;
  }
  /** Explicit awaitable alternative to scheduled legacy dispatch. Caller owns cancellation.
   * @param {string} keyword - Registered keyword to dispatch once.
   * @param {DispatchOptions} options - Explicit cooperative lifetime policy.
   * @returns {Promise<CommandResult>} Shared single invocation settlement.
   */
  run(
    keyword: string,
    options: DispatchOptions = this.dispatchOptions
  ): Promise<CommandResult> {
    return (this.execution ??= this.execute(keyword, options));
  }
  /** Activate explicit plugins and dispatch while retaining legacy process status ownership.
   * @param {string} keyword - Literal registered keyword.
   * @param {DispatchOptions} options - Borrowed invocation cancellation policy.
   * @returns {Promise<CommandResult>} Sanitized receipt with raw private failures retained internally.
   */
  private async execute(
    keyword: string,
    options: DispatchOptions
  ): Promise<CommandResult> {
    try {
      if (
        !options ||
        typeof options !== 'object' ||
        (options.signal !== undefined &&
          !(options.signal instanceof AbortSignal))
      ) {
        throw new TypeError('Invalid dispatch signal');
      }
      if (options.signal && options.signal !== this.lifetime.signal) {
        /** Borrowed invocation signal forwarded into the CLI-owned lifetime. */
        const signal = options.signal;
        /** Forward borrowed cancellation into the CLI lifetime without a process listener.
         * @returns {void} Aborts the CLI scope cooperatively.
         */
        const abort = () => this.lifetime.abort();
        if (signal.aborted) {
          abort();
        } else {
          signal.addEventListener('abort', abort, { once: true });
          this.lifetime.onDispose(() =>
            signal.removeEventListener('abort', abort)
          );
        }
      }
      options = { signal: this.lifetime.signal };
      if (this.pluginNames.length) {
        this.plugins = await loadPlugins(
          this.pluginNames,
          this.registry,
          process.cwd(),
          options
        );
      } else {
        this.plugins = await loadConfiguredPlugins(
          this.registry,
          process.cwd(),
          options
        ).catch((e) => {
          if (
            (e as NodeJS.ErrnoException).code !== 'ENOENT' ||
            (e as NodeJS.ErrnoException).path !==
              join(process.cwd(), 'package.json')
          ) {
            throw e;
          }
          return [];
        });
      }
      /** Modern dispatch receipt; this compatibility entry owns process.exitCode selection. */
      const result = await this.registry.dispatch(
        keyword,
        this.arguments,
        (message) => this.log(message),
        options
      );
      if (result.message) {
        this.error(result.message);
      }
      if (result.exitCode) {
        process.exitCode = result.exitCode;
      }
      return result;
    } catch (error) {
      /** Whether cooperative lifetime cancellation determines the legacy failure status. */
      const cancelled = this.lifetime.signal.aborted;
      /** Legacy entry-point status, retaining cancellation130 versus ordinary failure1. */
      const exitCode = cancelled ? 130 : 1;
      /** Terminal-sanitized public diagnostic; raw error remains private in the receipt. */
      const message = cancelled
        ? 'Command cancelled'
        : stripTerminalCodes(
            error instanceof Error ? error.message : String(error)
          );
      this.error(message);
      process.exitCode = exitCode;
      return {
        exitCode,
        message,
        error,
        ...(cancelled && { cancelled: true }),
      };
    }
  }
  /** Stop cooperative commands, then release plugins. Does not stop arbitrary user apps.
   * @returns {Promise<void>} Shared teardown settlement after active invocation and loaded plugins finish.
   */
  dispose(): Promise<void> {
    return (this.disposal ??= this.release());
  }
  /** Abort first, await invocation completion, then attempt every plugin and scope cleanup.
   * @returns {Promise<void>} Teardown settlement or aggregate of private cleanup failures.
   */
  private async release(): Promise<void> {
    this.lifetime.abort();
    await this.execution;
    /** Private teardown causes collected while attempting every loaded plugin owner. */
    const errors: unknown[] = [];
    for (const plugin of this.plugins.splice(0).reverse()) {
      try {
        await plugin.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    errors.push(...(await this.lifetime.close()));
    if (errors.length) {
      throw new AggregateError(errors, 'CLI cleanup failed');
    }
  }
  /** Emit a terminal-sanitized success line.
   * @param {string} message - Application display text; secrets must be redacted by the host.
   * @returns {void} Writes to the corresponding process console stream.
   */
  success(message: string) {
    console.log(`✔ ${stripTerminalCodes(message)}`);
  }
  /** Emit a terminal-sanitized failure line.
   * @param {string} message - Application display text; secrets must be redacted by the host.
   * @returns {void} Writes to the corresponding process console stream.
   */
  error(message: string) {
    console.error(`✖ ${stripTerminalCodes(message)}`);
  }
  /** Emit terminal-sanitized ordinary output.
   * @param {string} message - Application display text; secrets must be redacted by the host.
   * @returns {void} Writes to the corresponding process console stream.
   */
  log(message: string) {
    console.log(stripTerminalCodes(message));
  }
  /** Explicit style factory; arbitrary application values remain caller-owned. */
  readonly color = color;
}
