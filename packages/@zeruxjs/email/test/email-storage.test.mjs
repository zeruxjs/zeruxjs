import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createEmailManager,saveEmailState,loadEmailState,createTemplateRegistry,createRecipientFilter,resolveAttachments} from '../dist/index.js';
test('private atomic saved templates and filters; no SMTP credentials saved',async()=>{
  const root=await mkdtemp(join(tmpdir(),'email-state-')),path=join(root,'email-state.json');
  const a=createTemplateRegistry([{id:'welcome',subject:'Hello',html:'<b>{{name}}</b>'}]);const b=createRecipientFilter([{action:'block',pattern:'*@blocked.com'}],['oops@example.com']);
  await saveEmailState(path,a,b);
  const data=await readFile(path,'utf8');assert.equal(JSON.parse(data).version,1);
  const reg=createTemplateRegistry(),filters=createRecipientFilter();assert.equal(await loadEmailState(path,reg,filters),true);
  assert.equal(reg.render('welcome',{name:'Alice'}).subject,'Hello');assert.equal(filters.evaluate('x@blocked.com').rejected.length,1);
  assert.equal(filters.evaluate('oops@example.com').rejected.length,1);
  const unsafe=join(root,'symlink.json');await symlink(path,unsafe);await assert.rejects(saveEmailState(unsafe,a,b),/Unsafe/);
});
test('file-manager attachments resolve lazily as Node streams with size limits',async()=>{
  const manager={async stat(){return {size:3,contentType:'text/plain'};},async read(){return (async function*(){yield Buffer.from('abc');})();}};
  const [attachment]=await resolveAttachments([{filename:'test.txt',file:{storage:'local',bucket:'reports',key:'a.txt'}}],{files:manager,maxAttachmentBytes:10});
  let text='';for await(const chunk of attachment.content)text+=chunk.toString();assert.equal(text,'abc');
  await assert.rejects(resolveAttachments([{filename:'test',file:{bucket:'a',key:'b'}}],{files:manager,maxAttachmentBytes:2}),/limit/);
  await assert.rejects(resolveAttachments([{filename:'secret.txt',path:'/etc/passwd'}],{}),/disabled/);
});
