import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const root=resolve(import.meta.dirname,'../..');
const mime={'.js':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8'};
/** Reusable isolated static test runner for sections 78, 81 and 82. No external network. */
export async function withBrowserFixture(filename,run){
 const fixture=resolve(root,'tests/browser/fixtures',filename);
 const server=createServer(async(req,res)=>{
  try{
   if(req.method!=='GET'){res.writeHead(405).end();return}
   const pathname=new URL(req.url??'/', 'http://127.0.0.1').pathname;
   const destination=pathname==='/'?fixture:resolve(root,'.'+pathname);
   const actual=await realpath(destination);
   if(!actual.startsWith(root+sep)|| !(/\.(html|js|css)$/).test(actual)) {res.writeHead(403).end();return}
   const body=await readFile(actual);res.writeHead(200,{'content-type':mime[extname(actual)],'cache-control':'no-store',
     'content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'"}).end(body);
  }catch{res.writeHead(404).end()}
 });
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});
 try{return await run(`http://127.0.0.1:${server.address().port}/`)}
 finally{await new Promise(resolve=>server.close(resolve))}
}
export async function runChromium(url,{binary=process.env.CHROMIUM_BIN??'chromium',timeout=20000,flags=[]}={}){
 const {stdout,stderr}=await exec(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  '--no-first-run','--no-default-browser-check','--virtual-time-budget=2000',...flags,'--dump-dom',url],{timeout,maxBuffer:1024*1024*3});
 const match=stdout.match(/<output id="browser-result"[^>]*>([\s\S]*?)<\/output>/);
 if(!match)throw new Error('Browser did not produce a result: '+stdout.slice(-700)+' '+stderr.slice(-300));
 const result=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
 return result;
}
