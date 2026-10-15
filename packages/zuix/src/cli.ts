#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildZuix,watchZuix} from './node.js';
import type {ZuixConfig} from './types.js';
async function main(){const args=process.argv.slice(2);if(args.includes('--help')||args.includes('-h')){console.log('zuix [build|watch] [-c zuix.config.mjs] [-o output.css] [--cwd directory]');return;}
 const option=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 const root=path.resolve(option('--cwd')??process.cwd());const configPath=option('-c')??option('--config');let config:ZuixConfig={};
 if(configPath){const mod=await import(pathToFileURL(path.resolve(root,configPath)).href);config=mod.default??mod.config??{};}
 if(args.includes('--per-file'))config.perFile=true;if(option('--per-file-dir'))config.perFile={dir:option('--per-file-dir')};
 if(option('-o'))config.output=option('-o');if(option('--output'))config.output=option('--output');
 const report=(result:{classes:string[],unmatched:string[]})=>console.log(`[zuix] compiled ${result.classes.length-result.unmatched.length} utilities -> ${config.output??'zuix.css'}`);
 if(args[0]==='watch'||args.includes('--watch')){watchZuix(root,config,report);console.log('[zuix] watching for changes');process.stdin.resume();}
 else report(buildZuix(root,config));
}
main().catch(error=>{console.error('[zuix]',error);process.exitCode=1;});
