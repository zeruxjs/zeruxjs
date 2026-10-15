import { parseArguments, type ParsedArgs } from './args.js';
import { validateOptions, type OptionSchema, type ValidatedOptions } from './options.js';
export type CommandHandler = (args:ParsedArgs,context:CommandContext)=>void|number|Promise<void|number>;
export interface CommandOptions { rea?:boolean; description?:string; help?:{arg:string;'its description':string}[]; docs?:string; example?:string; aliases?:string[]; usage?:string; hidden?:boolean; flags?:OptionSchema; allowUnknownFlags?:boolean }
export interface CommandContext { keyword:string; command:string; rawArgs:string[]; options?:ValidatedOptions }
export interface Command {keyword:string; name:string; options:CommandOptions; handler:CommandHandler }
export interface CommandResult { exitCode:number; command?:string; message?:string }
function valid(value:string,label:string) {if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value)||value.length>128)throw new TypeError(`Invalid ${label}: ${value}`);}
export class CommandRegistry {
  private commands=new Map<string,Map<string,Command>>();
  private aliases=new Map<string,Map<string,string>>();
  private descriptions=new Map<string,string>();
  registerKey(keyword:string,description='') {valid(keyword,'keyword');if(!this.commands.has(keyword)){this.commands.set(keyword,new Map());this.aliases.set(keyword,new Map());}if(description)this.descriptions.set(keyword,description);return this;}
  register(keyword:string,name:string,handler:CommandHandler,options:CommandOptions={}) {
    valid(keyword,'keyword');valid(name,'command');if(typeof handler!=='function')throw new TypeError('Command handler must be a function');this.registerKey(keyword);
    const commands=this.commands.get(keyword)!;const aliases=this.aliases.get(keyword)!;
    if(commands.has(name)||aliases.has(name))throw new Error(`Command already registered: ${keyword} ${name}`);
    for(const alias of options.aliases??[]){valid(alias,'alias');if(commands.has(alias)||aliases.has(alias)||(options.aliases??[]).filter(s=>s===alias).length>1)throw new Error(`Command alias conflicts: ${alias}`);}
    commands.set(name,{keyword,name,handler,options});for(const alias of options.aliases??[])aliases.set(alias,name);return this;
  }
  lookup(keyword:string,name:string) { const alias=this.aliases.get(keyword)?.get(name);return this.commands.get(keyword)?.get(alias??name); }
  list(keyword:string) {return [...(this.commands.get(keyword)?.values()??[])].filter(c=>!c.options.hidden);}
  keywords() { return [...this.commands.keys()]; }
  help(keyword:string,command?:string):string {
    const entry=command?this.lookup(keyword,command):undefined;
    if(command&&!entry)return `Unknown command: ${command}`;
    if(entry){const opts=entry.options;return [`${keyword} ${entry.name}${opts.usage?' '+opts.usage:''}`,opts.description??'',...(opts.help??[]).map(v=>`  ${v.arg.padEnd(18)} ${v['its description']}`),...Object.entries(opts.flags??{}).map(([name,flag])=>`  --${name.padEnd(16)} ${flag.description??flag.type}`),opts.example?`Example: ${opts.example}`:''].filter(Boolean).join('\n');}
    return [`${keyword}${this.descriptions.get(keyword)?` — ${this.descriptions.get(keyword)}`:''}`, 'Commands:',...this.list(keyword).map(c=>`  ${c.name.padEnd(20)} ${c.options.description??''}`),'Use --help after a command for details.'].join('\n');
  }
  docs(keyword:string,name:string) {const command=this.lookup(keyword,name);return command ? command.options.docs??this.help(keyword,name):`Unknown command: ${name}`;}
  complete(keyword:string,partial='') { return this.list(keyword).flatMap(c=>[c.name,...(c.options.aliases??[])]).filter(s=>s.startsWith(partial)).sort(); }
  async dispatch(keyword:string,args:readonly string[],output:(message:string)=>void=()=>{}):Promise<CommandResult>{
    if(!this.commands.has(keyword))return {exitCode:2,message:`Unknown CLI keyword: ${keyword}`};
    const [first,...rest]=args;
    if(!first||first==='-h'||first==='--help'||first==='-l'||first==='--list'){output(this.help(keyword));return {exitCode:0};}
    if(first==='--completion'){output(this.complete(keyword,rest[0]??'').join('\n'));return {exitCode:0};}
    const cmd=this.lookup(keyword,first);
    if(!cmd)return {exitCode:2,message:`Unknown command: ${first}`};
    if(rest.includes('--help')||rest.includes('-h')){output(this.help(keyword,cmd.name));return {exitCode:0,command:cmd.name};}
    if(rest.includes('--docs')||rest.includes('-d')){output(this.docs(keyword,cmd.name));return {exitCode:0,command:cmd.name};}
    try {const parsed=parseArguments(rest);const opts=cmd.options.flags?validateOptions(parsed,cmd.options.flags,cmd.options.allowUnknownFlags):undefined;const code=await cmd.handler(parsed,{keyword,command:cmd.name,rawArgs:rest,options:opts});return {exitCode:typeof code==='number'?code:0,command:cmd.name};}
    catch(e){return {exitCode:1,command:cmd.name,message:e instanceof Error?e.message:String(e)};}
  }
}
