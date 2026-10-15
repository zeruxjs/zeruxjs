/** Streaming, replay-safe, server-side campaign audience ingestion.
 * Never put CSV data or recipients into BullMQ; only durable message IDs are queued. */
import type {MarketingRecipient} from './marketing.js';
import {StringDecoder} from 'node:string_decoder';

export interface CampaignAppendPort {
  appendRecipients(code:string,recipients:readonly (string|MarketingRecipient)[],enqueueNow?:boolean):Promise<{added:number;existing:number;recipientCount:number}>;
  enqueue(code:string,page?:{cursor?:string|null;limit?:number}):Promise<{queued:number;nextCursor:string|null}>;
}
export interface CampaignImportOptions {
  batchSize?:number;maxRecipients?:number;enqueueAfter?:boolean;signal?:AbortSignal;
  onProgress?:(result:{processed:number;added:number;existing:number})=>void|Promise<void>;
}
/** Re-run the same import after a crash; existing matching recipients do not duplicate. */
export async function importMarketingRecipients(
  service:CampaignAppendPort,code:string,source:AsyncIterable<string|MarketingRecipient>|Iterable<string|MarketingRecipient>,
  options:CampaignImportOptions={}
){
  if(!service||typeof service.appendRecipients!=='function'||typeof service.enqueue!=='function'||!source||
    !(Symbol.asyncIterator in Object(source)||Symbol.iterator in Object(source)))throw new TypeError('Invalid campaign import');
  const size=options.batchSize??200,max=options.maxRecipients??100_000;
  if(!Number.isSafeInteger(size)||size<1||size>1000||!Number.isSafeInteger(max)||max<1||max>1_000_000||
    (options.enqueueAfter!==undefined&&typeof options.enqueueAfter!=='boolean'))throw new RangeError('Invalid campaign import bounds');
  let processed=0,added=0,existing=0,queued=0;
  const batch:(string|MarketingRecipient)[]=[];
  const check=()=>{if(options.signal?.aborted)throw options.signal.reason??new Error('Campaign import aborted');};
  const flush=async()=>{
    if(!batch.length)return;
    check();const result=await service.appendRecipients(code,batch,false);
    if(!Number.isSafeInteger(result.added)||!Number.isSafeInteger(result.existing)||result.added+result.existing!==batch.length)throw new Error('Invalid import checkpoint');
    processed+=batch.length;added+=result.added;existing+=result.existing;batch.length=0;
    await options.onProgress?.({processed,added,existing});
  };
  for await(const entry of source){
    check();if(processed+batch.length>=max)throw new RangeError('Import recipient limit exceeded');
    batch.push(entry);if(batch.length===size)await flush();
  }
  await flush();
  if(options.enqueueAfter){let cursor:string|null=null;do{
    check();const page=await service.enqueue(code,{cursor,limit:200});queued+=page.queued;cursor=page.nextCursor;
  }while(cursor!==null);}
  return {campaignCode:code,processed,added,existing,queued};
}

/** CSV columns: email, optional name, optional JSON data, or data.<property> fields.
 * RFC4180-style quoted cells and embedded newlines are supported, with strict bounds.
 * The result is an async generator so a large CSV need not fit into memory. */
export async function* parseMarketingRecipientCSV(
  source:string|AsyncIterable<string|Uint8Array>,
  options:{maxRows?:number;maxBytes?:number}={}
):AsyncGenerator<MarketingRecipient>{
  const maxRows=options.maxRows??100_000,maxBytes=options.maxBytes??50_000_000;
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1_000_000||
    !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>500_000_000)throw new RangeError('Invalid CSV limits');
  const decoder=new StringDecoder('utf8');
  const sourceChunks:AsyncIterable<string|Uint8Array>=typeof source==='string'?(async function*(){yield source;})():source;
  if(!sourceChunks||typeof sourceChunks[Symbol.asyncIterator]!=='function')throw new TypeError('CSV input must be text or an async stream');
  let headers:string[]|null=null,rows=0,bytes=0,field='',cells:string[]=[],quoted=false,afterQuote=false,started=false,firstChar=true,skipLF=false,recordLength=0;
  function finishField(){if(field.length>16_384)throw new RangeError('CSV field exceeds limit');cells.push(field);field='';if(cells.length>64)throw new RangeError('Too many CSV columns');afterQuote=false;}
  const parseRecord=():MarketingRecipient|null=>{
    finishField();const values=cells;cells=[];recordLength=0;
    if(values.length===1&&!values[0].trim())return null;
    if(!headers){
      headers=values.map(v=>v.trim().replace(/^\uFEFF/,''));
      if(headers[0]!=='email'||headers.some((v,i)=>headers!.indexOf(v)!==i)||
        headers.some(v=>v!=='email'&&v!=='name'&&v!=='data'&&!/^data\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v))||
        headers.some(v=>v.split('.').some(x=>['constructor','prototype','__proto__'].includes(x))))throw new TypeError('CSV headers must start with email and use safe names');
      return null;
    }
    if(values.length!==headers.length)throw new TypeError('CSV row does not match header');
    if(++rows>maxRows)throw new RangeError('CSV row limit exceeded');
    const record:MarketingRecipient={email:values[0].trim()},data:Record<string,unknown>={};
    for(let i=1;i<headers.length;i++){
      const key=headers[i],value=values[i];
      if(key==='name')record.name=value;
      else if(key==='data'&&value.trim()){
        let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw new TypeError('Invalid CSV JSON data');}
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new TypeError('CSV data must be a JSON object');
        for(const [name,v] of Object.entries(parsed)){
          if(['constructor','prototype','__proto__'].includes(name))throw new TypeError('Unsafe CSV JSON key');
          data[name]=v;
        }
      }else if(key.startsWith('data.'))data[key.slice(5)]=value;
    }
    if(Object.keys(data).length)record.data=data;
    return record;
  };
  // Generator yield is performed outside the record parser to keep state deterministic.
  const consume=(character:string):MarketingRecipient|null=>{
    if(firstChar){firstChar=false;if(character==='\uFEFF')return null;}
    if(skipLF){skipLF=false;if(character==='\n')return null;}
    if(++recordLength>64_000)throw new RangeError('CSV record exceeds limit');
    if(quoted){if(character==='"'){quoted=false;afterQuote=true;}else field+=character;return null;}
    if(afterQuote){
      if(character==='"'){field+='"';quoted=true;afterQuote=false;return null;}
      if(character!==','&&character!=='\n'&&character!=='\r')throw new TypeError('Malformed CSV quote');
    }else if(character==='"'){
      if(field.length)throw new TypeError('Unexpected CSV quote');quoted=true;started=true;return null;
    }
    if(character===','){finishField();started=true;return null;}
    if(character==='\n'||character==='\r'){
      if(character==='\r')skipLF=true;
      started=false;return parseRecord();
    }
    if(!afterQuote)field+=character;
    started=true;return null;
  };
  for await(const chunk of sourceChunks){
    bytes+=typeof chunk==='string'?Buffer.byteLength(chunk):chunk.byteLength;
    if(bytes>maxBytes)throw new RangeError('CSV input exceeds limit');
    const value=typeof chunk==='string'?chunk:decoder.write(Buffer.from(chunk));
    for(const char of value){const record=consume(char);if(record)yield record;}
  }
  for(const char of decoder.end()){const record=consume(char);if(record)yield record;}
  if(quoted)throw new TypeError('Unterminated CSV quoted field');
  if(started||cells.length||field.length){const record=parseRecord();if(record)yield record;}
  if(!headers)throw new TypeError('Missing CSV header');
}
