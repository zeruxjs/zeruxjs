const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes,createHash}=require('node:crypto');const jose=require('jose');const auth=require('../dist/index.js');
const owner={tenant:'tenant-a',session:'host-session'},redirectUri='https://app.example/callback';
async function fixture(override={}){
 let time=Date.now(),authorized=false,nonce,challenge,claims={},failure=false,rotation=1;
 const pair=await jose.generateKeyPair('ES256',{extractable:true}),pub=await jose.exportJWK(pair.publicKey),store=auth.createMemoryProviderLoginStore(),calls=[],records=[];
 const wrapped={...store,async put(record,now){records.push(record);return store.put(record,now);}};
 const config={id:'example',profile:'custom',protocol:'oidc',label:'Example',issuer:'https://idp.example',authorizationEndpoint:'https://idp.example/auth',tokenEndpoint:'https://idp.example/token',userInfoEndpoint:'https://idp.example/user',jwksUrl:'https://idp.example/keys',allowedUrls:['https://idp.example/auth','https://idp.example/token','https://idp.example/user','https://idp.example/keys'],redirectUris:[redirectUri],scopes:['openid','profile','email'],clientId:'client',tokenAuthentication:'none',algorithms:['ES256'],mapProfile:v=>({subject:v.sub,name:v.name,email:v.email,emailVerified:v.email_verified===true}),...override.provider};
 const transport=async(url,init)=>{
  calls.push(url);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  if(url===config.tokenEndpoint){if(failure)throw Error('PRIVATE_TOKEN_FAILURE');const p=new URLSearchParams(init.body);assert.equal(p.get('grant_type'),'authorization_code');assert.equal(p.get('redirect_uri'),redirectUri);assert.equal(createHash('sha256').update(p.get('code_verifier')).digest('base64url'),challenge);const sec=Math.floor(time/1000);const id_token=await new jose.SignJWT({iss:config.issuer,aud:config.clientId,sub:'subject-1',iat:sec,exp:sec+60,nonce,email:'verified@example.test',email_verified:true,...claims}).setProtectedHeader({alg:'ES256',kid:`key-${rotation}`}).sign(pair.privateKey);return Response.json({access_token:'PRIVATE_ACCESS_TOKEN',token_type:'Bearer',id_token});}
  if(url===config.jwksUrl)return Response.json({keys:[{...pub,alg:'ES256',kid:`key-${rotation}`}]});
  if(url===config.userInfoEndpoint)return Response.json({id:42,sub:'subject-1',name:'Profile',email:'unverified@example.test',...override.userInfo});
  throw Error('Unexpected outbound destination');
 };
 const options={providers:[config],store:wrapped,bindingKey:randomBytes(32),transport,authorizeFresh:async()=>authorized,now:()=>time,jwksCooldownMs:1,jwksCacheMs:20,...override.options};
 const first=auth.createProviderLogin(options),second=auth.createProviderLogin(options);
 async function begin(manager=first,account){const result=await manager.begin(config.id,owner,redirectUri,account),url=new URL(result.url);nonce=url.searchParams.get('nonce');challenge=url.searchParams.get('code_challenge');assert.equal(url.searchParams.get('code_challenge_method'),'S256');return new URLSearchParams({state:url.searchParams.get('state'),code:randomBytes(16).toString('hex')});}
 return {first,second,options,config,calls,records,begin,authorize:v=>authorized=v,setClaims:v=>claims=v,outage:()=>failure=true,rotate:()=>rotation++,advance:ms=>time+=ms,async close(){await first.close();await second.close();store.clear();}};
}
test('OIDC PKCE/claims, session binding and atomic state/code consumption',async()=>{const f=await fixture();try{
 const callback=await f.begin();await assert.rejects(f.second.complete(f.config.id,{...owner,session:'wrong'},callback),{code:'LOGIN_DENIED'});
 const result=await f.second.complete(f.config.id,owner,callback);assert.equal(result.identity.subject,'subject-1');assert.equal(result.identity.protocol,'oidc');assert.equal(result.identity.emailVerified,true);assert.equal(result.linked,false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.notEqual(f.records[0].session,owner.session);assert.notEqual(f.records[0].key,callback.get('state'));
 await assert.rejects(f.first.complete(f.config.id,owner,callback),{code:'LOGIN_DENIED'});
 const next=await f.begin();next.set('code',callback.get('code'));const before=f.calls.length;await assert.rejects(f.first.complete(f.config.id,owner,next),{code:'LOGIN_DENIED'});assert.equal(f.calls.length,before);
}finally{await f.close();}});
test('nonce, issuer/audience, authorized party, malformed/future/expired claims and duplicate state fail',async()=>{const f=await fixture();try{
 for(const claims of [{nonce:'wrong'},{iss:'https://evil.example'},{aud:'other'},{aud:['client','other']},{azp:'other'},{exp:1},{nbf:9999999999},{iat:'malformed'}]){const cb=await f.begin();f.setClaims(claims);await assert.rejects(f.first.complete(f.config.id,owner,cb),{code:'LOGIN_DENIED'});}
 f.setClaims({});const duplicate=await f.begin();duplicate.append('state',duplicate.get('state'));await assert.rejects(f.first.complete(f.config.id,owner,duplicate),{code:'LOGIN_DENIED'});
 const expired=await f.begin();f.advance(300000);await assert.rejects(f.first.complete(f.config.id,owner,expired),{code:'LOGIN_DENIED'});assert.equal(auth.verifyOAuthState('a'.repeat(43),'é'.repeat(43)),false);
}finally{await f.close();}});
test('JWKS rotation and exchange outage never replay consumed attempt',async()=>{const f=await fixture();try{
 await f.first.complete(f.config.id,owner,await f.begin());await new Promise(r=>setTimeout(r,3));f.rotate();await f.first.complete(f.config.id,owner,await f.begin());assert.equal(f.calls.filter(url=>url===f.config.jwksUrl).length,2);
 f.outage();const cb=await f.begin();await assert.rejects(f.first.complete(f.config.id,owner,cb),e=>e.code==='LOGIN_UNAVAILABLE'&&!e.message.includes('PRIVATE'));const calls=f.calls.length;await assert.rejects(f.second.complete(f.config.id,owner,cb),{code:'LOGIN_DENIED'});assert.equal(f.calls.length,calls);
}finally{await f.close();}});
test('link/unlink requires fresh proof; unique subject ownership never uses email',async()=>{const f=await fixture();try{
 await assert.rejects(f.begin(f.first,'alice'),{code:'LOGIN_DENIED'});assert.equal(f.calls.length,0);
 f.authorize(true);const interrupted=await f.begin(f.first,'alice');f.authorize(false);await assert.rejects(f.second.complete(f.config.id,owner,interrupted),{code:'LOGIN_DENIED'});assert.equal(f.calls.length,0);
 f.authorize(true);f.setClaims({email_verified:false});const result=await f.first.complete(f.config.id,owner,await f.begin(f.first,'alice'));assert.equal(result.linked,true);assert.equal(result.identity.email,undefined);
 await assert.rejects(f.second.complete(f.config.id,owner,await f.begin(f.second,'bob')),{code:'LOGIN_DENIED'});
 f.authorize(false);await assert.rejects(f.first.unlink({tenant:owner.tenant,account:'alice'},owner.session,f.config.id,'subject-1'),{code:'LOGIN_DENIED'});
 f.authorize(true);assert.equal(await f.first.unlink({tenant:owner.tenant,account:'bob'},owner.session,f.config.id,'subject-1'),false);assert.equal(await f.second.unlink({tenant:owner.tenant,account:'alice'},owner.session,f.config.id,'subject-1'),true);
}finally{await f.close();}});
test('OAuth user info is not OIDC, unverified email excluded, endpoints/redirects are allowlisted',async()=>{const f=await fixture({provider:{profile:'github',protocol:'oauth2',scopes:['read:user']}});try{
 const result=await f.first.complete(f.config.id,owner,await f.begin());assert.equal(result.identity.protocol,'oauth2');assert.equal(result.identity.subject,'42');assert.equal(result.identity.emailVerified,false);assert.equal(result.identity.email,undefined);assert.equal(f.calls.includes(f.config.jwksUrl),false);
 assert.throws(()=>auth.createProviderLogin({...f.options,providers:[{...f.config,profile:'google'}]}),{code:'LOGIN_DENIED'});assert.throws(()=>auth.createProviderLogin({...f.options,providers:[{...f.config,tokenEndpoint:'https://evil.example/token'}]}),{code:'LOGIN_DENIED'});await assert.rejects(f.first.begin(f.config.id,owner,'https://evil.example/callback'),{code:'LOGIN_DENIED'});
}finally{await f.close();}});
test('slow response cancels reader and close invalidates only its client',async()=>{let cancelled=0;const f=await fixture({options:{timeoutMs:20,transport:async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})}});try{
 const cb=await f.begin();await assert.rejects(f.first.complete(f.config.id,owner,cb),{code:'LOGIN_UNAVAILABLE'});await f.first.close();assert.equal(cancelled,1);await assert.rejects(f.first.begin(f.config.id,owner,redirectUri),{code:'LOGIN_CLOSED'});assert.ok(await f.begin(f.second));
}finally{await f.close();}});
test('token hash binding and optional user-info subject mismatch are denied',async()=>{
 const f=await fixture();try{const good=createHash('sha256').update('PRIVATE_ACCESS_TOKEN').digest().subarray(0,16).toString('base64url');f.setClaims({at_hash:good});await f.first.complete(f.config.id,owner,await f.begin());f.setClaims({at_hash:'wrong'});await assert.rejects(f.first.complete(f.config.id,owner,await f.begin()),{code:'LOGIN_DENIED'});}finally{await f.close();}
});
test('OIDC user-info sub must match ID token; mappings keep vendor-specific trust semantics',async()=>{
 const mismatch=await fixture({provider:{loadUserInfo:true},userInfo:{sub:'other'}});try{await assert.rejects(mismatch.first.complete(mismatch.config.id,owner,await mismatch.begin()),{code:'LOGIN_DENIED'});}finally{await mismatch.close();}
 for(const profile of ['google','microsoft']){const f=await fixture({provider:{profile}});try{const result=await f.first.complete(f.config.id,owner,await f.begin());assert.equal(result.identity.emailVerified,profile==='google');}finally{await f.close();}}
 const discord=await fixture({provider:{profile:'discord',protocol:'oauth2',scopes:['identify','email']},userInfo:{id:'123456',verified:true,email:'verified@example.test'}});try{const result=await discord.first.complete(discord.config.id,owner,await discord.begin());assert.equal(result.identity.subject,'123456');assert.equal(result.identity.emailVerified,true);}finally{await discord.close();}
});
test('simultaneous callbacks consume once; declared authorization issuer is mandatory',async()=>{
 const f=await fixture({provider:{requireAuthorizationIssuer:true}});try{
  const invalid=await f.begin();await assert.rejects(f.first.complete(f.config.id,owner,invalid),{code:'LOGIN_DENIED'});
  const cb=await f.begin();cb.set('iss',f.config.issuer);const results=await Promise.allSettled([f.first.complete(f.config.id,owner,cb),f.second.complete(f.config.id,owner,cb)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 }finally{await f.close();}
});
test('pending store failure retains admission until native settlement and deadline prevents later exchange',async()=>{
 let release,started;const ready=new Promise(resolve=>started=resolve);const base=await fixture();
 const store={...base.options.store,async take(...args){const value=await base.options.store.take(...args);started();await new Promise(resolve=>release=resolve);return value;}};
 const client=auth.createProviderLogin({...base.options,store,maxPending:1,timeoutMs:15});
 try{
  const callback=await base.begin(client),pending=client.complete(base.config.id,owner,callback);await ready;
  await assert.rejects(pending,{code:'LOGIN_UNAVAILABLE'});await assert.rejects(client.begin(base.config.id,owner,redirectUri),{code:'LOGIN_CAPACITY'});
  let closed=false;const closing=client.close().then(()=>closed=true);await Promise.resolve();assert.equal(closed,false);release();await closing;assert.equal(base.calls.length,0);
 }finally{release?.();await client.close();await base.close();}
});

test('OAuth state indexes are keyed MACs of generated 256-bit tokens, not password hashes',async()=>{
 const {createHmac}=require('node:crypto');const f=await fixture();
 try{
  const callback=await f.begin(),state=callback.get('state'),record=f.records.at(-1);
  assert.match(state,/^[A-Za-z0-9_-]{43}$/);assert.equal(Buffer.from(state,'base64url').length,32);
  const index=(domain,values)=>createHmac('sha256',f.options.bindingKey).update(JSON.stringify(['zeruxjs.auth.provider.v1',domain,...values])).digest('base64url');
  assert.equal(record.key,index('state',[f.config.id,state]));
  assert.equal(record.session,index('session',[owner.tenant,owner.session]));
  assert.notEqual(record.key,state);assert.notEqual(record.session,owner.session);
  assert.equal(f.calls.length,0,'creating a local login attempt makes no provider request');
 }finally{await f.close();}
});
