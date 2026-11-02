import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {renderToHydratable} from 'zyrojs/server';
import {Form,validateProps} from './hydration-component.mjs';

test('browser hydration adopts parsed SSR, preserves edited forms/focus and disposes on abort', {skip:process.env.ZX_TEST_BROWSER!=='1'?'requires ZX_TEST_BROWSER=1, Playwright and Chromium':false}, async()=>{
  const {chromium}=await import('playwright');
  const output=renderToHydratable(Form,{label:'Name'},{idPrefix:'browser',validateProps});
  const server=createServer(async(req,res)=>{
    try {
      if(req.url==='/'){
        res.setHeader('content-type','text/html');res.end(`<script type="importmap">{"imports":{"zyrojs/component":"/dist/component.js","@zeruxjs/security/encoding":"/security.js"}}</script><div id="app">${output.html}</div><script type="application/json" id="data">${output.data}</script>`);return;
      }
      let url;
      if(req.url==='/security.js')url=new URL('../../@zeruxjs/security/dist/encoding.js',import.meta.url);
      else if(req.url==='/fixture.js')url=new URL('./hydration-component.mjs',import.meta.url);
      else if(/^\/dist\/(?:[a-z-]+\/)*[a-z-]+\.js$/.test(req.url??''))url=new URL(`..${req.url}`,import.meta.url);
      if(!url){res.writeHead(404).end();return;}
      res.setHeader('content-type','text/javascript');res.end(await readFile(url));
    }catch{res.writeHead(500).end();}
  });
  let browser;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async()=>{
      const {hydrate}=await import('/dist/hydrate.js'), fixture=await import('/fixture.js');
      const container=document.querySelector('#app'), inputs=container.querySelectorAll('input'), first=inputs[0], checkbox=inputs[1], buttons=[...container.querySelectorAll('button')];
      first.value='user edit';checkbox.checked=true;first.focus();first.setSelectionRange(1,4);
      const controller=new AbortController();const handle=hydrate(fixture.Form,container,{data:document.querySelector('#data').textContent,validateProps:fixture.validateProps,signal:controller.signal});
      const adopted=container.querySelector('input')===first&&fixture.state.value.peek()==='user edit'&&fixture.state.checked.peek();
      fixture.state.items.value=[3,1,4];const current=container.querySelectorAll('button');
      const identity=current[0]===buttons[2]&&current[1]===buttons[0];const focus=document.activeElement===first&&first.selectionStart===1&&first.selectionEnd===4;
      current[0].click();const removed=fixture.state.items.peek().join(',')==='1,4';controller.abort();buttons[0].click();
      return {adopted,identity,focus,removed,id:first.id,label:container.childNodes.length===0,status:handle.status,disposed:fixture.disposed,items:fixture.state.items.peek()};
    });
    assert.deepEqual(result,{adopted:true,identity:true,focus:true,removed:true,id:'browser-c1-1',label:true,status:'hydrated',disposed:1,items:[1,4]});
  }finally{try{await browser?.close();}finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}}
});
