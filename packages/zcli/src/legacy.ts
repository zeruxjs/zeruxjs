import {CommandRegistry,type CommandOptions,type CommandHandler} from './commands.js';
import {color} from './colors.js';
import {loadPlugins,loadConfiguredPlugins} from './plugin-loader.js';
import type {ParsedArgs} from './args.js';
/** Compatibility shim for ZeruxJS's existing addKey/addCommand API.
 * It schedules command dispatch after command registration, without process.exit().
 * Long-running development servers and async handlers remain alive naturally.
 */
export class ZeruxCLI {
  readonly registry=new CommandRegistry();
  private scheduled=new Set<string>();
  private executed=false;
  private pluginNames:string[]=[];
  private arguments:string[];
  constructor(argv: readonly string[]=process.argv.slice(2)) { this.arguments=[...argv]; }
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
  private async run(keyword:string) {
    if(this.executed)return;this.executed=true;
    try {
      if(this.pluginNames.length)await loadPlugins(this.pluginNames,this.registry);
      else await loadConfiguredPlugins(this.registry).catch(e=>{ if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; });
      const result=await this.registry.dispatch(keyword,this.arguments,message=>this.log(message));
      if(result.message){this.error(result.message);process.exitCode=result.exitCode;}
      else if(result.exitCode)process.exitCode=result.exitCode;
    }catch(e){this.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
  }
  success(message:string) {console.log(`✔ ${message}`);} error(message:string) {console.error(`✖ ${message}`);}log(message:string){console.log(message);}
  readonly color = color;
}
