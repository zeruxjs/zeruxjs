#!/usr/bin/env node
/** Opt-in real-browser CSS assertion; exits nonzero if Chromium cannot start. */
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createZuix} from '../packages/zuix/dist/index.js';
const tmp=mkdtempSync(join(tmpdir(),'zuix-browser-'));
try{
 const css=createZuix({preflight:false}).generate(['p-4','text-blue-500','dark:bg-slate-900','motion-reduce:duration-0']).css;
 const html=`<!doctype html><html><head><style>${css}</style></head><body><main id="test" class="p-4 text-blue-500">Zuix browser fixture</main><output id="result"></output><script>
 const el=document.getElementById('test'),s=getComputedStyle(el);
 document.getElementById('result').textContent=JSON.stringify({padding:s.paddingTop,color:s.color,element:el.tagName.toLowerCase()});
 </script></body></html>`;
 const file=join(tmp,'index.html');writeFileSync(file,html);
 const r=spawnSync(process.env.ZUIX_CHROMIUM??'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
 if(r.error||r.status!==0)throw new Error(`Chromium not available/failed: ${r.error?.message??r.stderr.slice(-500)}`);
 if(!r.stdout.includes('&quot;padding&quot;:&quot;16px&quot;')||!r.stdout.includes('&quot;color&quot;:&quot;rgb(59, 130, 246)&quot;'))throw new Error('Unexpected computed CSS');
 console.log('Zuix real-browser CSS fixture PASS');
}finally{rmSync(tmp,{recursive:true,force:true});}
