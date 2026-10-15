#!/usr/bin/env node
import {readdirSync, statSync, readFileSync} from 'node:fs';
import {resolve, relative, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defineConfig} from '../config/index.js';
import {runTests,clearTests} from '../index.js';
import {formatSummary} from '../utils/logger.js';
import {globRegex,normalizedRelativePath} from '../utils/path.js';
import type {ZeyroConfig} from '../types/config.js';
function walk(root:string, current=root):string[]{const output:string[]=[];for(const item of readdirSync(current,{withFileTypes:true})){if(item.name==='node_modules'||item.name==='dist'||item.name==='.git')continue;const p=join(current,item.name);if(item.isDirectory())output.push(...walk(root,p));else if(item.isFile())output.push(p);}return output;}
let importGeneration = 0;
export async function main(argv:string[]=process.argv.slice(2)):Promise<number>{
  try {
    let config:ZeyroConfig = defineConfig();let selected:string|undefined;
    for(let i=0;i<argv.length;i++) {const arg=argv[i];if(arg==='--config'){const file=resolve(argv[++i]??'');if(!file.endsWith('.json'))throw new Error('Only JSON config files are accepted');config=defineConfig(JSON.parse(readFileSync(file,'utf8')));}else if(arg==='--reporter')config.reporter=argv[++i] as ZeyroConfig['reporter'];else if(arg==='--timeout')config.timeoutMs=Number(argv[++i]);else if(arg==='--match')selected=argv[++i];else if(arg==='--help'){process.stdout.write('zeyro [--config file.json] [--reporter pretty|json|tap] [--timeout ms] [--match name]\n');return 0;}else throw new Error(`Unknown argument ${arg}`); }
    config=defineConfig(config);const root=resolve(config.root??'.'); const matches=(config.files??[]).map(globRegex);
    const entries=walk(root).filter(p=>matches.some(glob=>glob.test(normalizedRelativePath(relative(root,p))))).sort();
    clearTests();for(const file of entries)await import(`${pathToFileURL(file).href}?zeyro_run=${++importGeneration}`);
    const result=await runTests({timeoutMs:config.timeoutMs,retries:config.retries,match:selected,bail:config.bail,forbidOnly:config.allowOnly===false});
    process.stdout.write(formatSummary(result,config.reporter)+'\n');return result.failed?1:0;
  }catch(e) {process.stderr.write(`zeyro: ${e instanceof Error?e.message:String(e)}\n`);return 2;}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode=await main();
