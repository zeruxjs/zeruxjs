import {test} from 'node:test';import assert from 'node:assert/strict';import {createEmailQueue,createRecipientFilter} from '../dist/index.js';
test('bounded queue, retry transient transport errors and flush',async()=>{
  let tries=0;const queue=createEmailQueue({async send(){tries++;if(tries<3)throw Object.assign(new Error('network'),{code:'ECONNRESET'});return {account:'a',accepted:[],rejected:[]};}},{concurrency:1,maxPending:2,retries:2,backoffMs:0});
  const result=await queue.enqueue({to:'a@b.com',subject:'x',text:'x'});assert.equal(result.account,'a');assert.equal(tries,3);await queue.flush();assert.equal(queue.stats().pending,0);await queue.close();await assert.rejects(queue.enqueue({to:'a@b.com',subject:'x',text:'x'}),/closed/);
});
test('queue never retries permanent authorization failures',async()=>{
  let tries=0;const queue=createEmailQueue({async send(){tries++;throw Object.assign(new Error('blocked'),{code:'EMAIL_FILTERED'});}},{retries:5,backoffMs:0});
  await assert.rejects(queue.enqueue({to:'a@b.com',subject:'x',text:'x'}),/blocked/);assert.equal(tries,1);
});
test('filter supports whole-domain patterns and account scoped rules',()=>{
  const f=createRecipientFilter([{action:'block',pattern:'*@example.com',account:'marketing'}]);
  assert.equal(f.evaluate('a@example.com','marketing').rejected.length,1);
  assert.equal(f.evaluate('a@example.com','billing').rejected.length,0);
  f.suppress('A@OTHER.COM');assert.equal(f.evaluate('a@other.com').rejected.length,1);
});
