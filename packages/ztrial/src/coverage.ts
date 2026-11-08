import { createHash } from 'node:crypto';
export interface CoverageRange { functionIndex:number; rangeIndex:number; startOffset:number; endOffset:number; count:number; block:boolean }
export interface CoverageRecord { version:1; format:'v8-ranges'; runtime:string; source:string; status:'instrumented'|'uninstrumented'|'unsupported'; sourceHash?:string; ranges:readonly CoverageRange[]; reason?:string }
export interface V8SourceCoverage { url:string; source?:string; functions: readonly {isBlockCoverage:boolean;ranges:readonly {startOffset:number;endOffset:number;count:number}[]}[] }
// eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
const label=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\x00-\x1f\x7f]/.test(value);
function number(value:number){if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Invalid coverage counter/offset');}
/** Explicit expected sources are required: absent code is not falsely counted as covered. */
export function normalizeV8Coverage(entries:readonly V8SourceCoverage[],options:{runtime:string;expectedSources:readonly string[];unsupported?:boolean}):CoverageRecord[]{
  if(!options||!label(options.runtime)||!Array.isArray(options.expectedSources)||options.expectedSources.length>1000||options.expectedSources.some(source=>!label(source))||new Set(options.expectedSources).size!==options.expectedSources.length||!Array.isArray(entries)||entries.length>10000)throw new TypeError('Invalid coverage input');
  const reports=new Map<string,V8SourceCoverage>();for(const entry of entries){if(!entry||typeof entry.url!=='string')throw new TypeError('Invalid coverage source');if(options.expectedSources.includes(entry.url)){if(reports.has(entry.url))throw new TypeError('Duplicate coverage source; normalize separate captures before merging');reports.set(entry.url,entry);}}
  return options.expectedSources.map(source=>{
    const entry=reports.get(source);
    if(options.unsupported||!entry||typeof entry.source!=='string')return {version:1,format:'v8-ranges',runtime:options.runtime,source,status:options.unsupported?'unsupported':'uninstrumented',ranges:[],reason:options.unsupported?'runtime-unsupported':!entry?'not-observed':'source-unavailable'};
    if(entry.source.length>16777216||!Array.isArray(entry.functions)||entry.functions.length>100000)throw new RangeError('Coverage input limit');
    const ranges:CoverageRange[]=[];
    entry.functions.forEach((fn,functionIndex)=>{if(!fn||typeof fn.isBlockCoverage!=='boolean'||!Array.isArray(fn.ranges)||fn.ranges.length>100000)throw new TypeError('Invalid V8 function coverage');fn.ranges.forEach((range:V8SourceCoverage['functions'][number]['ranges'][number],rangeIndex:number)=>{number(range.startOffset);number(range.endOffset);number(range.count);if(range.endOffset<range.startOffset||range.endOffset>entry.source!.length||ranges.length>=100000)throw new TypeError('Invalid V8 coverage range');ranges.push({functionIndex,rangeIndex,startOffset:range.startOffset,endOffset:range.endOffset,count:range.count,block:fn.isBlockCoverage});});});
    return {version:1,format:'v8-ranges',runtime:options.runtime,source,status:'instrumented',sourceHash:createHash('sha256').update(entry.source).digest('hex'),ranges};
  });
}
function validate(record:CoverageRecord){
  if(!record||record.version!==1||record.format!=='v8-ranges'||!label(record.runtime)||!label(record.source)||!['instrumented','uninstrumented','unsupported'].includes(record.status)||!Array.isArray(record.ranges)||record.ranges.length>100000)throw new TypeError('Invalid normalized coverage');
  if(record.status==='instrumented'&&!/^[a-f0-9]{64}$/.test(record.sourceHash??''))throw new TypeError('Coverage requires source hash');
  if(record.status!=='instrumented'&&record.ranges.length)throw new TypeError('Uninstrumented coverage cannot contain counters');
  for(const range of record.ranges){for(const key of ['functionIndex','rangeIndex','startOffset','endOffset','count'] as const)number(range[key]);if(range.endOffset<range.startOffset||typeof range.block!=='boolean')throw new TypeError('Invalid normalized range');}
}
/** Merge only identical runtime/source/hash/range topology. No source-map or line conversion. */
export function mergeCoverage(records:readonly CoverageRecord[]):CoverageRecord[]{
  if(!Array.isArray(records)||records.length>10000)throw new TypeError('Invalid coverage records');const merged=new Map<string,CoverageRecord>();
  for(const record of records){validate(record);const previous=merged.get(record.source);if(!previous){merged.set(record.source,{...record,ranges:record.ranges.map((range:CoverageRange)=>({...range}))});continue;}
    const topology=(item:CoverageRecord)=>JSON.stringify(item.ranges.map(({count,...range})=>range));
    if(previous.runtime!==record.runtime||previous.status!==record.status||previous.reason!==record.reason||previous.sourceHash!==record.sourceHash||topology(previous)!==topology(record))throw new Error('Incompatible coverage sources; keep separate reports');
    previous.ranges=previous.ranges.map((range,index)=>{const count=range.count+record.ranges[index].count;number(count);return {...range,count};});
  }
  return [...merged.values()].sort((a,b)=>a.source.localeCompare(b.source));
}
/** Range counts only. Never invent statement/branch/line coverage or a whole-project percent. */
export function summarizeCoverage(records:readonly CoverageRecord[]){
  if(!Array.isArray(records)||records.length>10000)throw new TypeError('Invalid coverage records');
  let instrumented=0,uninstrumented=0,unsupported=0,totalRanges=0,coveredRanges=0;
  for(const record of records){validate(record);if(record.status==='uninstrumented')uninstrumented++;else if(record.status==='unsupported')unsupported++;else{instrumented++;totalRanges+=record.ranges.length;coveredRanges+=record.ranges.filter((range:CoverageRange)=>range.count>0).length;}}
  return {unit:'v8-ranges' as const,instrumentedSources:instrumented,uninstrumentedSources:uninstrumented,unsupportedSources:unsupported,totalRanges,coveredRanges};
}
