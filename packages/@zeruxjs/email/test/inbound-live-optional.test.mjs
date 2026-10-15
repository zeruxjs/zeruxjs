/** Opt-in real protocol smoke. Never enabled in ordinary CI and never logs credentials or mail. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailReceiver} from '../dist/index.js';

const enabled=process.env.ZERUX_TEST_LIVE_INBOUND==='1';
for(const protocol of ['imap','pop3']){
  const prefix=`ZERUX_TEST_${protocol.toUpperCase()}`;
  const host=process.env[`${prefix}_HOST`];
  const user=process.env[`${prefix}_USER`];
  const password=process.env[`${prefix}_PASSWORD`];
  test(`optional live ${protocol.toUpperCase()} TLS authentication (read-only)`,
    {skip:!enabled||!host||!user||!password?'live credentials/test opt-in not provided':false,timeout:45000},
    async()=>{
      const receiver=createEmailReceiver({accounts:[{name:'live',protocol,host,
        port:protocol==='imap'?993:995,auth:{user,password},timeoutMs:15000,maxMessagesPerPoll:2}],mode:'json'});
      try{
        assert.equal(await receiver.verify('live'),true);
        if(protocol==='imap'){
          const folders=await receiver.folders('live');
          assert.ok(Array.isArray(folders));
          assert.ok(folders.some(f=>f.path==='INBOX'));
        }
      }finally{await receiver.close();}
    }
  );
}
