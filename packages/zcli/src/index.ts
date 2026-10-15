/** ZCLI – composable, side-effect-light CLI command registry. */
import { ZeruxCLI } from './legacy.js';
export { ZeruxCLI } from './legacy.js';
export { CommandRegistry } from './commands.js';
export type { Command,CommandHandler,CommandContext,CommandOptions,CommandResult } from './commands.js';
export { parseArguments, ArgumentError } from './args.js';
export type { ParsedArgs } from './args.js';
export { resolvePluginEntry,PluginEntryError } from './plugins.js';
export { loadPlugins,loadConfiguredPlugins } from './plugin-loader.js';
export type { PluginContext,LoadedPlugin } from './plugin-loader.js';
export { formatError,stripTerminalCodes } from './format.js';
export { color } from './colors.js';
export { validateOptions } from './options.js';
export type {OptionSchema, OptionDefinition, ValidatedOptions} from './options.js';
/** Legacy shared instance used by zeruxjs/bin/zerux.ts. */
export const cli = new ZeruxCLI();
export default cli;
