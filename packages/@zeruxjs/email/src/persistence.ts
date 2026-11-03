import {open,lstat,rename,rm,mkdir} from 'node:fs/promises';
import {dirname,basename,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import type {EmailTemplate,RecipientRule} from './types.js';
import type {EmailTemplateRegistry} from './templates.js';
import type {RecipientFilter} from './filters.js';
/** Persistence is intentionally limited to non-secret templates and recipient rules. */
export interface SavedEmailState {version:1;templates:EmailTemplate[];rules:RecipientRule[];suppressions:string[]}
async function safePath(path:string,checkExisting=true){
  const full=resolve(path);if(basename(full)==='.'||basename(full)==='..')throw new TypeError('Invalid state path');
  await mkdir(dirname(full),{recursive:true,mode:0o700});
  const parent=await lstat(dirname(full));if(parent.isSymbolicLink())throw new Error('State parent cannot be a symlink');
  if(!checkExisting)return full;
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
  const full=await safePath(path,false);let value:string;
  try{const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);try{
    const stats=await handle.stat();if(!stats.isFile()||stats.size>2*1024*1024)throw new RangeError('Email state too large');
    const bytes=Buffer.alloc(stats.size+1);let size=0;while(size<bytes.length){const chunk=await handle.read(bytes,size,bytes.length-size,null);if(!chunk.bytesRead)break;size+=chunk.bytesRead;}
    if(size>stats.size)throw new Error('Email state changed during read');value=bytes.subarray(0,size).toString('utf8');
  }finally{await handle.close();}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
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
