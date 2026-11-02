/** AWS credential selection. An IAM role ARN names a role; STS is what issues credentials. */
export interface AwsKeyCredentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date }
export type AwsCredentialProvider = () => Promise<AwsKeyCredentials>;
export interface AssumeRoleOptions {
  roleArn: string;
  sessionName?: string;
  externalId?: string;
  durationSeconds?: number;
  /** MFA code and serial (when trust policy demands MFA). Prefer short-lived credentials. */
  mfa?: { serial: string; tokenCode: string };
  /** Source identity: explicit credentials, profile, or the default AWS credential chain. */
  sourceCredentials?: AwsKeyCredentials | AwsCredentialProvider;
  sourceProfile?: string;
  /** Region for STS; defaults to the S3 region. */
  stsRegion?: string;
}
export interface WebIdentityOptions {
  roleArn: string;
  tokenFile: string;
  sessionName?: string;
  stsRegion?: string;
}
export interface AwsCredentialOptions {
  /** Explicit trusted shared-config profile running the official Roles Anywhere signing helper. */
  rolesAnywhere?: { profile: string };
  /** Fixed, value-free provider diagnostics; exceptions from observers are isolated. */
  onCredentialStatus?: (status: Readonly<{status: 'valid' | 'expiring' | 'expired' | 'failed'; expiresAt?: number}>) => void;
  credentials?: AwsKeyCredentials | AwsCredentialProvider;
  profile?: string;
  assumeRole?: AssumeRoleOptions;
  webIdentity?: WebIdentityOptions;
}
const rolePattern = /^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]{1,512}$/;
export function assertRoleArn(value: string): void {
  if (typeof value !== 'string' || !rolePattern.test(value)) throw new TypeError('A valid IAM role ARN is required');
}
export function validateAwsCredentialOptions(input: AwsCredentialOptions): void {
  if(!input||typeof input!=='object')throw new TypeError('AWS credential options required');
  for(const key of ['credentials','assumeRole','webIdentity','rolesAnywhere'] as const){if(input[key]!==undefined&&(!input[key]||(typeof input[key]!=='object'&&!(key==='credentials'&&typeof input[key]==='function'))))throw new TypeError('Invalid AWS credential mode');}
  const choices=[input.credentials!==undefined,input.profile!==undefined,input.assumeRole!==undefined,input.webIdentity!==undefined,input.rolesAnywhere!==undefined];
  if (choices.filter(Boolean).length>1) throw new TypeError('Choose exactly one top-level AWS credential mode');
  if(input.rolesAnywhere && (typeof input.rolesAnywhere.profile!=='string'||! /^[A-Za-z0-9_+=,.@-]{1,128}$/.test(input.rolesAnywhere.profile)))throw new TypeError('Invalid Roles Anywhere profile');
  if(input.onCredentialStatus!==undefined&&typeof input.onCredentialStatus!=='function')throw new TypeError('Invalid credential observer');
  if (input.profile !== undefined && !/^[A-Za-z0-9_+=,.@-]{1,128}$/.test(input.profile)) throw new TypeError('Invalid AWS profile');
  if (input.assumeRole) {
    const role=input.assumeRole;assertRoleArn(role.roleArn);
    if (role.sourceCredentials && role.sourceProfile) throw new TypeError('Choose one role source credential mode');
    if (role.sourceProfile && !/^[A-Za-z0-9_+=,.@-]{1,128}$/.test(role.sourceProfile)) throw new TypeError('Invalid source profile');
    if (role.externalId !== undefined && (!role.externalId || role.externalId.length>1224)) throw new TypeError('Invalid role external ID');
    if (role.durationSeconds !== undefined && (!Number.isSafeInteger(role.durationSeconds)||role.durationSeconds<900||role.durationSeconds>43200)) throw new RangeError('Invalid STS role duration');
    if (role.mfa && (!/^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:mfa\/[A-Za-z0-9_+=,.@/-]{1,512}$/.test(role.mfa.serial)||!/^[0-9]{6,8}$/.test(role.mfa.tokenCode))) throw new TypeError('Invalid role MFA details');
  }
  if (input.webIdentity) {
    assertRoleArn(input.webIdentity.roleArn);
    if (!input.webIdentity.tokenFile || input.webIdentity.tokenFile.includes('\0')) throw new TypeError('Invalid OIDC token file');
  }
  for(const credentials of [input.credentials,input.assumeRole?.sourceCredentials]){
    if (credentials && typeof credentials !== 'function' && (typeof credentials.accessKeyId!=='string'||!credentials.accessKeyId||typeof credentials.secretAccessKey!=='string'||!credentials.secretAccessKey)) throw new TypeError('Invalid AWS access key credentials');
  }
  for(const name of [input.assumeRole?.sessionName,input.webIdentity?.sessionName]) {
    if (name!==undefined && !/^[A-Za-z0-9_+=,.@-]{2,64}$/.test(name)) throw new TypeError('Invalid AWS role session name');
  }
}
/**
 * Returns undefined to let S3Client use the complete AWS default provider chain:
 * environment, SSO, shared config, IAM Identity Center, ECS/EKS, EC2 metadata, etc.
 * The official AWS SDK refreshes assumed-role / web-identity credentials automatically.
 */
