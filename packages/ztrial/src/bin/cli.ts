#!/usr/bin/env node
import {readdirSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {resolve, relative, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defineConfig} from '../config/index.js';
import {runTests,clearTests} from '../index.js';
import {formatSummary} from '../utils/logger.js';
import {globRegex,normalizedRelativePath} from '../utils/path.js';
import type {ZtrialConfig} from '../types/config.js';
function walk(root:string, current=root):string[]{const output:string[]=[];for(const item of readdirSync(current,{withFileTypes:true})){if(['node_modules','dist','.git'].includes(item.name))continue;const p=join(current,item.name);if(item.isSymbolicLink())continue; if(item.isDirectory())output.push(...walk(root,p));else if(item.isFile())output.push(p);}return output;}
function readConfigJson(file:string):unknown {
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try{
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>256*1024)throw new Error('Config file exceeds 256 KiB or is not a regular file');
    const bytes=Buffer.alloc(stat.size+1);let size=0;
    while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
    if(size>stat.size)throw new Error('Config file changed during read');return JSON.parse(bytes.subarray(0,size).toString('utf8'));
  }finally{closeSync(fd);}
}
let importGeneration = 0;
export async function main(argv:string[]=process.argv.slice(2)):Promise<number>{
  try {
    let config:ZtrialConfig = defineConfig();let selected:string|undefined;let configDirectory=process.cwd();
    for(let i=0;i<argv.length;i++) {const arg=argv[i];if(arg==='--config'){const value=argv[++i];if(!value || value.startsWith('--'))throw new Error('--config requires a JSON file');const file=resolve(value);if(!file.endsWith('.json'))throw new Error('Only JSON config files are accepted');config=defineConfig(readConfigJson(file) as Parameters<typeof defineConfig>[0]);configDirectory=resolve(file,'..');}else if(arg==='--reporter'){const value=argv[++i];if(!value || value.startsWith('--'))throw new Error('--reporter requires a value');config.reporter=value as ZtrialConfig['reporter'];}else if(arg==='--timeout'){const value=argv[++i];if(!value || !/^[0-9]+$/.test(value))throw new Error('--timeout requires a positive integer');config.timeoutMs=Number(value);}else if(arg==='--match'){const value=argv[++i];if(!value || value.startsWith('--'))throw new Error('--match requires a name');selected=value;}else if(arg==='--help'){process.stdout.write('ztrial [--config file.json] [--reporter pretty|json|tap] [--timeout ms] [--match name]\n');return 0;}else throw new Error(`Unknown argument ${arg}`); }
    config=defineConfig(config);const root=resolve(configDirectory,config.root??'.'); const matches=(config.files??[]).map(globRegex);
    const entries=walk(root).filter(p=>matches.some(glob=>glob.test(normalizedRelativePath(relative(root,p))))).sort();
    if(!entries.length)throw new Error('No test files matched the configured patterns');
    clearTests();for(const file of entries)await import(`${pathToFileURL(file).href}?ztrial_run=${++importGeneration}`);
    const result=await runTests({timeoutMs:config.timeoutMs,retries:config.retries,match:selected??config.match,bail:config.bail,forbidOnly:config.allowOnly===false});
    if (!result.results.length) throw new Error('No registered test cases found');
    if ((selected ?? config.match) !== undefined && result.passed === 0 && result.failed === 0 && !result.unavailable) throw new Error('No tests matched the selected name');
    process.stdout.write(formatSummary(result,config.reporter)+'\n');return result.failed?1:result.unavailable?2:0;
  }catch(e) {process.stderr.write(`ztrial: ${e instanceof Error?e.message:String(e)}\n`);return 2;}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode=await main();
