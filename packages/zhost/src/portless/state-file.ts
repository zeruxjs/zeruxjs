import * as fs from 'node:fs';
/** Inspect/read one opened inode. Parent ownership is enforced by the state owner. */
export function readStateFile(file: string, maximum: number): {bytes: Buffer; stat: fs.Stats} {
  let fd:number;
  try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='ELOOP')throw new Error('Unsafe state file',{cause:error});throw error;}
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>maximum)throw new Error('Unsafe or oversized state file');
    const buffer=Buffer.alloc(stat.size+1);let size=0;
    while(size<buffer.length){const count=fs.readSync(fd,buffer,size,buffer.length-size,null);if(!count)break;size+=count;}
    if(size>stat.size)throw new Error('State file changed during read');
    return {bytes:buffer.subarray(0,size),stat};
  } finally {fs.closeSync(fd);}
}
