import { createHash } from 'node:crypto';
import { normalizeResults, type NormalizedResultRecord } from '../results.js';
import { summarizeCoverage } from '../coverage.js';
import type { RunSummary } from '../types/test.js';
export interface ReportLimits {maxResults?:number;maxInputBytes?:number;maxOutputBytes?:number;maxAttachments?:number;maxAttachmentBytes?:number}
export interface ReportOptions extends ReportLimits {
  /** Error messages can contain private test inputs; omitted unless explicitly enabled. */
  includeErrors?:boolean;
  includeSourceLabels?:boolean;
  includeArtifactPaths?:boolean;
  /** Application-owned redaction of public labels and explicitly included error text. */
  redact?:(text:string,field:string)=>string;
}
export interface ResultReportV1 {
  schema:'ztrial-results';version:1;
  passed:number;failed:number;skipped:number;unavailable:number;durationMs:number;
  results:readonly NormalizedResultRecord[];
}
export class ReportExportError extends Error {
  constructor(readonly code:string,cause?:unknown){super(`Result report export failed (${code})`,{cause});this.name='ReportExportError';}
}
export function bounded(value:number|undefined,fallback:number,min:number,max:number,label:string):number {
  const number=value??fallback;if(!Number.isSafeInteger(number)||number<min||number>max)throw new RangeError(`Invalid ${label}`);return number;
}
export function reportLimits(options:ReportLimits={}){
  return {maxResults:bounded(options.maxResults,1000,1,10000,'maxResults'),maxInputBytes:bounded(options.maxInputBytes,4194304,1,16777216,'maxInputBytes'),maxOutputBytes:bounded(options.maxOutputBytes,8388608,1,33554432,'maxOutputBytes'),maxAttachments:bounded(options.maxAttachments,64,0,1000,'maxAttachments'),maxAttachmentBytes:bounded(options.maxAttachmentBytes,65536,0,1048576,'maxAttachmentBytes')};
}
/** XML 1.0-compatible text; presentation encoders escape markup separately. */
export function plain(value:string):string {return [...value].filter(char=>{const code=char.codePointAt(0)!;return code===9||code===10||code===13||(code>=32&&code<=0xd7ff)||(code>=0xe000&&code<=0xfffd)||(code>=0x10000&&code<=0x10ffff);}).join('');}
function relative(value:string){return value.length<=2048&&!/[\x00-\x1f\x7f\\]/.test(value)&&!value.startsWith('/')&&!/^[A-Za-z]:/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');}
const id=(prefix:string,value:string)=>prefix+'-'+createHash('sha256').update(value).digest('hex').slice(0,24);
/** One versioned, bounded document for every encoder; never mutate runner results. */
export function createResultReport(summary:RunSummary,options:ReportOptions={}):ResultReportV1 {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Invalid report options');
  const limits=reportLimits(options);
  for(const key of ['includeErrors','includeSourceLabels','includeArtifactPaths'] as const)if(options[key]!==undefined&&typeof options[key]!=='boolean')throw new TypeError('Invalid report disclosure option');
  if(options.redact!==undefined&&typeof options.redact!=='function')throw new TypeError('Invalid report redactor');
  if(!summary||!Array.isArray(summary.results)||summary.results.length>limits.maxResults||!Number.isFinite(summary.durationMs)||summary.durationMs<0)throw new ReportExportError('INPUT_LIMIT_OR_SCHEMA');
  let workBytes=0;const charge=(bytes:number)=>{workBytes+=bytes;if(workBytes>limits.maxInputBytes)throw new ReportExportError('INPUT_BYTE_LIMIT');};
  let inputBytes=0,attachments=0,attachmentBytes=0;
  const text=(value:unknown,field:string,max=8192):string=>{
    if(typeof value!=='string'||value.length>max)throw new ReportExportError('INVALID_TEXT');
    const sanitized=options.redact?options.redact(value,field):value;
    if(typeof sanitized!=='string'||sanitized.length>max)throw new ReportExportError('INVALID_REDACTION');
    const output=plain(sanitized);charge(Buffer.byteLength(output));return output;
  };
  const rows:NormalizedResultRecord[]=[];
  for(const item of summary.results){
    if(!item||!['passed','failed','skipped','environment-unavailable'].includes(item.status)||!Number.isFinite(item.durationMs)||item.durationMs<0||(item.environment!==undefined&&!['node','browser'].includes(item.environment)))throw new ReportExportError('INVALID_RESULT');
    if(item.coverage!==undefined&&(!Array.isArray(item.coverage)||item.coverage.length>1000))throw new ReportExportError('COVERAGE_LIMIT');
    if(item.artifacts!==undefined&&(!Array.isArray(item.artifacts)||item.artifacts.length>limits.maxAttachments))throw new ReportExportError('ATTACHMENT_LIMIT');
    // Reuse the public normalizer, then construct only declared fields from its output.
    const normalized=normalizeResults({...summary,results:[item]})[0];
    const coverage=normalized.coverage.map(record=>{
      summarizeCoverage([record]);
      if(record.sourceHash!==undefined&&(typeof record.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(record.sourceHash)))throw new ReportExportError('INVALID_COVERAGE_HASH');
      const source=text(record.source,'coverage.source',2048);
      return {version:1 as const,format:'v8-ranges' as const,runtime:text(record.runtime,'coverage.runtime',2048),source:options.includeSourceLabels?source:id('source',source),status:record.status,...(record.sourceHash&&{sourceHash:record.sourceHash}),...(record.reason&&{reason:text(record.reason,'coverage.reason',2048)}),ranges:record.ranges.map(range=>{const value={functionIndex:range.functionIndex,rangeIndex:range.rangeIndex,startOffset:range.startOffset,endOffset:range.endOffset,count:range.count,block:range.block};charge(Buffer.byteLength(JSON.stringify(value)));return value;})};
    });
    const artifacts=normalized.artifacts.map(artifact=>{
      if(!artifact||!['screenshot','video','trace'].includes(artifact.type)||typeof artifact.path!=='string'||!relative(artifact.path))throw new ReportExportError('UNSAFE_ATTACHMENT_REFERENCE');
      const label=text(artifact.path,'artifact.path',2048);if(!relative(label))throw new ReportExportError('UNSAFE_ATTACHMENT_REFERENCE');
      attachments++;attachmentBytes+=Buffer.byteLength(label);if(attachments>limits.maxAttachments||attachmentBytes>limits.maxAttachmentBytes)throw new ReportExportError('ATTACHMENT_LIMIT');
      return {type:artifact.type,path:options.includeArtifactPaths?label:id('artifact',label)};
    });
    const row:NormalizedResultRecord={version:1,name:text(item.name,'name',2048),environment:normalized.environment,status:item.status,durationMs:item.durationMs,...(normalized.reason&&{reason:text(normalized.reason,'reason',2048)}),coverageStatus:normalized.coverageStatus,coverage,artifacts};
    if(options.includeErrors&&normalized.error)row.error={name:text(normalized.error.name,'error.name',256),message:text(normalized.error.message,'error.message')};
    inputBytes+=Buffer.byteLength(JSON.stringify(row));if(inputBytes>limits.maxInputBytes)throw new ReportExportError('INPUT_BYTE_LIMIT');
    rows.push(row);
  }
  const count=(status:string)=>rows.filter(row=>row.status===status).length;
  const report:ResultReportV1={schema:'ztrial-results',version:1,passed:count('passed'),failed:count('failed'),skipped:count('skipped'),unavailable:count('environment-unavailable'),durationMs:summary.durationMs,results:rows};
  if(Buffer.byteLength(JSON.stringify(report))>limits.maxInputBytes)throw new ReportExportError('INPUT_BYTE_LIMIT');
  return report;
}
