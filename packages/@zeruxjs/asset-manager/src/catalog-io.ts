import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,rename,unlink,lstat,open} from 'node:fs/promises';
import {dirname} from 'node:path';
const MAX_CATALOG_BYTES=8*1024*1024;
async function regularOrMissing(file:string){try{if(!(await lstat(file)).isFile())throw new Error('Catalog path is not a regular file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
/** Shared private catalog I/O; callers validate their own versioned schema. Parent directories are trusted. */
export async function writeCatalogData(file:string,value:unknown):Promise<void>{
 const data=JSON.stringify(value);if(Buffer.byteLength(data)>MAX_CATALOG_BYTES)throw new RangeError('Asset catalog exceeds size limit');
 await mkdir(dirname(file),{recursive:true});await regularOrMissing(file);const temp=`${file}.${randomUUID()}.tmp`;
 try{const handle=await open(temp,'wx',0o600);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}await regularOrMissing(file);await rename(temp,file);}
 catch(error){await unlink(temp).catch(()=>{});throw error;}
}
export async function readCatalogData(file:string):Promise<unknown>{
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await handle.stat();if(!info.isFile()||info.size>MAX_CATALOG_BYTES)throw new Error('Invalid asset catalog file');return JSON.parse(await handle.readFile({encoding:'utf8'}));}
 finally{await handle.close();}
}
