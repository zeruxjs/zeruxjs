import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {
  createEmailReceiver,createMemoryInboxStore,createInboxApi,createDatabaseMailboxSync
} from '../dist/index.js';

const account={name:'support',protocol:'imap',host:'imap.example.test',auth:{user:'alice@example.test',password:'secret'},
  mailbox:'INBOX',mailboxes:['Archive','Invoices'],maxMessagesPerPoll:50};
const parse=async buffer=>({subject:buffer.toString(),text:'safe',from:{value:[{address:'sender@example.test'}]}});
function multiDriver(data,validity=10n){
  const requests=[];let opened='';
  return {requests,connections:{
    async imap(){return {
      mailbox:{exists:0,uidValidity:validity,uidNext:20n},async connect(){requests.push('connect');},
      async getMailboxLock(folder,{readOnly}){
        requests.push(`${folder}:${readOnly?'read':'write'}`);opened=folder;
        this.mailbox={exists:(data[folder]??[]).length,uidValidity:validity,uidNext:20n};
        return {release(){requests.push('unlock');}};
      },
      async search(query){requests.push(query);return (data[opened]??[]).map(item=>item.uid);},
      async fetchOne(uid){const item=(data[opened]??[]).find(item=>item.uid===uid);return item?{size:item.source.length,source:item.source}:false;},
      async messageFlagsAdd(uid,flags){requests.push(`flag:${opened}:${uid}:${flags[0]}`);},
      async logout(){requests.push('logout');}
    };},async pop3(){throw new Error('Unexpected POP3 connection');}
  }};
}
test('one account can poll separate allowlisted IMAP mailboxes without UID collision',async()=>{
  const store=createMemoryInboxStore();
  const driver=multiDriver({INBOX:[{uid:1,source:Buffer.from('inbox')}],Archive:[{uid:1,source:Buffer.from('archive')}]});
  const receiver=createEmailReceiver({accounts:[account],store,connections:driver.connections,parse});
  const first=await receiver.poll('support',{mailbox:'INBOX',cursor:{afterUid:0,mailbox:'INBOX'}});
  const second=await receiver.poll('support',{mailbox:'Archive',cursor:{afterUid:0,mailbox:'Archive'}});
  assert.equal(first.stored,1);assert.equal(second.stored,1);
  assert.equal(first.nextCursor.mailbox,'INBOX');assert.equal(second.nextCursor.mailbox,'Archive');
  assert.notEqual(first.newIds[0],second.newIds[0]);
  const items=(await store.page('support')).items;
  assert.deepEqual(items.map(m=>m.mailbox).sort(),['Archive','INBOX']);
  await assert.rejects(receiver.poll('support',{mailbox:'Drafts'}),/not configured/);
  await assert.rejects(receiver.poll('support',{mailbox:'Archive',cursor:first.nextCursor}),/cross-mailbox/);
  assert.equal((await receiver.poll('support',{mailbox:'Archive',cursor:second.nextCursor})).stored,0);
  assert.ok(driver.requests.includes('Archive:read'));
  assert.equal(driver.requests.filter(x=>x==='Archive:write').length,0);
});
test('pollConfiguredMailboxes only scans explicitly configured folders and no POP3 folder name is accepted',async()=>{
  const driver=multiDriver({INBOX:[],Archive:[],Invoices:[]});
  const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:driver.connections,parse});
  const results=await receiver.pollConfiguredMailboxes();
  assert.equal(results.length,3);
  assert.deepEqual(results.map(r=>r.nextCursor.mailbox),['INBOX','Archive','Invoices']);
  const pop=createEmailReceiver({accounts:[{name:'pop',protocol:'pop3',host:'pop.example.test',auth:{user:'test',password:'test'}}],
    connections:{...driver.connections,async pop3(){return {async UIDL(){return []},async QUIT(){}}}}});
  await assert.rejects(pop.poll('pop',{mailbox:'Archive'}),/no named mailboxes/);
  assert.throws(()=>createEmailReceiver({accounts:[{...account,mailboxes:['Archive','Archive']}]}),/allowlist/);
  assert.throws(()=>createEmailReceiver({accounts:[{...account,mailboxes:['Bad\rMailbox']}]}),/allowlist/);
});
test('inbox API authorizes selected mailbox before invoking manual polling',async()=>{
  const driver=multiDriver({INBOX:[],Archive:[]});
  const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:driver.connections,parse});
  const attempts=[];
  const inbox=createInboxApi({store:createMemoryInboxStore(),receiver,
    authorize:async ctx=>{attempts.push(ctx);return ctx.account==='support'&&ctx.mailbox!=='Archive';}});
  await assert.rejects(inbox.poll('support','Archive'),/access denied/);
  assert.equal(driver.requests.length,0);
  assert.equal((await inbox.poll('support','INBOX')).account,'support');
  assert.ok(attempts.some(a=>a.operation==='poll'&&a.mailbox==='Archive'));
  await assert.rejects(inbox.poll('support','Bad\nfolder'),/Invalid inbox mailbox/);
});
test('IMAP UID cursor and remote mutations reject invalid, cross-folder and out-of-range values',async()=>{
  const driver=multiDriver({INBOX:[{uid:1,source:Buffer.from('ok')}]});
  const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:driver.connections,parse});
  for(const afterUid of [-1,2**32,2.3])await assert.rejects(receiver.poll('support',{cursor:{afterUid}}),/cursor/);
  const terminal=await receiver.poll('support',{cursor:{afterUid:0xffffffff,mailbox:'INBOX'}});
  assert.equal(terminal.nextCursor.afterUid,0xffffffff);
  assert.ok(!driver.requests.some(r=>typeof r==='object'));
  const msg=(await receiver.poll('support')).messages[0];
  await assert.rejects(receiver.markSeen('support',{...msg,remoteId:String(2**32)}),/identity|not found/);
  await assert.rejects(receiver.markSeen('support',{...msg,mailbox:'Unlisted'}),/identity|not found/);
  assert.equal(await receiver.markSeen('support',msg),true);
  assert.ok(driver.requests.includes('flag:INBOX:1:\\Seen'));
});
test('bad POP3 UIDL duplicates are rejected before RETR, without deleting remote mail',async()=>{
  const actions=[];
  const receiver=createEmailReceiver({accounts:[{name:'pop',protocol:'pop3',host:'pop.example.test',auth:{user:'a',password:'b'}}],
    connections:{async imap(){throw Error('unexpected');},async pop3(){return {
      async UIDL(){return [['1','same'],['2','same']];},async RETR(){actions.push('RETR');return 'mail';},
      async QUIT(){actions.push('QUIT');},async DELE(){actions.push('DELE');}
    };}},parse});
  await assert.rejects(receiver.poll('pop'),/duplicate POP3 UIDL/);
  assert.deepEqual(actions,['QUIT']);
});
test('malformed MIME and oversized custom-parser attachments are rejected or omitted before callback',async()=>{
  const driver=multiDriver({INBOX:[{uid:5,source:Buffer.from('safe')}]});
  for(const bad of [{size:-1},{content:'not-bytes'},{size:1.3}]){
    const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:driver.connections,
      parse:async()=>({attachments:[{filename:'bad.txt',...bad}]})});
    await assert.rejects(receiver.poll('support'),/Invalid MIME attachment/);
  }
  let uploads=0,scans=0;
  const receiver=createEmailReceiver({accounts:[{...account,maxMessageBytes:1024}],mode:'json',connections:driver.connections,
    parse:async()=>({attachments:[{filename:'too-big.dat',size:4096,content:Buffer.from('data')}] }),
    attachmentContent:'base64',saveAttachment:async()=>{uploads++;return 'private:ref';},
    inspectAttachment:async()=>{scans++;return 'clean';}});
  const item=(await receiver.poll('support')).messages[0].attachments[0];
  assert.equal(item.size,4096);assert.equal(item.contentOmitted,true);
  assert.equal(item.contentBase64,undefined);assert.equal(item.storedReference,undefined);
  assert.equal(uploads,0);assert.equal(scans,0);
});
test('JSON delivery callback failures do not advance incremental IMAP cursor',async()=>{
  const driver=multiDriver({INBOX:[{uid:7,source:Buffer.from('replay')}]});
  let fail=true,attempts=0;
  const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:driver.connections,parse,
    onMessage:async()=>{attempts++;if(fail)throw Error('downstream unavailable');}});
  await assert.rejects(receiver.poll('support',{cursor:{afterUid:0}}),/downstream unavailable/);
  fail=false;
  const result=await receiver.poll('support',{cursor:{afterUid:0}});
  assert.equal(result.stored,1);assert.equal(result.nextCursor.afterUid,19);assert.equal(attempts,2);
});
test('separate SQLite checkpoints fence and isolate worker progress per IMAP folder',async()=>{
  const require=createRequire(import.meta.url);
  const {createConnector}=require('../../db-sqllite/dist/index.js');
  const temp=await mkdtemp(join(tmpdir(),'zerux-section67-'));
  const path=join(temp,'mail.db');
  const firstConnection=await createConnector({filename:path,driver:'node'});
  const secondConnection=await createConnector({filename:path,driver:'node'});
  const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
  const from=c=>Object.fromEntries(['createTable','insert','select','update'].map(op=>[op,arg=>c.execute({op,...arg},ctx)]));
  const received=[];
  const receiver={poll:async (name,{mailbox,cursor})=>{
    received.push({name,mailbox,cursor});
    return {stored:1,nextCursor:{uidValidity:'12',mailbox,afterUid:cursor.afterUid+1}};
  }};
  try{
    const inbox=createDatabaseMailboxSync({db:from(firstConnection),id:'main-sync',account:'support',mailbox:'INBOX',receiver});
    const archive=createDatabaseMailboxSync({db:from(secondConnection),id:'main-sync',account:'support',mailbox:'Archive',receiver});
    assert.equal((await inbox.runOnce('worker-a')).state.cursor.afterUid,1);
    assert.equal((await archive.runOnce('worker-b')).state.cursor.afterUid,1);
    assert.equal((await inbox.runOnce('worker-a')).state.cursor.afterUid,2);
    assert.equal((await archive.get()).cursor.afterUid,1);
    assert.deepEqual(received.map(r=>r.mailbox),['INBOX','Archive','INBOX']);
    assert.equal((await archive.resetCursor()).cursor.afterUid,0);
    assert.equal((await inbox.get()).cursor.afterUid,2);
  }finally{await firstConnection.disconnect();await secondConnection.disconnect();await rm(temp,{recursive:true,force:true});}
});
test('legacy unscoped checkpoint adopts the initial folder but refuses later implicit folder changes',async()=>{
  const require=createRequire(import.meta.url);
  const {createConnector}=require('../../db-sqllite/dist/index.js');
  const temp=await mkdtemp(join(tmpdir(),'zerux-section67-legacy-'));
  const connector=await createConnector({filename:join(temp,'mail.db'),driver:'node'});
  const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
  const db=Object.fromEntries(['createTable','insert','select','update'].map(op=>[op,input=>connector.execute({op,...input},ctx)]));
  let currentFolder='Archive';
  const receiver={poll:async(_name,{cursor})=>{
    if(cursor.mailbox&&cursor.mailbox!==currentFolder)throw new Error('cross-mailbox cursor refused');
    return {stored:1,nextCursor:{mailbox:currentFolder,uidValidity:'12',afterUid:cursor.afterUid+1}};
  }};
  try{
    const legacy=createDatabaseMailboxSync({db,id:'legacy',account:'support',receiver});
    assert.equal((await legacy.runOnce('worker')).state.mailbox,'Archive');
    assert.equal((await legacy.runOnce('worker')).state.cursor.afterUid,2);
    currentFolder='INBOX';
    await assert.rejects(legacy.runOnce('worker'),/cross-mailbox cursor refused/);
    assert.equal((await legacy.get()).status,'failed');
    await legacy.resetCursor();
    assert.equal((await legacy.runOnce('worker')).state.mailbox,'INBOX');
  }finally{await connector.disconnect();await rm(temp,{recursive:true,force:true});}
});
