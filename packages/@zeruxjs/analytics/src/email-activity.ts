/** Email delivery telemetry is independent of marketing recipient consent.
 * No raw email addresses or destination URLs are stored in these summaries.
 */
export type EmailActivityKind='sent'|'open'|'click'|'download_click'|'download';
export interface EmailActivityEvent {
  kind:EmailActivityKind;
  id:string;
  account:string;
  campaign:string;
  at:number;
  /** SHA-256 identifier of an HTTPS link; never its destination or recipient. */
  linkId?:string;
  /** Bytes actually served by the application after a successful download. */
  bytes?:number;
}
export interface EmailActivityLink {
  id:string;
  clicks:number;
  firstClickedAt?:number;
  lastClickedAt?:number;
  downloadClicks:number;
  firstDownloadClickedAt?:number;
  lastDownloadClickedAt?:number;
  downloads:number;
  firstDownloadedAt?:number;
  lastDownloadedAt?:number;
  downloadedBytes:number;
}
export interface EmailActivitySummary {
  id:string;
  account:string;
  campaign:string;
  sentAt?:number;
  opens:number;
  firstOpenedAt?:number;
  lastOpenedAt?:number;
  clicks:number;
  firstClickedAt?:number;
  lastClickedAt?:number;
  downloadClicks:number;
  firstDownloadClickedAt?:number;
  lastDownloadClickedAt?:number;
  downloads:number;
  firstDownloadedAt?:number;
  lastDownloadedAt?:number;
  downloadedBytes:number;
  links:EmailActivityLink[];
}
/** Implement with atomic record() and shared storage across servers/queue workers in production.
 * No consent check is invoked here. An exception or outage must never block delivery.
 */
export interface EmailActivityStore {
  record(event:Readonly<EmailActivityEvent>):Promise<void>;
  get(id:string):Promise<EmailActivitySummary|null>;
}
export function createMemoryEmailActivityStore(options:{maxMessages?:number}={}):EmailActivityStore {
  const max=options.maxMessages??10_000;
  if(!Number.isSafeInteger(max)||max<1||max>100_000)throw new RangeError('Invalid email activity memory limit');
  const messages=new Map<string,EmailActivitySummary>();
  return {
    async record(event){
      if(!/^[A-Za-z0-9._:-]{1,128}$/.test(event.id)||!Number.isSafeInteger(event.at)||event.at<0)throw new TypeError('Invalid email activity event');
      let item=messages.get(event.id);
      if(!item){
        if(messages.size>=max)messages.delete(messages.keys().next().value!);
        item={id:event.id,account:event.account,campaign:event.campaign,opens:0,clicks:0,downloadClicks:0,downloads:0,downloadedBytes:0,links:[]};
        messages.set(event.id,item);
      }
      if(event.kind==='sent'){item.sentAt??=event.at;return;}
      if(event.kind==='open'){
        item.opens++;item.firstOpenedAt=Math.min(item.firstOpenedAt??event.at,event.at);
        item.lastOpenedAt=Math.max(item.lastOpenedAt??event.at,event.at);return;
      }
      let link:EmailActivityLink|undefined;
      if(event.linkId){
        link=item.links.find(link=>link.id===event.linkId);
        if(!link){if(item.links.length>=100)return;link={id:event.linkId,clicks:0,downloadClicks:0,downloads:0,downloadedBytes:0};item.links.push(link);}
      }
      if(event.kind==='click'||event.kind==='download_click'){
        item.clicks++;item.firstClickedAt=Math.min(item.firstClickedAt??event.at,event.at);
        item.lastClickedAt=Math.max(item.lastClickedAt??event.at,event.at);
        if(link){link.clicks++;link.firstClickedAt=Math.min(link.firstClickedAt??event.at,event.at);link.lastClickedAt=Math.max(link.lastClickedAt??event.at,event.at);}
        if(event.kind==='download_click'){
          item.downloadClicks++;
          item.firstDownloadClickedAt=Math.min(item.firstDownloadClickedAt??event.at,event.at);
          item.lastDownloadClickedAt=Math.max(item.lastDownloadClickedAt??event.at,event.at);
          if(link){link.downloadClicks++;link.firstDownloadClickedAt=Math.min(link.firstDownloadClickedAt??event.at,event.at);link.lastDownloadClickedAt=Math.max(link.lastDownloadClickedAt??event.at,event.at);}
        }
      }else if(event.kind==='download'){
        item.downloads++;item.firstDownloadedAt=Math.min(item.firstDownloadedAt??event.at,event.at);
        item.lastDownloadedAt=Math.max(item.lastDownloadedAt??event.at,event.at);
        const bytes=typeof event.bytes==='number'&&Number.isSafeInteger(event.bytes)&&event.bytes>=0?event.bytes:0;
        item.downloadedBytes+=bytes;
        if(link){link.downloads++;link.firstDownloadedAt=Math.min(link.firstDownloadedAt??event.at,event.at);link.lastDownloadedAt=Math.max(link.lastDownloadedAt??event.at,event.at);link.downloadedBytes+=bytes;}
      }
    },
    async get(id){
      const item=messages.get(id);
      return item?{...item,links:item.links.map(link=>({...link}))}:null;
    }
  };
}
