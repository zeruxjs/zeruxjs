import {CommandRegistry,type CommandOptions,type CommandHandler,type CommandResult,type DispatchOptions} from './commands.js';
import {color} from './colors.js';
import { join } from 'node:path';
import { ResourceScope } from './lifecycle.js';
import {loadPlugins,loadConfiguredPlugins,type LoadedPlugin} from './plugin-loader.js';
import { stripTerminalCodes } from './format.js';
import type {ParsedArgs} from './args.js';
/** Compatibility shim for ZeruxJS's existing addKey/addCommand API.
 * It schedules command dispatch after command registration, without process.exit().
 * Long-running development servers and async handlers remain alive naturally.
 */
export class ZeruxCLI {
  readonly registry=new CommandRegistry();
  private scheduled=new Set<string>();
  private execution?:Promise<CommandResult>;
  private pluginNames:string[]=[];
  private plugins:LoadedPlugin[]=[];
  private lifetime:ResourceScope;
  private disposal?:Promise<void>;
  private arguments:string[];
  constructor(argv: readonly string[]=process.argv.slice(2), private dispatchOptions:DispatchOptions={}) { this.arguments=[...argv]; this.lifetime=new ResourceScope([dispatchOptions.signal]); }
  addKey(keyword:string,options:{description?:string;func?:()=>void}={}) {
    this.registry.registerKey(keyword,options.description);options.func?.();
    if(!this.scheduled.has(keyword)){this.scheduled.add(keyword);setImmediate(()=>void this.run(keyword));}
    return this;
  }
  addCommand(keyword:string,name:string,handler:(args:ParsedArgs)=>void|Promise<void>,options:CommandOptions|string={}) {
    const settings=typeof options==='string'?{description:options}:options;
    if(this.registry.lookup(keyword,name))return this;
    this.registry.register(keyword,name,handler as CommandHandler,settings);
    return this;
  }
  enablePlugins(packages:readonly string[]) {this.pluginNames=[...packages];return this;}
  /** Explicit awaitable alternative to scheduled legacy dispatch. Caller owns cancellation. */
  run(keyword:string,options:DispatchOptions=this.dispatchOptions):Promise<CommandResult> {
    return this.execution ??= this.execute(keyword,options);
  }
  private async execute(keyword:string,options:DispatchOptions):Promise<CommandResult> {
    try {
      if (!options || typeof options !== 'object' || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) throw new TypeError('Invalid dispatch signal');
      if (options.signal && options.signal !== this.lifetime.signal) {
        const signal=options.signal; const abort=()=>this.lifetime.abort();
        if(signal.aborted)abort(); else {signal.addEventListener('abort',abort,{once:true});this.lifetime.onDispose(()=>signal.removeEventListener('abort',abort));}
      }
      options={signal:this.lifetime.signal};
      if(this.pluginNames.length)this.plugins=await loadPlugins(this.pluginNames,this.registry,process.cwd(),options);
      else this.plugins=await loadConfiguredPlugins(this.registry,process.cwd(),options).catch(e=>{ if((e as NodeJS.ErrnoException).code!=='ENOENT' || (e as NodeJS.ErrnoException).path!==join(process.cwd(),'package.json'))throw e; return []; });
      const result=await this.registry.dispatch(keyword,this.arguments,message=>this.log(message),options);
      if(result.message)this.error(result.message);
      if(result.exitCode)process.exitCode=result.exitCode;
      return result;
    }catch(error){const cancelled=this.lifetime.signal.aborted;const exitCode=cancelled?130:1;const message=cancelled?'Command cancelled':stripTerminalCodes(error instanceof Error?error.message:String(error));this.error(message);process.exitCode=exitCode;return {exitCode,message,error,...(cancelled&&{cancelled:true})};}
  }
  /** Stop cooperative commands, then release plugins. Does not stop arbitrary user apps. */
  dispose():Promise<void> {
    return this.disposal ??= this.release();
  }
  private async release():Promise<void> {
    this.lifetime.abort();
    await this.execution;
    const errors:unknown[]=[];
    for(const plugin of this.plugins.splice(0).reverse()) {try {await plugin.dispose();}catch(error){errors.push(error);}}
    errors.push(...await this.lifetime.close());
    if(errors.length)throw new AggregateError(errors,'CLI cleanup failed');
  }
  success(message:string) {console.log(`✔ ${stripTerminalCodes(message)}`);} error(message:string) {console.error(`✖ ${stripTerminalCodes(message)}`);}log(message:string){console.log(stripTerminalCodes(message));}
  readonly color = color;
}
