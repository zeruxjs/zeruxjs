import fs from 'node:fs';
/** Bounded synchronous host-file reads; checks apply to the descriptor being read. */
export function readLocalFileSync(file:string,maximum:number,followLinks=false):Buffer {
 let fd:number;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK|(followLinks?0:fs.constants.O_NOFOLLOW),0o600);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ELOOP')throw new Error('Unsafe local file',{cause:error});throw error;}
 try{
  const stat=fs.fstatSync(fd);if(!stat.isFile())throw Object.assign(new Error('Unsafe local file type'),{code:'EFTYPE'});if(stat.size>maximum)throw new Error('Local file size exceeds limit');
  const bytes=Buffer.alloc(stat.size+1);let size=0;
  while(size<bytes.length){const count=fs.readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
  if(size>stat.size)throw new Error('Local file changed during read');return bytes.subarray(0,size);
 }finally{fs.closeSync(fd);}
}
