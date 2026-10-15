export function validatedShareUrl(value:string):string {const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new TypeError('Only public HTTP(S) sharing URLs are supported');return url.href;}
export function normalizedShareData<T extends {url:string}>(data:T):T {return {...data,url:validatedShareUrl(data.url)};}
