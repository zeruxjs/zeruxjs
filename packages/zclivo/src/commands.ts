import { ArgumentError, parseArguments, type ParsedArgs } from './args.js';
import { OptionError, validateOptions, validateOptionSchema, type OptionSchema, type ValidatedOptions } from './options.js';
import { stripTerminalCodes, suggest } from './format.js';
import { ResourceScope, type Disposer } from './lifecycle.js';
export type CommandHandler = (args: ParsedArgs, context: CommandContext) => void | number | Promise<void | number>;
export interface CommandOptions { rea?: boolean; description?: string; help?: {arg: string; 'its description': string}[]; docs?: string; example?: string; aliases?: string[]; usage?: string; hidden?: boolean; flags?: OptionSchema; allowUnknownFlags?: boolean }
export interface CommandContext { keyword: string; command: string; rawArgs: string[]; options?: ValidatedOptions; signal: AbortSignal; onDispose: (dispose: Disposer) => void }
export interface DispatchOptions { signal?: AbortSignal }
export interface Command { keyword: string; name: string; options: CommandOptions; handler: CommandHandler }
export interface CommandResult { exitCode: number; command?: string; message?: string; cancelled?: boolean; /** Internal details: never print/serialize automatically. */ error?: unknown; cleanupErrors?: readonly unknown[] }
function valid(value: string, label: string) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) || value.length > 128) throw new TypeError(`Invalid ${label}`); }
export class CommandRegistry {
  private commands = new Map<string, Map<string, Command>>();
  private aliases = new Map<string, Map<string, string>>();
  private descriptions = new Map<string, string>();
  private owners = new Map<Command, AbortSignal>();
  private active = new Map<AbortSignal, Set<Promise<void>>>();
  private revision = 0;
  private retiredKeywords = new Set<string>();
  private sealed = false;
  private registrationSignal?: AbortSignal;
  registerKey(keyword: string, description = '') {
    if (this.sealed) throw new Error('Registration transaction is closed');
    valid(keyword, 'keyword');
    if (!this.registrationSignal) this.retiredKeywords.delete(keyword);
    if (typeof description !== 'string') throw new TypeError('Invalid description');
    if (!this.commands.has(keyword)) { this.commands.set(keyword, new Map()); this.aliases.set(keyword, new Map()); this.revision++; }
    if (description && this.descriptions.get(keyword) !== description) { this.descriptions.set(keyword, description); this.revision++; }
    return this;
  }
  register(keyword: string, name: string, handler: CommandHandler, options: CommandOptions = {}) {
    if (this.sealed) throw new Error('Registration transaction is closed');
    valid(keyword, 'keyword'); valid(name, 'command');
    if (typeof handler !== 'function') throw new TypeError('Command handler must be a function');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid command options');
    for (const key of ['rea', 'hidden', 'allowUnknownFlags'] as const) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new TypeError('Invalid command flag policy');
    for (const key of ['description', 'docs', 'example', 'usage'] as const) if (options[key] !== undefined && (typeof options[key] !== 'string' || options[key]!.length > 65536)) throw new TypeError('Invalid command text');
    if (options.help !== undefined && (!Array.isArray(options.help) || options.help.length > 128 || options.help.some(item => !item || typeof item.arg !== 'string' || typeof item['its description'] !== 'string'))) throw new TypeError('Invalid command help');
    if (options.flags !== undefined) validateOptionSchema(options.flags);
    if (options.aliases !== undefined && (!Array.isArray(options.aliases) || options.aliases.length > 128)) throw new TypeError('Invalid command aliases');
    const commands = this.commands.get(keyword), aliases = this.aliases.get(keyword);
    if (commands?.has(name) || aliases?.has(name)) throw new Error(`Command already registered: ${keyword} ${name}`);
    const names = new Set([name]);
    for (const alias of options.aliases ?? []) {
      valid(alias, 'alias');
      if (commands?.has(alias) || aliases?.has(alias) || names.has(alias)) throw new Error(`Command alias conflicts: ${alias}`);
      names.add(alias);
    }
    // Snapshot nested configuration so callers/plugins cannot mutate a live registry entry.
    const flags = options.flags && Object.fromEntries(Object.entries(options.flags).map(([key, flag]) => [key, Object.freeze({ ...flag, ...(flag.choices && { choices: Object.freeze([...flag.choices]) }), ...(flag.conflicts && { conflicts: Object.freeze([...flag.conflicts]) }) })]));
    const snapshot = Object.freeze({ ...options, ...(flags && { flags: Object.freeze(flags) }), ...(options.aliases && { aliases: Object.freeze([...options.aliases]) }), ...(options.help && { help: Object.freeze(options.help.map(item => Object.freeze({ ...item }))) }) }) as CommandOptions;
    const command = Object.freeze({ keyword, name, handler, options: snapshot });
    this.registerKey(keyword);
    this.commands.get(keyword)!.set(name, command);
    for (const alias of snapshot.aliases ?? []) this.aliases.get(keyword)!.set(alias, name);
    if (this.registrationSignal) this.owners.set(command, this.registrationSignal);
    this.revision++;
    return this;
  }
  /** Stage registration, then atomically commit if the live registry has not changed.
   * Returns idempotent removal of this transaction's additions, waiting for owned runs.
   * Trusted plugin code can still have external side effects; use onDispose for those.
   */
  async transaction(register: (commands: CommandRegistry) => unknown, signal?: AbortSignal): Promise<Disposer> {
    if (this.sealed) throw new Error('Registration transaction is closed');
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Invalid registration signal');
    const revision = this.revision;
    const staged = new CommandRegistry();
    staged.commands = new Map([...this.commands].map(([key, commands]) => [key, new Map(commands)]));
    staged.aliases = new Map([...this.aliases].map(([key, aliases]) => [key, new Map(aliases)]));
    staged.descriptions = new Map(this.descriptions); staged.owners = new Map(this.owners); staged.registrationSignal = signal;
    const oldKeys = new Set(this.commands.keys()), oldDescriptions = new Map(this.descriptions);
    const prior = new Set([...this.commands.values()].flatMap(commands => [...commands.values()]));
    try {
      signal?.throwIfAborted(); await register(staged); signal?.throwIfAborted();
      if (this.revision !== revision) throw new Error('Registry changed during plugin registration');
      this.commands = staged.commands; this.aliases = staged.aliases; this.descriptions = staged.descriptions; this.owners = staged.owners; this.revision++;
    } finally { staged.sealed = true; }
    const additions = [...this.commands.values()].flatMap(commands => [...commands.values()]).filter(command => !prior.has(command));
    const committedDescriptions = new Map(staged.descriptions);
    let disposed: Promise<void> | undefined;
    return () => disposed ??= (async () => {
      for (const command of additions) if (this.lookup(command.keyword, command.name) === command) {
        this.commands.get(command.keyword)!.delete(command.name);
        for (const alias of command.options.aliases ?? []) this.aliases.get(command.keyword)!.delete(alias);
        this.owners.delete(command);
      }
      // A later plugin may still use a keyword introduced by this transaction.
      // Retire it now and remove it when the last dependent registration is disposed.
      for (const key of staged.commands.keys()) if (!oldKeys.has(key)) this.retiredKeywords.add(key);
      for (const key of this.retiredKeywords) if (!this.commands.get(key)?.size) { this.commands.delete(key); this.aliases.delete(key); this.descriptions.delete(key); this.retiredKeywords.delete(key); }
      for (const [key, description] of committedDescriptions) if (this.descriptions.get(key) === description && oldDescriptions.get(key) !== description) {
        const previous = oldDescriptions.get(key); if (previous === undefined) this.descriptions.delete(key); else this.descriptions.set(key, previous);
      }
      this.revision++;
      if (signal) await Promise.all(this.active.get(signal) ?? []);
    })();
  }
  lookup(keyword: string, name: string) { const alias = this.aliases.get(keyword)?.get(name); return this.commands.get(keyword)?.get(alias ?? name); }
  list(keyword: string) { return [...(this.commands.get(keyword)?.values() ?? [])].filter(command => !command.options.hidden); }
  keywords() { return [...this.commands.keys()]; }
  help(keyword:string,command?:string):string {
    return stripTerminalCodes(this.renderHelp(keyword, command));
  }
  private renderHelp(keyword:string,command?:string):string {
    const entry=command?this.lookup(keyword,command):undefined;
    if(command&&!entry)return `Unknown command: ${command}`;
    if(entry){const opts=entry.options;return [`${keyword} ${entry.name}${opts.usage?' '+opts.usage:''}`,opts.description??'',...(opts.help??[]).map(v=>`  ${v.arg.padEnd(18)} ${v['its description']}`),...Object.entries(opts.flags??{}).map(([name,flag])=>`  --${name.padEnd(16)} ${flag.description??flag.type}`),opts.example?`Example: ${opts.example}`:''].filter(Boolean).join('\n');}
    return [`${keyword}${this.descriptions.get(keyword)?` — ${this.descriptions.get(keyword)}`:''}`, 'Commands:',...this.list(keyword).map(c=>`  ${c.name.padEnd(20)} ${c.options.description??''}`),'Use --help after a command for details.'].join('\n');
  }
  docs(keyword:string,name:string) {const command=this.lookup(keyword,name);return stripTerminalCodes(command ? command.options.docs??this.help(keyword,name):`Unknown command: ${name}`);}
  complete(keyword:string,partial='') { return this.list(keyword).flatMap(c=>[c.name,...(c.options.aliases??[])]).filter(s=>s.startsWith(partial)).sort(); }
  /** Await cooperative completion and LIFO cleanup; choose process status at the entry point. */
  async dispatch(keyword: string, args: readonly string[], output: (message: string) => void = () => {}, options: DispatchOptions = {}): Promise<CommandResult> {
    let command: Command | undefined;
    let scope: ResourceScope | undefined;
    let finish: (() => void) | undefined;
    let owner: AbortSignal | undefined;
    let completion: Promise<void> | undefined;
    let result: CommandResult;
    try {
      if (typeof keyword !== 'string' || keyword.length > 128) throw new ArgumentError('Invalid CLI keyword');
      if (!options || typeof options !== 'object') throw new ArgumentError('Invalid dispatch options');
      if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new ArgumentError('Invalid dispatch signal');
      // Validate raw argv even on help/completion paths.
      if (!Array.isArray(args) || args.length > 1024 || args.some(arg => typeof arg !== 'string' || arg.length > 8192) || args.reduce((size, arg) => size + arg.length, 0) > 65536) throw new ArgumentError('Invalid or oversized argument list');
      if (options.signal?.aborted) return { exitCode: 130, cancelled: true, message: 'Command cancelled', error: options.signal.reason };
      const emit = (message: string) => output(stripTerminalCodes(message));
      if (!this.commands.has(keyword)) return { exitCode: 2, message: stripTerminalCodes(`Unknown CLI keyword: ${keyword}.${suggest(keyword, this.keywords())}`) };
      const [first, ...rest] = args;
      if (!first || ['-h', '--help', '-l', '--list'].includes(first)) { emit(this.help(keyword)); return { exitCode: 0 }; }
      if (first === '--completion') { emit(this.complete(keyword, rest[0] ?? '').join('\n')); return { exitCode: 0 }; }
      command = this.lookup(keyword, first);
      if (!command) return { exitCode: 2, message: stripTerminalCodes(`Unknown command: ${first}.${suggest(first, this.complete(keyword))}`) };
      const beforeSeparator = rest.slice(0, rest.indexOf('--') < 0 ? rest.length : rest.indexOf('--'));
      if (beforeSeparator.includes('--help') || beforeSeparator.includes('-h')) { emit(this.help(keyword, command.name)); return { exitCode: 0, command: command.name }; }
      if (beforeSeparator.includes('--docs') || beforeSeparator.includes('-d')) { emit(this.docs(keyword, command.name)); return { exitCode: 0, command: command.name }; }
      const booleans = Object.entries(command.options.flags ?? {}).filter(([, flag]) => flag.type === 'boolean').flatMap(([name, flag]) => [name, ...(flag.alias ? [flag.alias] : [])]);
      const parsed = parseArguments(rest, booleans);
      const validated = command.options.flags ? validateOptions(parsed, command.options.flags, command.options.allowUnknownFlags) : undefined;
      owner = this.owners.get(command);
      scope = new ResourceScope([options.signal, owner]);
      scope.signal.throwIfAborted();
      if (owner) {
        completion = new Promise<void>(resolve => { finish = resolve; });
        if (!this.active.has(owner)) this.active.set(owner, new Set());
        this.active.get(owner)!.add(completion);
      }
      const code = await command.handler(parsed, { keyword, command: command.name, rawArgs: rest, options: validated, signal: scope.signal, onDispose: scope.onDispose });
      if (code !== undefined && (!Number.isInteger(code) || code < 0 || code > 255)) throw new TypeError('Command exit status must be an integer from 0 to 255');
      result = scope.signal.aborted ? { exitCode: 130, cancelled: true, message: 'Command cancelled', error: scope.signal.reason } : { exitCode: code ?? 0 };
    } catch (error) {
      const cancelled = scope?.signal.aborted === true;
      result = { exitCode: cancelled ? 130 : error instanceof ArgumentError || error instanceof OptionError ? 2 : 1, ...(cancelled && { cancelled: true }), error, message: cancelled ? 'Command cancelled' : stripTerminalCodes(error instanceof Error ? error.message : String(error)) };
    }
    if (scope) {
      const errors = await scope.close();
      if (errors.length) result = { ...result, exitCode: result.cancelled ? 130 : 1, message: 'Command resource cleanup failed', cleanupErrors: Object.freeze(errors) };
    }
    if (owner && completion) { this.active.get(owner)?.delete(completion); if (!this.active.get(owner)?.size) this.active.delete(owner); finish?.(); }
    return { ...result, ...(command && { command: command.name }) };
  }
}
