import { SignJWT, importJWK, type JWK } from 'jose';
import { validateJwtKey, JwtVerificationError, type JwtAlgorithm, type JwtVerificationKey } from './jwt.js';
export interface JwtSignerOptions { key:JWK; kid:string; algorithm:JwtAlgorithm; issuer:string; audience:string; type:string; maxLifetimeSeconds?:number; maxPending?:number; now?:()=>number }
/** Explicit JWT issuance via JOSE. No encryption/password hashing or token authorization is inferred. */
export function createJwtSigner(options:JwtSignerOptions) {
  const deny=()=>new JwtVerificationError('JWT_REJECTED');
  if(!options||!options.key||typeof options.key!=='object')throw deny();
  const key={...options.key,alg:options.algorithm,kid:options.kid};
  if(options.key.alg!==undefined&&options.key.alg!==options.algorithm||options.key.kid!==undefined&&options.key.kid!==options.kid||options.key.use!==undefined&&options.key.use!=='sig'||options.key.key_ops!==undefined&&(!Array.isArray(options.key.key_ops)||options.key.key_ops.length!==1||options.key.key_ops[0]!=='sign'))throw deny();
  const publicPart={...key,key_ops:['verify']};for(const name of ['d','p','q','dp','dq','qi','oth'])delete (publicPart as Record<string,unknown>)[name];
  validateJwtKey(publicPart as JwtVerificationKey);
  const privateBytes=(value:unknown,max:number,exact?:number)=>{
    if(typeof value!=='string'||!value.length||value.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(value))throw deny();
    const bytes=Buffer.from(value,'base64url');if(bytes.length>max||exact!==undefined&&bytes.length!==exact||bytes.toString('base64url')!==value)throw deny();
  };
  if(key.kty==='RSA'){if(key.oth!==undefined)throw deny();for(const name of ['d','p','q','dp','dq','qi'] as const)privateBytes(key[name],1024);}
  else if(key.kty==='EC'){const size=key.crv==='P-256'?32:key.crv==='P-384'?48:66;privateBytes(key.d,size,size);}
  else if(key.kty==='OKP')privateBytes(key.d,32,32);
  const text=(value:unknown,max=512):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&Buffer.byteLength(value)<=max&&!/[\x00-\x1f\x7f]/.test(value);
  const max=options.maxLifetimeSeconds===undefined?3600:options.maxLifetimeSeconds,cap=options.maxPending===undefined?32:options.maxPending,now=options.now===undefined?Date.now:options.now;
  if(!text(options.issuer)||!text(options.audience)||!text(options.type,64)||!Number.isSafeInteger(max)||max<1||max>604800||!Number.isSafeInteger(cap)||cap<1||cap>256||typeof now!=='function')throw deny();
  const issuer=options.issuer,audience=options.audience,type=options.type,algorithm=options.algorithm,kid=options.kid;
  let closed=false,closing:Promise<void>|undefined;const pending=new Set<Promise<string>>();
  return {
    sign(claims:Record<string,unknown>,input:{subject:string;ttlSeconds:number;jti?:string}):Promise<string>{
      if(closed)return Promise.reject(new JwtVerificationError('JWT_CLOSED'));
      if(pending.size>=cap)return Promise.reject(new JwtVerificationError('JWT_OVERLOAD'));
      const work=Promise.resolve().then(async()=>{
        if(!input||!text(input.subject)||!Number.isSafeInteger(input.ttlSeconds)||input.ttlSeconds<1||input.ttlSeconds>max||input.jti!==undefined&&!text(input.jti,256)||!claims||typeof claims!=='object'||Array.isArray(claims)||Object.keys(claims).some(name=>['iss','aud','sub','exp','iat','nbf','jti','__proto__','constructor','prototype'].includes(name)))throw deny();
        let nodes=0,bytes=0;const seen=new WeakSet<object>();
        const check=(value:unknown,depth:number):void=>{
          if(++nodes>256||depth>12)throw deny();
          if(typeof value==='string'){if(value.length>8192||(bytes+=Buffer.byteLength(value))>8192)throw deny();return;}
          if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
          if(!value||typeof value!=='object'||seen.has(value))throw deny();seen.add(value);
          if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw deny();
          const entries=Object.entries(Object.getOwnPropertyDescriptors(value));if(entries.length>128)throw deny();
          for(const [name,descriptor]of entries){if(!('value'in descriptor)||['__proto__','prototype','constructor'].includes(name)||name.length>256||(bytes+=Buffer.byteLength(name))>8192)throw deny();check(descriptor.value,depth+1);}
          seen.delete(value);
        };check(claims,0);
        const raw=JSON.stringify(claims);if(raw.length>8192||Buffer.byteLength(raw)>8192)throw deny();
        const timestamp=now();if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>253402300799000)throw deny();
        const issued=Math.floor(timestamp/1000),payload=JSON.parse(raw);if(issued+input.ttlSeconds>253402300799)throw deny();
        const signer=new SignJWT(payload).setProtectedHeader({alg:algorithm,kid,typ:type}).setIssuer(issuer).setAudience(audience).setSubject(input.subject).setIssuedAt(issued).setExpirationTime(issued+input.ttlSeconds);
        if(input.jti!==undefined)signer.setJti(input.jti);
        const result=await signer.sign(await importJWK(key,algorithm));if(result.length>16384)throw deny();return result;
      }).catch(cause=>{if(cause instanceof JwtVerificationError)throw cause;throw new JwtVerificationError('JWT_REJECTED',{cause});});
      pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
    },
    close(){closed=true;return closing??=Promise.resolve().then(async()=>{await Promise.allSettled([...pending]);for(const name of Object.keys(key))delete (key as Record<string,unknown>)[name];});}
  };
}
