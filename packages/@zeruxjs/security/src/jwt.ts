import {decodeProtectedHeader,decodeJwt,importJWK,jwtVerify,type JWK,type JWTPayload} from 'jose';
import {hashData} from './cryptography.js';
export type JwtAlgorithm='HS256'|'HS384'|'HS512'|'RS256'|'RS384'|'RS512'|'PS256'|'PS384'|'PS512'|'ES256'|'ES384'|'ES512'|'EdDSA';
export type JwtVerificationKey=JWK&{kid:string;alg:JwtAlgorithm};
export interface VerifiedJwt {payload:JWTPayload;protectedHeader:Readonly<{alg:JwtAlgorithm;kid:string;typ?:string}>}
export interface JwtRequest {signal?:AbortSignal;deadline?:number}
export interface JwtKeySource {getKeys(kid:string,request?:JwtRequest):Promise<readonly JwtVerificationKey[]>;close?():Promise<void>|void}
export interface JwtReplayStore {/** Atomic insert-if-absent, true only for the first accepted JTI. Expiry is Unix milliseconds. */consume(input:{key:string;expiresAt:number},request:JwtRequest):Promise<boolean>}
export interface JwtVerificationPolicy {
 algorithms:readonly JwtAlgorithm[];issuer:string;audience:string|readonly string[];type:string;
 requiredClaims:readonly string[];subject:'optional'|'required'|{equals:string};
 jti:'optional'|'required'|{consume:JwtReplayStore;maxTtlSeconds:number};
 requireType?:boolean;maxTokenAgeSeconds?:number;clockToleranceSeconds?:number;now?:()=>number;
}
export class JwtVerificationError extends Error {constructor(readonly code:'JWT_REJECTED'|'JWT_UNAVAILABLE'|'JWT_CLOSED'|'JWT_OVERLOAD',options?:ErrorOptions){super(code.toLowerCase().replaceAll('_',' '),options);this.name='JwtVerificationError';}}
export const jwtRejected=()=>new JwtVerificationError('JWT_REJECTED');
const algorithms:readonly string[]=['HS256','HS384','HS512','RS256','RS384','RS512','PS256','PS384','PS512','ES256','ES384','ES512','EdDSA'];
const text=(value:unknown,max=512):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&Buffer.byteLength(value)<=max&&!/[\x00-\x1f\x7f]/.test(value);
function binary(value:unknown,max:number):Buffer{if(typeof value!=='string'||!value.length||value.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(value))throw jwtRejected();const decoded=Buffer.from(value,'base64url');if(decoded.length>max||decoded.toString('base64url')!==value)throw jwtRejected();return decoded;}
/** Validate key metadata and curve before JOSE import. Verification never accepts asymmetric private keys. */
export function validateJwtKey(input:JwtVerificationKey,remote=false):JwtVerificationKey{
 if(!input||typeof input!=='object'||Array.isArray(input)||!algorithms.includes(input.alg)||typeof input.kid!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(input.kid)||input.use!==undefined&&input.use!=='sig'||input.key_ops!==undefined&&(!Array.isArray(input.key_ops)||input.key_ops.length!==1||input.key_ops[0]!=='verify'))throw jwtRejected();
 for(const name of ['d','p','q','dp','dq','qi','oth'])if(name in input)throw jwtRejected();
 if(input.alg.startsWith('HS')){if(remote||input.kty!=='oct'||binary(input.k,128).length<Number(input.alg.slice(2))/8)throw jwtRejected();}
 else if(input.alg.startsWith('RS')||input.alg.startsWith('PS')){if(input.kty!=='RSA')throw jwtRejected();const n=binary(input.n,1024),e=binary(input.e,8),bits=n.length*8-(Math.clz32(n[0])-24);let exponent=0n;for(const byte of e)exponent=(exponent<<8n)+BigInt(byte);if(n[0]===0||bits<2048||bits>8192||exponent<3n||exponent%2n===0n)throw jwtRejected();}
 else if(input.alg.startsWith('ES')){const curve={ES256:['P-256',32],ES384:['P-384',48],ES512:['P-521',66]}[input.alg as 'ES256'|'ES384'|'ES512']!;if(input.kty!=='EC'||input.crv!==curve[0]||binary(input.x,66).length!==curve[1]||binary(input.y,66).length!==curve[1])throw jwtRejected();}
 else if(input.kty!=='OKP'||input.crv!=='Ed25519'||binary(input.x,32).length!==32)throw jwtRejected();
 // Only public signing metadata/material leaves this validator; no certificates/URLs are key selectors.
 const data=input as unknown as Record<string,unknown>;
 const names=['kty','kid','alg','use','key_ops',...(input.kty==='oct'?['k']:input.kty==='RSA'?['n','e']:input.kty==='EC'?['crv','x','y']:['crv','x'])];return Object.fromEntries(names.filter(k=>data[k]!==undefined).map(k=>[k,Array.isArray(data[k])?[...data[k] as unknown[]]:data[k]])) as JwtVerificationKey;
}
function policy(raw:JwtVerificationPolicy){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.algorithms)||!raw.algorithms.length||raw.algorithms.length>13||new Set(raw.algorithms).size!==raw.algorithms.length||raw.algorithms.some(a=>!algorithms.includes(a))||!text(raw.issuer)||!text(raw.type,64)||!Array.isArray(raw.requiredClaims)||raw.requiredClaims.length>32||raw.requiredClaims.some(c=>!text(c,64)||! /^[A-Za-z_][A-Za-z0-9_]*$/.test(c)))throw new TypeError('Invalid JWT policy');
 const audience=typeof raw.audience==='string'?[raw.audience]:raw.audience;if(!Array.isArray(audience)||!audience.length||audience.length>8||audience.some(a=>!text(a)))throw new TypeError('Invalid JWT audience');
 if(raw.requireType!==undefined&&typeof raw.requireType!=='boolean')throw new TypeError('Invalid JWT type policy');
 if(raw.subject!=='optional'&&raw.subject!=='required'&&(!raw.subject||typeof raw.subject!=='object'||!text(raw.subject.equals)))throw new TypeError('Invalid JWT subject policy');
 if(raw.jti!=='optional'&&raw.jti!=='required'&&(!raw.jti||typeof raw.jti!=='object'||typeof raw.jti.consume?.consume!=='function'||!Number.isSafeInteger(raw.jti.maxTtlSeconds)||raw.jti.maxTtlSeconds<1||raw.jti.maxTtlSeconds>604800))throw new TypeError('Invalid JWT replay policy');
 const tolerance=raw.clockToleranceSeconds===undefined?0:raw.clockToleranceSeconds;if(typeof tolerance!=='number'||!Number.isSafeInteger(tolerance)||tolerance<0||tolerance>120||raw.maxTokenAgeSeconds!==undefined&&(!Number.isSafeInteger(raw.maxTokenAgeSeconds)||raw.maxTokenAgeSeconds<1||raw.maxTokenAgeSeconds>604800)||raw.now!==undefined&&typeof raw.now!=='function')throw new TypeError('Invalid JWT clock policy');
 return {...raw,algorithms:[...raw.algorithms],audience:[...audience],requiredClaims:[...raw.requiredClaims],subject:typeof raw.subject==='object'?{...raw.subject}:raw.subject,jti:typeof raw.jti==='object'?{maxTtlSeconds:raw.jti.maxTtlSeconds,consume:{consume:raw.jti.consume.consume.bind(raw.jti.consume)}}:raw.jti,clockToleranceSeconds:tolerance};
}
/** Compact signed JWT verification only. Explicit static keys or one host-owned JWKS source. */
export function createJwtVerifier(options:{policy:JwtVerificationPolicy;keys?:readonly JwtVerificationKey[];jwks?:JwtKeySource;ownJwks?:boolean;timeoutMs?:number;maxPending?:number}){
 if(!options||typeof options!=='object'||Boolean(options.keys)===Boolean(options.jwks)||options.ownJwks!==undefined&&typeof options.ownJwks!=='boolean')throw new TypeError('Choose static JWT keys or JWKS');const config=policy(options.policy),source=options.jwks,own=options.ownJwks===true;
 if(source&&typeof source.getKeys!=='function')throw new TypeError('Invalid JWKS source');
 if(options.keys&&(!Array.isArray(options.keys)||!options.keys.length||options.keys.length>16))throw new TypeError('Invalid JWT keys');
 const keys=options.keys?.map(key=>validateJwtKey(key));if(keys&&(!keys.length||keys.length>16||new Set(keys.map(k=>k.kid)).size!==keys.length))throw new TypeError('Invalid JWT keys');
 const timeout=options.timeoutMs===undefined?2000:options.timeoutMs,cap=options.maxPending===undefined?32:options.maxPending;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||!Number.isSafeInteger(cap)||cap<1||cap>256)throw new TypeError('Invalid JWT limits');
 let closed=false,closing:Promise<void>|undefined;const pending=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 async function verifyWithHeader(token:string,request:JwtRequest={}):Promise<VerifiedJwt>{
   if(closed)throw new JwtVerificationError('JWT_CLOSED');if(typeof token!=='string'||token.length>16384||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||!request||typeof request!=='object'||request.signal!==undefined&&!(request.signal instanceof AbortSignal)||request.deadline!==undefined&&(!Number.isSafeInteger(request.deadline)||request.deadline<0))throw jwtRejected();
   request={signal:request.signal,deadline:request.deadline};
   if(pending.size>=cap)throw new JwtVerificationError('JWT_OVERLOAD');const controller=new AbortController(),abort=()=>controller.abort(),deadline=Math.min(Date.now()+timeout,request.deadline??Infinity);if(request.signal?.aborted||deadline<=Date.now())throw new JwtVerificationError('JWT_UNAVAILABLE');request.signal?.addEventListener('abort',abort,{once:true});controllers.add(controller);
   let timer:ReturnType<typeof setTimeout>|undefined,cancel=()=>{};
   const work=Promise.resolve().then(async()=>{
    const check=()=>{if(closed||controller.signal.aborted||Date.now()>=deadline)throw new JwtVerificationError('JWT_UNAVAILABLE');};check();
    const header=decodeProtectedHeader(token);if(Object.keys(header).some(k=>!['alg','kid','typ'].includes(k))||!config.algorithms.includes(header.alg as JwtAlgorithm)||(header.typ===undefined?config.requireType!==false:header.typ!==config.type)||typeof header.kid!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(header.kid))throw jwtRejected();
    const payload=decodeJwt(token);for(const claim of ['exp','nbf','iat'] as const)if(payload[claim]!==undefined&&(!Number.isSafeInteger(payload[claim])||payload[claim]! < 0||payload[claim]! > 253402300799))throw jwtRejected();
    if(payload.sub!==undefined&&!text(payload.sub)||payload.jti!==undefined&&!text(payload.jti,256)||payload.nbf!==undefined&&payload.exp!==undefined&&payload.nbf>=payload.exp)throw jwtRejected();
    const now=config.now?.()??Date.now();if(!Number.isSafeInteger(now)||now<0||now>253402300799000)throw new JwtVerificationError('JWT_UNAVAILABLE');
    let candidates:readonly JwtVerificationKey[];
    try{candidates=keys??await source!.getKeys(header.kid,{signal:controller.signal,deadline});}catch(cause){throw new JwtVerificationError('JWT_UNAVAILABLE',{cause});}check();if(!Array.isArray(candidates)||candidates.length>16)throw jwtRejected();
    const matches=candidates.filter(k=>k.kid===header.kid&&k.alg===header.alg);if(matches.length!==1)throw jwtRejected();const jwk=validateJwtKey(matches[0],Boolean(source));
    const key=await importJWK(jwk,jwk.alg);check();
    const required=new Set(config.requiredClaims);if(config.subject!=='optional')required.add('sub');if(config.jti!=='optional')required.add('jti');if(typeof config.jti==='object')required.add('exp');
    const verified=await jwtVerify(token,key,{algorithms:config.algorithms,issuer:config.issuer,audience:config.audience,...(header.typ===undefined&&config.requireType===false?{}:{typ:config.type}),requiredClaims:[...required],clockTolerance:config.clockToleranceSeconds,currentDate:new Date(now),...(config.maxTokenAgeSeconds===undefined?{}:{maxTokenAge:config.maxTokenAgeSeconds}),...(typeof config.subject==='object'?{subject:config.subject.equals}:{})});check();
    if(typeof config.jti==='object'){const expiresAt=(verified.payload.exp!+config.clockToleranceSeconds)*1000;if(expiresAt<=now||expiresAt-now>config.jti.maxTtlSeconds*1000)throw jwtRejected();let accepted:boolean;try{accepted=await config.jti.consume.consume({key:hashData(JSON.stringify([config.issuer,config.audience,config.type,verified.payload.jti])),expiresAt},{signal:controller.signal,deadline});}catch(cause){throw new JwtVerificationError('JWT_UNAVAILABLE',{cause});}check();if(accepted!==true)throw jwtRejected();}
    return {payload:verified.payload,protectedHeader:Object.freeze({alg:header.alg as JwtAlgorithm,kid:header.kid,...(header.typ===undefined?{}:{typ:header.typ})})};
   });pending.add(work);void work.finally(()=>{pending.delete(work);controllers.delete(controller);}).catch(()=>{});
   try{return await Promise.race([work,new Promise<never>((_,reject)=>{cancel=()=>reject(new JwtVerificationError('JWT_UNAVAILABLE'));controller.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(abort,Math.max(1,deadline-Date.now()));})]);}catch(error){if(error instanceof JwtVerificationError)throw error;throw new JwtVerificationError('JWT_REJECTED',{cause:error});}finally{if(timer)clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);request.signal?.removeEventListener('abort',abort);}
  }
 return {
  verifyWithHeader,
  async verify(token:string,request:JwtRequest={}):Promise<JWTPayload>{return (await verifyWithHeader(token,request)).payload;},
  getDiagnostics(){return Object.freeze({closed,pending:pending.size});},
  close(){closed=true;return closing??=Promise.resolve().then(async()=>{for(const controller of controllers)controller.abort();await Promise.allSettled([...pending]);if(own)await source?.close?.();if(keys)for(const key of keys)if(key.k)key.k='';});}
 };
}
