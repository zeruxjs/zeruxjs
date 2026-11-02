const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');const {execFileSync}=require('node:child_process');
test('packed provider API and JWT subpath work together without source aliases or optional browser libraries',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'provider-public-')),root=path.resolve(__dirname,'../../../..');
 try{
  function pack(folder){const result=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--cache',path.join(dir,'cache'),'--pack-destination',dir],{cwd:folder,encoding:'utf8'}));return path.join(dir,(Array.isArray(result)?result[0]:Object.values(result)[0]).filename);}
  const deps={'@zeruxjs/auth':`file:${pack(path.join(root,'packages/@zeruxjs/auth'))}`,'@zeruxjs/security':`file:${pack(path.join(root,'packages/@zeruxjs/security'))}`,jose:`file:${pack(path.dirname(require.resolve('jose/package.json')))}`};
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({type:'module',private:true,dependencies:deps}));execFileSync('npm',['install','--offline','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(dir,'cache')],{cwd:dir,stdio:'pipe'});
  fs.writeFileSync(path.join(dir,'consumer.ts'),`import {createProviderLogin,createMemoryProviderLoginStore,type LoginProvider} from '@zeruxjs/auth';
import {createJwtSigner,createJwtVerifier} from '@zeruxjs/security/jwt';
const key={kty:'oct',kid:'fixture',alg:'HS256' as const,k:'A'.repeat(43)};
const signer=createJwtSigner({key,kid:'fixture',algorithm:'HS256',issuer:'https://issuer.example',audience:'client',type:'JWT'});
const verifier=createJwtVerifier({keys:[key],policy:{algorithms:['HS256'],issuer:'https://issuer.example',audience:'client',type:'JWT',requiredClaims:['exp'],subject:'required',jti:'optional'}});
try {const token=await signer.sign({scope:'read'},{subject:'fixture',ttlSeconds:60});if((await verifier.verify(token)).sub!=='fixture')throw Error('JWT failed');}finally{await signer.close();await verifier.close();}
const provider:LoginProvider={id:'example',profile:'custom',protocol:'oidc',label:'Example',issuer:'https://issuer.example',authorizationEndpoint:'https://issuer.example/auth',tokenEndpoint:'https://issuer.example/token',userInfoEndpoint:'https://issuer.example/user',jwksUrl:'https://issuer.example/keys',allowedUrls:['https://issuer.example/auth','https://issuer.example/token','https://issuer.example/user','https://issuer.example/keys'],redirectUris:['https://app.example/callback'],scopes:['openid'],clientId:'fixture',tokenAuthentication:'none',mapProfile:value=>({subject:typeof value.sub==='string'?value.sub:''})};
let network=0;const store=createMemoryProviderLoginStore();const login=createProviderLogin({providers:[provider],store,bindingKey:new Uint8Array(32),authorizeFresh:async()=>false,transport:async()=>{network++;throw Error('No configured live transport');}});
try {const result=await login.begin('example',{tenant:'fixture',session:'fixture-session'},'https://app.example/callback');if(!new URL(result.url).searchParams.has('nonce')||network)throw Error('Flow not inert');}finally{await login.close();store.clear();}
`);
  execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--skipLibCheck','consumer.ts'],{cwd:dir,stdio:'pipe'});execFileSync(process.execPath,['consumer.js'],{cwd:dir,stdio:'pipe'});
  assert.equal(fs.existsSync(path.join(dir,'node_modules/@zeruxjs/auth/src')),false);assert.equal(fs.existsSync(path.join(dir,'node_modules/@zeruxjs/security/src')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
