import {open,lstat,readFile,rename,rm,mkdir} from 'node:fs/promises';
import {dirname,basename,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import type {EmailTemplate,RecipientRule} from './types.js';
import type {EmailTemplateRegistry} from './templates.js';
import type {RecipientFilter} from './filters.js';
/** Persistence is intentionally limited to non-secret templates and recipient rules. */
export interface SavedEmailState {version:1;templates:EmailTemplate[];rules:RecipientRule[];suppressions:string[]}
async function safePath(path:string){
  const full=resolve(path);if(basename(full)==='.'||basename(full)==='..')throw new TypeError('Invalid state path');
  await mkdir(dirname(full),{recursive:true,mode:0o700});
  const parent=await lstat(dirname(full));if(parent.isSymbolicLink())throw new Error('State parent cannot be a symlink');
  try{const current=await lstat(full);if(!current.isFile()||current.isSymbolicLink())throw new Error('Unsafe email state file');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  return full;
}
export async function saveEmailState(path:string,templates:EmailTemplateRegistry,filter:RecipientFilter):Promise<void>{
  const full=await safePath(path);
  const data:SavedEmailState={version:1,templates:templates.list(),rules:filter.listRules(),suppressions:filter.listSuppressions()};
  const json=JSON.stringify(data);if(Buffer.byteLength(json)>2*1024*1024)throw new RangeError('Email state too large');
  const temp=`${full}.${randomBytes(8).toString('hex')}.tmp`;let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(json);await handle.sync();await handle.close();handle=undefined;await safePath(path);await rename(temp,full);}finally{await handle?.close();await rm(temp,{force:true}).catch(()=>{});}
}
export async function loadEmailState(path:string,templates:EmailTemplateRegistry,filter:RecipientFilter):Promise<boolean>{
  const full=await safePath(path);let value:string;
  try{const stats=await lstat(full);if(stats.size>2*1024*1024)throw new RangeError('Email state too large');value=await readFile(full,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
  let decoded:SavedEmailState;
  try{decoded=JSON.parse(value);}catch{throw new TypeError('Corrupt email state JSON');}
  if(decoded?.version!==1||!Array.isArray(decoded.templates)||!Array.isArray(decoded.rules)||!Array.isArray(decoded.suppressions))throw new TypeError('Invalid email state');
  // Validate all values before changing live state.
  const {createTemplateRegistry}=await import('./templates.js');
  const {createRecipientFilter}=await import('./filters.js');
  const stagedTemplates=createTemplateRegistry(decoded.templates),stagedFilter=createRecipientFilter(decoded.rules,decoded.suppressions);
  for(const template of stagedTemplates.list())templates.set(template);
  filter.setRules(stagedFilter.listRules());
  for(const address of stagedFilter.listSuppressions())filter.suppress(address);
  return true;
}
