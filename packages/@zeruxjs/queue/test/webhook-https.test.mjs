import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createWebhookHttpsTransport,isWebhookAddressAllowed,webhookURL} from '@zeruxjs/queue/webhooks';
function fixture(){const requests=[];let status=204,chunk='',hold=false;const request=(url,options,callback)=>{
 const req=new EventEmitter();req.closed=false;req.destroy=()=>{if(req.closed)return;req.closed=true;options.signal.removeEventListener('abort',abort);queueMicrotask(()=>req.emit('close'));};const abort=()=>{req.emit('error',Error('private abort'));req.destroy();};options.signal.addEventListener('abort',abort,{once:true});req.end=body=>{requests.push({url,options,body,req});queueMicrotask(()=>{if(req.closed)return;options.lookup(url.hostname,{family:4},(error,address)=>{if(req.closed)return;if(error){req.emit('error',error);req.destroy();return;}const socket=new EventEmitter();req.emit('socket',socket);socket.emit('secureConnect');if(hold)return;const response=new EventEmitter();response.statusCode=status;response.headers={};response.destroy=()=>req.destroy();callback(response);queueMicrotask(()=>{if(chunk)response.emit('data',Buffer.from(chunk));response.emit('end');req.destroy();});});});return req;};return req;};
 return {request,requests,set status(v){status=v;},set chunk(v){chunk=v;},set hold(v){hold=v;}};
}
const input=()=>({url:'https://hooks.example/events',body:'{}',headers:{},signal:new AbortController().signal,timeoutMs:20});
const policy={allowedOrigins:['https://hooks.example'],approveAddress:()=>true};
test('public origin/address rules deny private/encoded/mapped endpoints before delivery',()=>{
 for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.0.1','192.168.1.1','224.0.0.1','::1','::ffff:8.8.8.8','2001:db8::1'])assert.equal(isWebhookAddressAllowed(address),false,address);
 assert.equal(isWebhookAddressAllowed('8.8.8.8'),true);
 for(const url of ['http://hooks.example/events','https://user:secret@hooks.example/events','https://hooks.example/events?token=secret','https://other.example/events','https://2130706433/','https://[::1]/'])assert.throws(()=>webhookURL(url,policy.allowedOrigins),e=>e.code==='DESTINATION_DENIED');
});
test('lookup is revalidated at connection time, mixed private answers/egress denial fail closed and no redirects are followed',async()=>{
 const f=fixture();let lookups=0,addresses=['8.8.8.8'];const transport=createWebhookHttpsTransport({...policy,request:f.request,resolve:async()=>{lookups++;return addresses;}});
 try{assert.equal((await transport.send(input())).status,204);assert.equal(f.requests[0].options.agent,false);assert.equal(f.requests[0].options.rejectUnauthorized,true);addresses=['8.8.8.8','127.0.0.1'];await assert.rejects(transport.send(input()),e=>e.code==='ADDRESS_DENIED');addresses=['8.8.8.8'];f.status=302;assert.equal((await transport.send(input())).status,302);assert.equal(f.requests.length,3);assert.equal(lookups,3);assert.ok(f.requests.every(item=>item.req.closed));}finally{await transport.close();}assert.equal(transport.status().pending,0);
 const denied=createWebhookHttpsTransport({...policy,approveAddress:()=>false,request:f.request,resolve:async()=>['8.8.8.8']});await assert.rejects(denied.send(input()),e=>e.code==='ADDRESS_DENIED');await denied.close();
});
test('response byte ceiling and post-connect timeout are uncertain; DNS outage is not-sent',async()=>{
 const f=fixture();f.chunk='PRIVATE response';const transport=createWebhookHttpsTransport({...policy,request:f.request,resolve:async()=>['8.8.8.8'],maxResponseBytes:2});await assert.rejects(transport.send(input()),e=>e.code==='OUTCOME_UNKNOWN'&&!e.message.includes('PRIVATE'));f.chunk='';f.hold=true;await assert.rejects(transport.send(input()),e=>e.code==='OUTCOME_UNKNOWN');await transport.close();assert.equal(transport.status().pending,0);
 const dns=createWebhookHttpsTransport({...policy,request:f.request,resolve:async()=>{throw Error('private resolver detail');}});await assert.rejects(dns.send(input()),e=>e.code==='NOT_SENT'&&!e.message.includes('private'));await dns.close();
});
test('cancelled DNS remains bounded/owned until actual lookup settlement and late callbacks cannot connect',async()=>{
 const f=fixture();let finish;const transport=createWebhookHttpsTransport({...policy,request:f.request,resolve:()=>new Promise(resolve=>finish=resolve),maxPending:1});const controller=new AbortController();const sending=transport.send({...input(),signal:controller.signal});while(!finish)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(transport.send(input()),e=>e.code==='TRANSPORT_OVERLOAD');assert.equal(transport.status().pending,1);finish(['8.8.8.8']);await assert.rejects(sending,e=>e.code==='NOT_SENT');await transport.close();assert.ok(f.requests.every(item=>item.req.closed));assert.equal(transport.status().pending,0);
});
