import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import type { ReportExporter } from './export.js';
import { reportColumns, spreadsheetText, xml } from './export.js';
import { bounded, ReportExportError, type ResultReportV1 } from './schema.js';
export interface OptionalReportOptions {load?:()=>Promise<unknown>}
export interface FontReportOptions extends OptionalReportOptions {fontFile:string}
export class ReportDependencyError extends ReportExportError {constructor(readonly dependency:string,cause?:unknown){super('DEPENDENCY_UNAVAILABLE',cause);this.name='ReportDependencyError';this.message=`Optional report dependency unavailable: ${dependency}`;}}
async function dependency(name:string,load?:()=>Promise<unknown>):Promise<any>{try{return await(load?load():import(name));}catch(error){throw new ReportDependencyError(name,error);}}
function loader(options:OptionalReportOptions){if(!options||typeof options!=='object'||(options.load!==undefined&&typeof options.load!=='function'))throw new TypeError('Invalid optional report loader');return options.load;}
function fontPath(value:unknown):string {
  if(typeof value!=='string'||!value||value.length>4096||/[\x00-\x1f\x7f]/.test(value)||value.split(/[\\/]/).includes('..')||!/^\.(ttf|otf)$/i.test(path.extname(value)))throw new ReportExportError('INVALID_FONT');return value;
}
async function font(file:string):Promise<Buffer>{
  fontPath(file);
  const absolute=path.resolve(file);
  if(await fs.realpath(absolute)!==absolute)throw new ReportExportError('INVALID_FONT');
  const handle=await fs.open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>8388608)throw new ReportExportError('INVALID_FONT');
    const bytes=Buffer.alloc(stat.size+1);let size=0;
    while(size<bytes.length){const chunk=await handle.read(bytes,size,bytes.length-size,null);if(!chunk.bytesRead)break;size+=chunk.bytesRead;}
    if(size>stat.size)throw new ReportExportError('INVALID_FONT');return bytes.subarray(0,size);
  }finally{await handle.close();}
}
const lines=(report:ResultReportV1)=>[
  'Ztrial results schema v1',`${report.passed} passed / ${report.failed} failed / ${report.skipped} skipped / ${report.unavailable} unavailable`,`${report.durationMs} ms; ${report.results.length} test results`,
  ...report.results.flatMap((row,index)=>[
    `#${index+1} ${row.name.replace(/[\r\n\t]/g,' ').slice(0,78)}`,
    `${row.environment} | ${row.status} | ${row.durationMs} ms | ${row.coverageStatus} | ${row.reason??''}`,
    ...row.coverage.flatMap(source=>[`${source.source} | ${source.status}`,`${source.format} | ${source.runtime.slice(0,90)}`,`hash: ${source.sourceHash??'not instrumented'}`])
  ])
];
/** PDF text summary only. Explicit font required; no HTML, screenshots or attachments. */
export function createPdfExporter(options:FontReportOptions&{maxPages?:number}):ReportExporter {
  const load=loader(options),file=fontPath(options.fontFile),maxPages=bounded(options.maxPages,20,1,100,'maxPages');
  return {format:'pdf',extension:'summary.pdf',kind:'summary',async render(report,context){
    const rows=lines(report),perPage=45;if(Math.ceil(rows.length/perPage)>maxPages)throw new ReportExportError('PAGE_LIMIT');context.signal?.throwIfAborted();
    const module=await dependency('pdfkit',load);const Pdf=module.PDFDocument??module.default??module;if(typeof Pdf!=='function')throw new ReportDependencyError('pdfkit');
    const bytes=await font(file);context.signal?.throwIfAborted();
    return new Promise<Uint8Array>((resolve,reject)=>{
      const document=new Pdf({autoFirstPage:false,info:{Title:'Ztrial result summary',Creator:'ztrial'}});
      const chunks:Buffer[]=[];let size=0,settled=false;
      const finish=(error?:unknown)=>{if(settled)return;settled=true;context.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(Buffer.concat(chunks,size));};
      const abort=()=>{const error=context.signal?.reason??new ReportExportError('CANCELLED');document.destroy();finish(error);};
      document.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>context.maxOutputBytes){document.destroy();finish(new ReportExportError('OUTPUT_BYTE_LIMIT'));}else chunks.push(Buffer.from(chunk));});document.on('error',(error:unknown)=>finish(error));document.on('end',()=>finish());
      context.signal?.addEventListener('abort',abort,{once:true});if(context.signal?.aborted){abort();return;}
      try{document.font(bytes).fontSize(9);for(let index=0;index<rows.length;index++){if(index%perPage===0)document.addPage({size:'A4',margin:40});document.text(rows[index],40,45+(index%perPage)*16,{width:510,height:14,lineBreak:false});}document.end();}catch(error){document.destroy();finish(error);}
    });
  }};
}
/** XLSX stores strings, never formula objects; the workbook embeds no recording files. */
export function createXlsxExporter(options:OptionalReportOptions&{maxRows?:number;fontFamily:string}):ReportExporter {
  const load=loader(options),maxRows=bounded(options.maxRows,1000,1,10000,'maxRows'),family=options.fontFamily;
  if(typeof family!=='string'||!family||family.length>128||/[\x00-\x1f\x7f]/.test(family))throw new TypeError('Invalid spreadsheet font family');
  return {format:'xlsx',extension:'results.xlsx',kind:'summary',async render(report,context){
    if(report.results.length>maxRows)throw new ReportExportError('ROW_LIMIT');const module=await dependency('exceljs',load);const Workbook=module.Workbook??module.default?.Workbook;if(typeof Workbook!=='function')throw new ReportDependencyError('exceljs');
    context.signal?.throwIfAborted();const workbook=new Workbook();workbook.creator='ztrial';const sheet=workbook.addWorksheet('Results');
    for(const row of reportColumns(report)){context.signal?.throwIfAborted();if(row.some(cell=>cell.length>32767))throw new ReportExportError('SPREADSHEET_CELL_LIMIT');const cells=sheet.addRow(row.map(spreadsheetText));cells.font={name:family,size:11};}
    const meta=workbook.addWorksheet('Summary');for(const row of [['schema','ztrial-results'],['version',1],['passed',report.passed],['failed',report.failed],['skipped',report.skipped],['unavailable',report.unavailable],['durationMs',report.durationMs]])meta.addRow(row);
    const output=await workbook.xlsx.writeBuffer();context.signal?.throwIfAborted();return new Uint8Array(output);
  }};
}
/** PNG status chart, not a screenshot, video or browser recording. Explicit Pango font file. */
export function createPngExporter(options:FontReportOptions&{fontFamily:string;width?:number;height?:number;maxSources?:number}):ReportExporter {
  const load=loader(options),file=fontPath(options.fontFile),family=options.fontFamily,width=bounded(options.width,1000,128,4096,'width'),height=bounded(options.height,400,128,4096,'height'),maxSources=bounded(options.maxSources,8,1,32,'maxSources');
  if(typeof family!=='string'||!family||family.length>128||!/^[-\w .]+$/u.test(family))throw new TypeError('Invalid image font family');
  return {format:'png',extension:'summary.png',kind:'summary-chart',async render(report,context){
    const module=await dependency('sharp',load),sharp=module.default??module;if(typeof sharp!=='function')throw new ReportDependencyError('sharp');await font(file);context.signal?.throwIfAborted();
    const sources=[...new Map(report.results.flatMap(row=>row.coverage).map(source=>[JSON.stringify([source.source,source.runtime,source.sourceHash,source.status]),source])).values()];
    if(sources.length>maxSources)throw new ReportExportError('IMAGE_PROVENANCE_LIMIT');
    if(sources.some(source=>source.source.length>256||source.runtime.length>256))throw new ReportExportError('IMAGE_LABEL_LIMIT');
    const environments=report.results.reduce((counts,row)=>{counts[row.environment]++;return counts;},{node:0,browser:0});
    const maximum=Math.max(1,report.passed,report.failed,report.skipped,report.unavailable);
    const chart=['Ztrial summary chart / schema v1',`Duration: ${report.durationMs} ms | node: ${environments.node} / browser: ${environments.browser}`,...(['passed','failed','skipped','unavailable'] as const).map(status=>`${status.padEnd(12)} ${String(report[status]).padStart(5)} ${'#'.repeat(Math.round(report[status]/maximum*30))}`),'Coverage provenance (not line/branch percentages):',...sources.flatMap(source=>[`${source.source} | ${source.runtime} | ${source.status}`,`hash: ${source.sourceHash??'not instrumented'}`])].join('\n');
    const image=sharp({text:{text:xml(chart),font:`${family} 14`,fontfile:path.resolve(file),width:width-32,height:height-32,rgba:true}}).resize(width,height,{fit:'contain',background:{r:255,g:255,b:255,alpha:1}}).png();
    const abort=()=>image.destroy();context.signal?.addEventListener('abort',abort,{once:true});
    try{if(context.signal?.aborted)abort();const output=await image.toBuffer();context.signal?.throwIfAborted();return new Uint8Array(output);}finally{context.signal?.removeEventListener('abort',abort);image.destroy();}
  }};
}
