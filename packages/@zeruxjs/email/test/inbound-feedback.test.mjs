import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyIncomingDeliveryNotice,createTrustedInboundFeedbackProcessor} from '../dist/index.js';
const msg=text=>({id:'opaque-message-abc',account:'support',protocol:'imap',mailbox:'INBOX',remoteId:'10',uidValidity:'1',subject:'Undelivered Mail',
  from:['malicious@untrusted.test'],to:[],cc:[],receivedAt:100,text,attachments:[],bodyTruncated:false});
test('inbound bounce candidate is unverified and requires host trust proof before recording',async()=>{
 const received=msg('Final-Recipient: rfc822; test@example.test\nAction: failed\nStatus: 5.1.1');
 assert.equal(classifyIncomingDeliveryNotice(received)?.kind,'hard-bounce');
 assert.equal(classifyIncomingDeliveryNotice(received)?.verified,false);
 const saved=[];
 const reject=createTrustedInboundFeedbackProcessor({verify:()=>false,record:async notice=>saved.push(notice)});
 assert.deepEqual(await reject(received),{classified:true,recorded:false});assert.equal(saved.length,0);
 const trusted=createTrustedInboundFeedbackProcessor({verify:()=>true,record:async notice=>saved.push(notice)});
 assert.deepEqual(await trusted(received),{classified:true,recorded:true});
 assert.equal(saved[0].verified,true);assert.equal(saved[0].recipient,'test@example.test');
});
test('unstructured text is not treated as authenticated bounce or complaint',async()=>{
 assert.equal(classifyIncomingDeliveryNotice(msg('Hello, your parcel was delayed.')),null);
 assert.equal(classifyIncomingDeliveryNotice(msg('Final-Recipient: rfc822; a@b.test\nStatus: 5.1.1')),null);
 assert.equal(classifyIncomingDeliveryNotice(msg('Final-Recipient: rfc822; a@b.test\nAction: delayed\nStatus: 4.2.0'))?.kind,'soft-bounce');
});
