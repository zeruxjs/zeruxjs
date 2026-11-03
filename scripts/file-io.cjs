const fs=require('node:fs');
/** Read one bounded regular descriptor. Callers own directory/path authorization. */
function readRegularFileSync(file,maximum=4*1024*1024){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>maximum)throw Error('Unsafe or oversized file');
  const bytes=Buffer.alloc(stat.size+1);let size=0;
  while(size<bytes.length){const count=fs.readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
  if(size>stat.size)throw Error('File changed during read');return bytes.subarray(0,size);
 }finally{fs.closeSync(fd);}
}
async function readRegularFile(file,maximum=64*1024*1024){
 const handle=await fs.promises.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maximum)throw Error('Unsafe or oversized file');
  const bytes=Buffer.alloc(stat.size+1);let size=0;
  while(size<bytes.length){const chunk=await handle.read(bytes,size,bytes.length-size,null);if(!chunk.bytesRead)break;size+=chunk.bytesRead;}
  if(size>stat.size)throw Error('File changed during read');return bytes.subarray(0,size);
 }finally{await handle.close();}
}
/** Reset only the requested log path and claim a new private file exclusively. */
function resetLogFileSync(file){
 try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 return fs.openSync(file,'wx',0o600);
}
module.exports={readRegularFileSync,readRegularFile,resetLogFileSync};
