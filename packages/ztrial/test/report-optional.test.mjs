import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createReportExporters,createPdfExporter,createXlsxExporter,createPngExporter} from 'ztrial/reports';
const modules=process.env.ZTRIAL_REPORT_TEST_MODULES;
const fontFile=process.env.ZTRIAL_REPORT_TEST_FONT;
const available=!!modules&&!!fontFile;
const input={passed:1,failed:0,skipped:0,durationMs:4,results:[{name:'=SUM(1,2) & <tag> "quotes"',status:'passed',durationMs:4,environment:'browser',coverage:[{version:1,format:'v8-ranges',runtime:'chromium:fixture',source:'https://test.invalid/app.js',status:'uninstrumented',ranges:[]}]}]};
function moduleLoader(name){return async()=>{const require=createRequire(join(modules,'package.json'));return import(pathToFileURL(require.resolve(name)).href);};}

test('real optional artifacts open in PDF, workbook/XML and PNG parsers',{skip:!available?'Set explicit optional test modules/font paths; no optional packages installed automatically':false},async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'ztrial-optional-report-'));
 try{
  const exporters=createReportExporters([createPdfExporter({fontFile,load:moduleLoader('pdfkit'),maxPages:2}),createXlsxExporter({fontFamily:'DejaVu Sans',load:moduleLoader('exceljs')}),createPngExporter({fontFile,fontFamily:'DejaVu Sans',load:moduleLoader('sharp'),width:800,height:320})]);
  for(const format of ['pdf','xlsx','png']){const result=await exporters.write(input,{directory:root,name:'optional',format});assert.ok(result.bytes>100);assert.equal(result.kind,format==='png'?'summary-chart':'summary');}
  const info=execFileSync('pdfinfo',[join(root,'optional.summary.pdf')],{encoding:'utf8'});assert.match(info,/Pages:\s+1/);
  const text=execFileSync('pdftotext',[join(root,'optional.summary.pdf'),'-'],{encoding:'utf8'});assert.match(text,/Ztrial results schema v1/);assert.match(text,/browser/);assert.match(text,/v8-ranges/);
  const excel=await moduleLoader('exceljs')();const Workbook=excel.Workbook??excel.default.Workbook;const workbook=new Workbook();await workbook.xlsx.readFile(join(root,'optional.results.xlsx'));const value=workbook.getWorksheet('Results').getCell('C2').value;assert.equal(value,"'"+input.results[0].name);assert.equal(typeof value,'string');
  const parsed=JSON.parse(execFileSync('python3',['-c',`import json,zipfile,xml.etree.ElementTree as ET,sys
from PIL import Image
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 for name in names:
  if name.endswith('.xml'): ET.fromstring(z.read(name))
with Image.open(sys.argv[2]) as image:
 image.load(); print(json.dumps({'format':image.format,'size':image.size,'zipEntries':len(names)}))`,join(root,'optional.results.xlsx'),join(root,'optional.summary.png')],{encoding:'utf8'}));assert.equal(parsed.format,'PNG');assert.deepEqual(parsed.size,[800,320]);assert.ok(parsed.zipEntries>5);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('optional page, row, pixel and font policies fail without partial output',{skip:!available},async()=>{
 const many={...input,results:Array.from({length:60},(_,index)=>({...input.results[0],name:'case '+index}))};
 const exporters=createReportExporters([createPdfExporter({fontFile,maxPages:1,load:moduleLoader('pdfkit')}),createXlsxExporter({fontFamily:'Test',maxRows:1,load:moduleLoader('exceljs')})]);
 await assert.rejects(exporters.render(many,'pdf'),error=>error.code==='PAGE_LIMIT');await assert.rejects(exporters.render(many,'xlsx'),error=>error.code==='ROW_LIMIT');assert.throws(()=>createPngExporter({fontFile,fontFamily:'Test',width:99999}),/width/);
 const root=await fs.mkdtemp(join(tmpdir(),'ztrial-font-policy-'));try{const link=join(root,'font.ttf');await fs.symlink(fontFile,link);const invalid=createReportExporters([createPdfExporter({fontFile:link,load:moduleLoader('pdfkit')})]);await assert.rejects(invalid.render(input,'pdf'),error=>error.code==='INVALID_FONT');}finally{await fs.rm(root,{recursive:true,force:true});}
});