async function selectAwsCredentials(input: AwsCredentialOptions, region: string): Promise<AwsKeyCredentials|AwsCredentialProvider|undefined> {
  validateAwsCredentialOptions(input);
  if(input.credentials) return input.credentials;
  if(input.rolesAnywhere){const {fromProcess}=await import('@aws-sdk/credential-providers');return fromProcess({profile:input.rolesAnywhere.profile});}
  if(input.profile){const {fromIni}=await import('@aws-sdk/credential-providers');return fromIni({profile:input.profile,clientConfig:{region}});}
  if(input.assumeRole){
    const role=input.assumeRole,{fromTemporaryCredentials,fromIni}=await import('@aws-sdk/credential-providers');
    const masterCredentials=role.sourceCredentials??(role.sourceProfile?fromIni({profile:role.sourceProfile,clientConfig:{region:role.stsRegion??region}}):undefined);
    return fromTemporaryCredentials({clientConfig:{region:role.stsRegion??region},masterCredentials,params:{RoleArn:role.roleArn,RoleSessionName:role.sessionName??'zerux-files',ExternalId:role.externalId,DurationSeconds:role.durationSeconds,...(role.mfa?{SerialNumber:role.mfa.serial,TokenCode:role.mfa.tokenCode}:{})}});
  }
  if(input.webIdentity){const role=input.webIdentity,{fromTokenFile}=await import('@aws-sdk/credential-providers');return fromTokenFile({roleArn:role.roleArn,webIdentityTokenFile:role.tokenFile,roleSessionName:role.sessionName??'zerux-files',clientConfig:{region:role.stsRegion??region}});}
  return undefined;
}

/** Validates every refresh result without exposing credential values or provider errors to observers. */
export function monitorAwsCredentials(provider: AwsCredentialProvider, onStatus?: AwsCredentialOptions['onCredentialStatus']): AwsCredentialProvider {
  if(typeof provider!=='function'||(onStatus!==undefined&&typeof onStatus!=='function'))throw new TypeError('Invalid credential monitor');
  const notify=(status: Parameters<NonNullable<AwsCredentialOptions['onCredentialStatus']>>[0])=>{try{onStatus?.(Object.freeze(status));}catch{/* Diagnostics cannot change signing. */}};
  return async()=>{
    let expired=false;
    try {
      const credentials=await provider();
      if(!credentials || typeof credentials.accessKeyId!=='string'||!credentials.accessKeyId||typeof credentials.secretAccessKey!=='string'||!credentials.secretAccessKey||
        (credentials.sessionToken!==undefined&&typeof credentials.sessionToken!=='string'))throw new Error('Invalid credential result');
      const expiresAt=credentials.expiration instanceof Date?credentials.expiration.getTime():undefined;
      if(credentials.expiration!==undefined&&(!Number.isFinite(expiresAt)||!(credentials.expiration instanceof Date)))throw new Error('Invalid credential expiration');
      if(expiresAt!==undefined&&expiresAt<=Date.now()){
        expired=true;notify({status:'expired',expiresAt});
        throw Object.assign(new Error('AWS credentials expired'),{code:'CREDENTIALS_EXPIRED'});
      }
      notify({status:expiresAt!==undefined&&expiresAt-Date.now()<=300000?'expiring':'valid',...(expiresAt!==undefined?{expiresAt}:{})});
      return {...credentials};
    } catch(cause) {
      if(expired)throw cause;
      notify({status:'failed'});
      throw Object.assign(new Error('AWS credential resolution failed',{cause}),{code:'CREDENTIALS_FAILED'});
    }
  };
}
/** Providers remain SDK-owned and refresh on demand; no timer or process starts on import. */
export async function resolveAwsCredentials(input: AwsCredentialOptions, region: string): Promise<AwsKeyCredentials|AwsCredentialProvider|undefined> {
  let selected=await selectAwsCredentials(input,region);
  if(selected===undefined && !input.onCredentialStatus)return undefined;
  if(selected===undefined){const {fromNodeProviderChain}=await import('@aws-sdk/credential-providers');selected=fromNodeProviderChain({clientConfig:{region}});}
  // Preserve the existing static-credential result when diagnostics are not requested.
  if(typeof selected!=='function'&&!input.onCredentialStatus&&selected.expiration===undefined)return selected;
  const source=selected;
  return monitorAwsCredentials(typeof source==='function'?source:async()=>source!,input.onCredentialStatus);
}
