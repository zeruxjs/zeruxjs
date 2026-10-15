declare module 'nodemailer' {
  const client:{createTransport(options:Record<string,unknown>):{sendMail(message:Record<string,unknown>):Promise<{messageId?:string;accepted?:unknown[];rejected?:unknown[];response?:string}>;verify():Promise<boolean>;close():void}};
  export default client;
}
declare module 'juice' {const juice:(html:string,options?:Record<string,unknown>)=>string;export default juice;}
declare module 'sanitize-html' {const sanitize:(html:string,options?:Record<string,unknown>)=>string;export default sanitize;}
declare module 'html-to-text' {export function convert(html:string,options?:Record<string,unknown>):string;}
declare module 'imapflow' { export const ImapFlow: new (options:any)=>any; }
declare module 'node-pop3' { const Pop3Command: new (options:any)=>any; export default Pop3Command; }
declare module 'mailparser' { export const simpleParser:(raw:Buffer)=>Promise<any>; }
