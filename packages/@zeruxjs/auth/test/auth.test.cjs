const {test} = require('node:test'); const assert=require('node:assert/strict');
const crypto=require('node:crypto'); const auth=require('../dist/index.js');
test('password policy and legacy session can roundtrip',()=>{
 assert.equal(auth.validatePasswordStrength('short').valid,false);
 const hash=auth.hashPassword('this is a secret password');
 assert.equal(auth.verifyPassword('this is a secret password',hash),true);
 assert.equal(auth.verifyPassword('bad',hash),false);
 assert.equal(auth.verifyPassword('a', 'scrypt:garbage:hash'),false);
 const token=auth.createSession('user1', {userId:'evil',expiresAt:0,role:'editor'});
 const session=auth.verifySession(token); assert.equal(session.userId,'user1'); assert.equal(session.role,'editor'); assert.equal(session.jti.length,22);
 assert.equal(auth.verifySession(token+'broken'),null);
});
test('TOTP matches RFC 6238 vectors with base32 secret',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII 12345678901234567890
 assert.equal(auth.generateTotp(secret,{now:59_000,digits:8}),'94287082');
 assert.equal(auth.verifyTotp('94287082',secret,{now:59_000,digits:8,window:0}),true);
 assert.equal(auth.verifyTotp('94287083',secret,{now:59_000,digits:8,window:0}),false);
 assert.equal(auth.generateTotpSecret().length >= 32,true);
 assert.ok(auth.totpUri(secret,'alice@example.com','Example').startsWith('otpauth://'));
});
test('scoped API tokens, expiry and revocation',()=>{
 let now=1000; const tokens=auth.createTokenStore({now:()=>now,maxTokens:2});
 const issued=tokens.issue('alice',['read'],5000);
 assert.equal(tokens.verify(issued.token,'read').subject,'alice');
 assert.equal(tokens.verify(issued.token,'write'),null);
 assert.equal(tokens.verify(issued.token+'tamper'),null);
 assert.equal(tokens.revoke(issued.id),true); assert.equal(tokens.verify(issued.token),null);
 const second=tokens.issue('bob',[],1000); now+=1001; assert.equal(tokens.verify(second.token),null);
});
test('in-process session revocation works with expiry',()=>{
 let now=1000; const store=auth.createSessionRevocationStore({now:()=>now});
 const jti=crypto.randomBytes(16).toString('base64url');
 store.revoke(jti,2); assert.equal(store.isRevoked({jti}),true);
 now=2001; assert.equal(store.isRevoked({jti}),false);
});

test('OAuth PKCE flow validates redirect allowlist and state',()=>{
 const params={authorizationEndpoint:'https://idp.example/authorize',clientId:'client',redirectUri:'https://app.example/callback',allowedRedirectUris:['https://app.example/callback'],scopes:['openid']};
 const request=auth.createOAuthAuthorization(params);
 const url=new URL(request.url); assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('state'),request.state);
 assert.equal(auth.verifyOAuthState(request.state,request.state),true);
 assert.equal(auth.verifyOAuthState(request.state,'wrong'),false);
 assert.throws(()=>auth.createOAuthAuthorization({...params,redirectUri:'https://evil.example/callback'}));
});
