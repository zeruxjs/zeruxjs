import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
export interface PackageExportContract { readonly name:string; readonly exports:unknown }
/** Read only explicitly selected installed manifests, never import/execute package code.
 * Missing/oversized manifests fail configuration instead of guessing public source paths.
 */
export function readPackageExportContracts(cwd:string,packages:readonly string[]):readonly PackageExportContract[] {
 if(typeof cwd!=='string'||!Array.isArray(packages)||packages.length>64)throw new TypeError('lint: invalid package contract selection');
 const require=createRequire(path.join(path.resolve(cwd),'package.json'));
 return Object.freeze([...new Set(packages)].map(name=>{
  if(typeof name!=='string'||!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name))throw new TypeError('lint: invalid package name');
  for(const directory of require.resolve.paths(name)??[]){
   const file=path.join(directory,name,'package.json');
   let stat;try{stat=fs.statSync(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
   if(!stat.isFile()||stat.size>1024*1024)throw new Error('lint: invalid installed package manifest');
   const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
   if(manifest.name!==name)throw new Error('lint: installed package identity mismatch');
   return Object.freeze({name,exports:manifest.exports});
  }
  throw new Error(`lint: declared package contract is not installed: ${name}`);
 }));
}
/** Prove only absent/explicitly denied export keys; conditions and filesystem targets stay runtime-owned. */
export function deniedSubpath(specifier:string,contracts:readonly PackageExportContract[]):boolean {
 const contract=contracts.find(item=>specifier===item.name||specifier.startsWith(item.name+'/'));if(!contract||contract.exports===undefined)return false;
 const subpath=specifier===contract.name?'.':'./'+specifier.slice(contract.name.length+1),value=contract.exports;
 if(value===null)return true;
 if(typeof value==='string'||Array.isArray(value))return subpath!=='.';
 if(!value||typeof value!=='object')return false;
 const entries=Object.entries(value);
 if(!entries.some(([key])=>key.startsWith('.')))return subpath!=='.';
 if(Object.hasOwn(value,subpath))return (value as Record<string,unknown>)[subpath]===null;
 const patterns=entries.filter(([key])=>key.startsWith('./')&&key.split('*').length===2&&subpath.startsWith(key.split('*')[0])&&subpath.endsWith(key.split('*')[1]));
 patterns.sort(([a],[b])=>b.indexOf('*')-a.indexOf('*')||b.length-a.length);
 return !patterns.length||patterns[0]![1]===null;
}
