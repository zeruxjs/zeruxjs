#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildZuix,watchZuix} from './node.js';
import type {ZuixConfig} from './types.js';
export async function runCli(args:string[]=process.argv.slice(2)):Promise<void> {
 if(args.includes('--help')||args.includes('-h')){console.log('zuix [build|watch] [-c zuix.config.mjs] [-o output.css] [--cwd directory] [--per-file] [--per-file-dir directory]');return;}
 const command=args[0]&&!args[0].startsWith('-')?args[0]:'build';
 if(command!=='build'&&command!=='watch')throw new Error(`unknown command: ${command}`);
 const opts=new Map<string,string>();const flags=new Set<string>();
 const valid=new Set(['-c','--config','-o','--output','--cwd','--per-file-dir']);
 for(let i=args[0]===command?1:0;i<args.length;i++){
  const arg=args[i];if(arg==='--watch'||arg==='--per-file'){flags.add(arg);continue;}
  if(!valid.has(arg))throw new Error(`unknown argument: ${arg}`);
  if(opts.has(arg)||i+1>=args.length||args[i+1].startsWith('--')||args[i+1]==='-o'||args[i+1]==='-c')throw new Error(`missing or repeated value: ${arg}`);
  opts.set(arg,args[++i]);
 }
 const root=path.resolve(opts.get('--cwd')??process.cwd());const configPath=opts.get('-c')??opts.get('--config');let config:ZuixConfig={};
 if(configPath){const mod=await import(pathToFileURL(path.resolve(root,configPath)).href);config=mod.default??mod.config??{};}
 if(flags.has('--per-file'))config.perFile=true;
 if(opts.has('--per-file-dir'))config.perFile={dir:opts.get('--per-file-dir')};
 if(opts.has('-o')||opts.has('--output'))config.output=opts.get('--output')??opts.get('-o');
 const report=(result:{classes:string[],unmatched:string[]})=>console.log(`[zuix] compiled ${result.classes.length-result.unmatched.length} utilities -> ${config.output??'zuix.css'}`);
 if(command==='watch'||flags.has('--watch')){
  const stop=watchZuix(root,config,report,error=>console.error('[zuix] watch:',error));
  const shutdown=()=>{stop();process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  console.log('[zuix] watching for changes');
 }else report(buildZuix(root,config));
}
// Importable CLI entry for validation without executing from a package consumer.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 runCli().catch(error=>{console.error('[zuix]',error);process.exitCode=1;});
}
