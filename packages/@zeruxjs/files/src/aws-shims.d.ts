declare module '@aws-sdk/client-s3' {
 export class S3Client { constructor(a:any); send(command:any):Promise<any>; destroy():void; }
 export class HeadObjectCommand{constructor(a:any)} export class GetObjectCommand{constructor(a:any)} export class PutObjectCommand{constructor(a:any)} export class DeleteObjectCommand{constructor(a:any)} export class ListObjectsV2Command{constructor(a:any)} export class CopyObjectCommand{constructor(a:any)}
}
declare module '@aws-sdk/lib-storage' { export class Upload {constructor(a:any);done():Promise<any>;abort():void;} }
declare module '@aws-sdk/s3-request-presigner' {export function getSignedUrl(client:any,command:any,options:any):Promise<string>}
declare module '@aws-sdk/cloudfront-signer' {export function getSignedUrl(options:any):string}
declare module '@aws-sdk/credential-providers' {
 export function fromIni(options:any): () => Promise<any>;
 export function fromTemporaryCredentials(options:any): () => Promise<any>;
 export function fromTokenFile(options:any): () => Promise<any>;
}
