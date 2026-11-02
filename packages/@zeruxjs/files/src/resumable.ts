import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir, lstat, realpath, open, rename, unlink, rmdir, rm, opendir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import type {FileAddress, FileInfo, PutFileOptions} from './types.js';
import type {ResumableUploadOptions, ResumableUploads, UploadSession, UploadIdentity, UploadCleanupCandidate, UploadPart} from './multipart-types.js';
import {chunks, validateAddress, validatePut} from './validation.js';
interface Record extends UploadSession { version:1; binding:string; address:FileAddress; options:PutFileOptions; nativeId?:string; result?:FileInfo }
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const fail=(code:string)=>Object.assign(new Error(code.replaceAll('_',' ').toLowerCase()),{code});
const idPattern=/^[a-f0-9]{48}$/;
const digestPattern=/^[a-f0-9]{64}$/;
function integer(value:number,min:number,max:number){if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('UPLOAD_LIMIT');return value;}
function binding(identity:UploadIdentity){
  if(!identity||[identity.tenant,identity.subject].some(v=>typeof v!=='string'||!v||v.length>256||/[\x00-\x1f\x7f]/.test(v)))throw fail('UPLOAD_IDENTITY');
  return hash(JSON.stringify([identity.tenant,identity.subject]));
}
/** Private disk-backed resumptions. Root/configuration and authorization callbacks are trusted host inputs. */
export function createResumableUploads(options:ResumableUploadOptions):ResumableUploads {
  if(!options||typeof options.root!=='string'||!options.root||options.root.includes('\0')||typeof options.authorize!=='function'||typeof options.files?.validateWrite!=='function')throw new TypeError('Resumable root, authorization and policy-aware file manager required');
  const root=resolve(options.root), files=options.files, authorize=options.authorize;
  const maxBytes=integer(options.maxBytes??1024*1024*1024,1,Number.MAX_SAFE_INTEGER);
  const maxPartBytes=integer(options.maxPartBytes??8*1024*1024,1,64*1024*1024);
  const maxParts=integer(options.maxParts??1000,1,1000),maxSessions=integer(options.maxSessions??100,1,10000);
  const maxPending=integer(options.maxPending??8,1,64),ttlMs=integer(options.ttlMs??3600000,1,7*86400000);
  const now=options.now??Date.now;
  if(typeof now!=='function'||(options.approveCleanup!==undefined&&typeof options.approveCleanup!=='function'))throw new TypeError('Invalid upload callbacks');
  let closed=false;const pending=new Set<Promise<unknown>>();
  function clock(){return integer(now(),0,Number.MAX_SAFE_INTEGER-ttlMs);}
  async function secure(path:string,create=false){
    if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)throw fail('UPLOAD_UNSAFE_PATH');
  }
  async function lock<T>(path:string,fn:()=>Promise<T>){
    await secure(root,true);if(path!==root)await secure(path);
    const lease=join(path,'.lock');
    try{await mkdir(lease,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw fail('UPLOAD_BUSY');throw error;}
    try{return await fn();}finally{await rmdir(lease).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  function location(id:string){if(typeof id!=='string'||!idPattern.test(id))throw fail('UPLOAD_ID');return join(root,id);}
  async function atomic(path:string,value:unknown){
    const serialized=JSON.stringify(value);if(Buffer.byteLength(serialized)>1024*1024)throw fail('UPLOAD_LIMIT');
    const tmp=path+'.tmp-'+randomUUID();const handle=await open(tmp,'wx',0o600);
    try{await handle.writeFile(serialized);await handle.sync();await handle.close();await rename(tmp,path);}
    finally{await handle.close().catch(()=>{});await unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  async function load(id:string):Promise<Record>{
    const path=location(id);await secure(path);
    const handle=await open(join(path,'session.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const stat=await handle.stat();if(!stat.isFile()||stat.size>1024*1024)throw fail('UPLOAD_CORRUPT');
      const record=JSON.parse(await handle.readFile({encoding:'utf8'})) as Record;
      if(record.version!==1||record.id!==id||!digestPattern.test(record.binding)||!digestPattern.test(record.sha256)||!['initiating','open','finalizing','complete','aborted'].includes(record.status)||!Array.isArray(record.parts)||record.parts.length>maxParts)throw fail('UPLOAD_CORRUPT');
      integer(record.size,1,maxBytes);integer(record.expiresAt,0,Number.MAX_SAFE_INTEGER);validateAddress(record.address);validatePut({...record.options,expiresAt:undefined});
      const numbers=new Set<number>();for(const part of record.parts){integer(part.number,1,maxParts);integer(part.size,1,maxPartBytes);if(numbers.has(part.number)||!digestPattern.test(part.sha256)||(part.etag!==undefined&&(typeof part.etag!=='string'||part.etag.length>1024)))throw fail('UPLOAD_CORRUPT');numbers.add(part.number);}
      if(record.nativeId!==undefined&&(typeof record.nativeId!=='string'||!record.nativeId||record.nativeId.length>2048))throw fail('UPLOAD_CORRUPT');
      return record;
    }finally{await handle.close();}
  }
  const save=(record:Record)=>atomic(join(location(record.id),'session.json'),record);
  function view(record:Record):UploadSession{return {id:record.id,size:record.size,sha256:record.sha256,expiresAt:record.expiresAt,status:record.status,parts:record.parts.map(part=>({...part}))};}
  async function permission(identity:UploadIdentity,record:Record,action:Parameters<ResumableUploadOptions['authorize']>[2]){
    if(binding(identity)!==record.binding||await authorize({...identity},{...record.address},action)!==true)throw fail('UPLOAD_FORBIDDEN');
  }
  async function authorized<T>(identity:UploadIdentity,id:string,action:Parameters<ResumableUploadOptions['authorize']>[2],fn:(record:Record)=>Promise<T>){
    binding(identity);return lock(location(id),async()=>{const record=await load(id);await permission(identity,record,action);return fn(record);});
  }
  function live(record:Record){if(record.expiresAt<=clock())throw fail('UPLOAD_EXPIRED');if(record.status!=='open')throw fail('UPLOAD_STATE');}
  function run<T>(fn:()=>Promise<T>):Promise<T>{
    if(closed)return Promise.reject(fail('UPLOAD_CLOSED'));if(pending.size>=maxPending)return Promise.reject(fail('UPLOAD_BUSY'));
    const work=Promise.resolve().then(fn);pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
  }
  async function ids(){
    await secure(root,true);const entries:string[]=[];let count=0;
    const directory=await opendir(root);for await(const entry of directory){if(++count>maxSessions+1)throw fail('UPLOAD_SESSION_LIMIT');if(idPattern.test(entry.name)){if(!entry.isDirectory()||entry.isSymbolicLink())throw fail('UPLOAD_UNSAFE_PATH');entries.push(entry.name);}}
    return entries.sort();
  }
  async function* bytes(record:Record,signal?:AbortSignal){
    for(const part of [...record.parts].sort((a,b)=>a.number-b.number)){
      await secure(location(record.id));const handle=await open(join(location(record.id),part.number+'.part'),constants.O_RDONLY|constants.O_NOFOLLOW);
      try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==part.size)throw fail('UPLOAD_INTEGRITY');let offset=0;while(offset<part.size){if(signal?.aborted)throw fail('UPLOAD_CANCELLED');const buffer=Buffer.allocUnsafe(Math.min(65536,part.size-offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(!bytesRead)throw fail('UPLOAD_INTEGRITY');offset+=bytesRead;yield buffer.subarray(0,bytesRead);}}
      finally{await handle.close();}
    }
  }
  async function* verifiedBytes(record:Record,signal?:AbortSignal){
    const digest=createHash('sha256');let total=0;
    for await(const chunk of bytes(record,signal)){total+=chunk.byteLength;digest.update(chunk);yield chunk;}
    if(total!==record.size||digest.digest('hex')!==record.sha256)throw fail('UPLOAD_INTEGRITY');
  }
  async function removeParts(record:Record){
    // Include unacknowledged files left between part rename and journal commit.
    const path=location(record.id);await secure(path);const directory=await opendir(path);let count=0;
    for await(const entry of directory){
      if(++count>maxParts+8)throw fail('UPLOAD_LIMIT');
      if(/^(?:[0-9]{1,4}\.part(?:\.tmp-[a-f0-9-]{36})?|session\.json\.tmp-[a-f0-9-]{36})$/.test(entry.name))await unlink(join(path,entry.name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
  async function abortRecord(record:Record){
    if(record.status==='complete')throw fail('UPLOAD_STATE');if(record.status==='finalizing')throw fail('UPLOAD_UNCERTAIN');
    if(record.nativeId){const native=files.getDriver(record.address.storage).multipartOperations;if(!native)throw fail('UNSUPPORTED_CAPABILITY');await native.abort(record.address,record.nativeId);}
    record.status='aborted';await save(record);await removeParts(record);
  }
  return {
    initiate(identity,address,input){return run(async()=>{
      const bound=binding(identity);validateAddress(address);validatePut(input);integer(input.size,1,maxBytes);if(!digestPattern.test(input.sha256))throw fail('UPLOAD_INTEGRITY');
      if(input.signal!==undefined)throw new TypeError('Initiation does not persist request signals');
      const {size,sha256,...put}=input;
      if(Object.keys(put.metadata??{}).length>30||Object.keys(put.metadata??{}).some(key=>key.startsWith('zx-upload-')))throw fail('UPLOAD_METADATA');
      if(size>maxPartBytes*maxParts||(put.maxBytes!==undefined&&size>put.maxBytes))throw fail('UPLOAD_LIMIT');
      const write:PutFileOptions={...put,maxBytes:size,metadata:{...put.metadata,'zx-upload-sha256':sha256}};
      address=files.validateWrite!(address,write);if(await authorize({...identity},{...address},'initiate')!==true)throw fail('UPLOAD_FORBIDDEN');
      const driver=files.getDriver(address.storage);if(!driver.multipartOperations&&driver.kind!=='local-s3-lite')throw fail('UNSUPPORTED_CAPABILITY');
      if(driver.multipartOperations&&put.ifNoneMatch!==false&&!driver.multipartOperations.createOnly)throw fail('UNSUPPORTED_CAPABILITY');
      return lock(root,async()=>{
        if((await ids()).length>=maxSessions)throw fail('UPLOAD_SESSION_LIMIT');
        const id=randomBytes(24).toString('hex'),path=location(id);await mkdir(path,{mode:0o700});
        write.metadata!['zx-upload-id']=id;
        const record:Record={version:1,id,binding:bound,address:{...address},options:write,size,sha256,expiresAt:clock()+ttlMs,status:'initiating',parts:[]};
        await save(record);
        if(driver.multipartOperations){record.nativeId=await driver.multipartOperations.initiate(record.address,write);}
        record.status='open';await save(record);return view(record);
      });
    });},
    uploadPart(identity,id,number,source,input){return run(()=>authorized(identity,id,'part',async record=>{
      live(record);files.validateWrite!(record.address,record.options);integer(number,1,maxParts);integer(input.size,1,maxPartBytes);if(!digestPattern.test(input.sha256))throw fail('UPLOAD_INTEGRITY');
      const old=record.parts.find(p=>p.number===number);if(old){if(old.size!==input.size||old.sha256!==input.sha256)throw fail('UPLOAD_PART_CONFLICT');return {...old};}
      if(record.parts.reduce((total,p)=>total+p.size,0)+input.size>record.size)throw fail('UPLOAD_LIMIT');
      const data=Buffer.alloc(input.size);let size=0,count=0;const digest=createHash('sha256');
      for await(const chunk of chunks(source,input.signal)){const offset=size;size+=chunk.byteLength;if(size>input.size)throw fail('UPLOAD_LENGTH');if(++count>65536)throw fail('UPLOAD_LIMIT');digest.update(chunk);data.set(chunk,offset);}
      if(size!==input.size)throw fail('UPLOAD_LENGTH');if(digest.digest('hex')!==input.sha256)throw fail('UPLOAD_INTEGRITY');
      live(record);if(input.signal?.aborted)throw fail('UPLOAD_CANCELLED');
      const path=join(location(id),number+'.part'),tmp=path+'.tmp-'+randomUUID();
      const handle=await open(tmp,'wx',0o600);
      try{
        await handle.writeFile(data);await handle.sync();await handle.close();
        const part:UploadPart={number,size,sha256:input.sha256};
        if(record.nativeId){const native=files.getDriver(record.address.storage).multipartOperations;if(!native)throw fail('UNSUPPORTED_CAPABILITY');part.etag=await native.upload(record.address,record.nativeId,part,data,input.signal);}
        live(record);if(input.signal?.aborted)throw fail('UPLOAD_CANCELLED');
        await rename(tmp,path);record.parts.push(part);record.parts.sort((a,b)=>a.number-b.number);await save(record);return {...part};
      }finally{await handle.close().catch(()=>{});await unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }));},
    listParts(identity,id){return run(()=>authorized(identity,id,'list',async record=>view(record)));},
    finalize(identity,id,partNumbers,signal){return run(()=>authorized(identity,id,'finalize',async record=>{
      if(!Array.isArray(partNumbers)||!partNumbers.length||partNumbers.length>maxParts||partNumbers.length!==record.parts.length||partNumbers.some((number,i)=>number!==i+1||!record.parts.some(p=>p.number===number)))throw fail('UPLOAD_PART_ORDER');
      if(record.status==='complete'){if(!record.result)throw fail('UPLOAD_CORRUPT');return structuredClone(record.result);}
      files.validateWrite!(record.address,record.options);
      if(record.status==='finalizing'){
        const found=await files.stat(record.address);
        if(!found||found.size!==record.size||found.metadata['zx-upload-id']!==id||found.metadata['zx-upload-sha256']!==record.sha256)throw fail('UPLOAD_UNCERTAIN');
        record.result=found;record.status='complete';await save(record);await removeParts(record);return structuredClone(found);
      }
      live(record);if(signal?.aborted)throw fail('UPLOAD_CANCELLED');
      const digest=createHash('sha256');let total=0;
      for await(const chunk of bytes(record,signal)){total+=chunk.byteLength;digest.update(chunk);}
      if(total!==record.size||digest.digest('hex')!==record.sha256)throw fail('UPLOAD_INTEGRITY');
      const native=files.getDriver(record.address.storage).multipartOperations;
      if(record.nativeId){
        if(!native)throw fail('UNSUPPORTED_CAPABILITY');
        if(record.parts.slice(0,-1).some(p=>p.size<native.minPartBytes))throw fail('UPLOAD_PART_SIZE');
        const actual=await native.list(record.address,record.nativeId,maxParts);
        if(actual.length!==record.parts.length||record.parts.some(p=>!actual.some(a=>a.number===p.number&&a.size===p.size&&a.etag===p.etag&&a.sha256===p.sha256)))throw fail('UPLOAD_INTEGRITY');
      }
      live(record);if(signal?.aborted)throw fail('UPLOAD_CANCELLED');
      record.status='finalizing';await save(record);
      try{
        let result:FileInfo;
        if(record.nativeId){await native!.complete(record.address,record.nativeId,record.parts,record.options.ifNoneMatch!==false,signal);const found=await files.stat(record.address);if(!found||found.size!==record.size||found.metadata['zx-upload-id']!==id||found.metadata['zx-upload-sha256']!==record.sha256)throw fail('UPLOAD_UNCERTAIN');result=found;}
        else result=await files.put(record.address,verifiedBytes(record,signal),{...record.options,signal});
        record.result=result;record.status='complete';await save(record);await removeParts(record);files.invalidate(record.address);return structuredClone(result);
      }catch(error){
        // Only a definite create-only conflict is retryable. Unknown commit outcomes stay fenced.
        if(['FILE_EXISTS','EEXIST'].includes((error as {code?:string}).code??'')){record.status='open';await save(record);throw fail('FILE_EXISTS');}
        throw error;
      }
    }));},
    abort(identity,id){return run(()=>authorized(identity,id,'abort',abortRecord));},
    previewCleanup(input={}){return run(async()=>{
      const limit=integer(input.limit??50,1,100);if(input.cursor!==undefined&&!idPattern.test(input.cursor))throw fail('UPLOAD_ID');
      const all=(await ids()).filter(id=>!input.cursor||id>input.cursor);const page=all.slice(0,limit);const items:UploadCleanupCandidate[]=[];
      for(const id of page){const record=await load(id);if(record.expiresAt<=clock()&&record.status!=='finalizing')items.push({id,expiresAt:record.expiresAt,status:record.status,revision:hash(JSON.stringify(record))});}
      return {items,...(all.length>limit?{nextCursor:page.at(-1)}:{})};
    });},
    cleanup(candidates){return run(async()=>{
      if(!Array.isArray(candidates)||candidates.length>100)throw fail('UPLOAD_LIMIT');
      const snapshot=candidates.map(c=>{location(c.id);if(!digestPattern.test(c.revision))throw fail('UPLOAD_CORRUPT');return Object.freeze({...c});});
      if(!options.approveCleanup||await options.approveCleanup(Object.freeze(snapshot))!==true)throw fail('UPLOAD_FORBIDDEN');
      let count=0;for(const candidate of snapshot){await lock(location(candidate.id),async()=>{
        const record=await load(candidate.id);if(record.expiresAt>clock()||record.status==='finalizing'||hash(JSON.stringify(record))!==candidate.revision)return;
        if(record.status!=='complete')await abortRecord(record);
        await secure(location(record.id));await rm(location(record.id),{recursive:true});count++;
      });}return count;
    });},
    async close(){closed=true;await Promise.allSettled([...pending]);}
  };
}
