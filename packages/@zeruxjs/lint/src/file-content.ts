import fs from 'node:fs/promises';
import {constants} from 'node:fs';
export class LintSourceLimitError extends RangeError {constructor(){super('Lint source exceeds size limit');}}
/** Keep the size/type check and read attached to one descriptor. */
async function content(handle:Awaited<ReturnType<typeof fs.open>>,maximum:number):Promise<string>{
 const stat=await handle.stat();if(!stat.isFile())throw new Error('Unsafe lint source');if(stat.size>maximum)throw new LintSourceLimitError();
 const bytes=Buffer.alloc(stat.size+1);let size=0;
 while(size<bytes.length){const next=await handle.read(bytes,size,bytes.length-size,null);if(!next.bytesRead)break;size+=next.bytesRead;}
 if(size>stat.size)throw new Error('Lint source changed during read');return bytes.subarray(0,size).toString('utf8');
}
export async function readLintSource(file:string,maximum=5*1024*1024):Promise<string>{
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
 try{return await content(handle,maximum);}finally{await handle.close();}
}
/** Fix only the same open inode and refuse concurrent edits. No fix is automatic. */
export async function writeLintSource(file:string,expected:string,next:string):Promise<void>{
 if(Buffer.byteLength(next)>5*1024*1024)throw new Error('Formatted source exceeds 5 MiB');
 const handle=await fs.open(file,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
 try{
  if(await content(handle,5*1024*1024)!==expected)throw new Error('Lint source changed before fix');
  const bytes=Buffer.from(next);let written=0;
  while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,written);if(!result.bytesWritten)throw new Error('Incomplete lint fix write');written+=result.bytesWritten;}
  await handle.truncate(bytes.length);
 }finally{await handle.close();}
}
