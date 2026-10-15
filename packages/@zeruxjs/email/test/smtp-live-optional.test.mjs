import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailManager} from '../dist/index.js';

const enabled=process.env.ZERUX_TEST_LIVE_SMTP==='1';
const host=process.env.ZERUX_TEST_SMTP_HOST;
const user=process.env.ZERUX_TEST_SMTP_USER;
const pass=process.env.ZERUX_TEST_SMTP_PASSWORD;
const port=Number(process.env.ZERUX_TEST_SMTP_PORT??465);
const ready=enabled&&host&&user&&pass&&Number.isSafeInteger(port)&&port>0;

test('opt-in real SMTP TLS + password authentication verification (no email sent)',{skip:!ready},async()=>{
 const manager=createEmailManager({accounts:[{name:'live',smtp:{host,port,secure:port===465,requireTLS:port!==465,auth:{type:'password',user,pass}},defaults:{from:user}}]});
 try{assert.equal(await manager.verify('live'),true);}finally{await manager.close();}
});

const recipient=process.env.ZERUX_TEST_SMTP_RECIPIENT;
test('opt-in real SMTP acceptance, intentionally sends one harmless test message',{skip:!ready||!recipient||process.env.ZERUX_TEST_SMTP_SEND!=='1'},async()=>{
 const manager=createEmailManager({accounts:[{name:'live',smtp:{host,port,secure:port===465,requireTLS:port!==465,auth:{type:'password',user,pass}},defaults:{from:user}}]});
 try{
   const result=await manager.send({to:recipient,subject:'ZeruxJS opt-in SMTP integration test',text:'Intentional SMTP acceptance check from a test account.'});
   assert.equal(result.submissionStatus,'accepted');
   assert.equal(result.accepted.length,1);
 }finally{await manager.close();}
});
