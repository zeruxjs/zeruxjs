/** Bounded crash recovery for durable email records. Never retries a possibly submitted message. */
import type {DurableEmailDeliveryRecord,DurableEmailDeliveryStore} from './delivery.js';
import type {CampaignDeliverySource} from './reporting.js';
const campaignIdPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const messageIdPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export function createEmailDeliveryRecoveryScanner(options:{store:DurableEmailDeliveryStore & CampaignDeliverySource;now?:()=>number}){
  if(!options||typeof options.store?.load!=='function'||typeof options.store?.save!=='function'||typeof options.store?.pageCampaign!=='function')throw new TypeError('Durable store with campaign pagination required');
  const clock=options.now??Date.now;
  return async function scan(campaignId:string,{cursor=null,limit=100,dryRun=true}:{cursor?:string|null;limit?:number;dryRun?:boolean}={}){
    if(!campaignIdPattern.test(campaignId)||cursor!==null&&!messageIdPattern.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>200||typeof dryRun!=='boolean')throw new TypeError('Invalid delivery recovery bounds');
    const now=clock();if(!Number.isSafeInteger(now)||now<0)throw new Error('Invalid recovery clock');
    const rows=await options.store.pageCampaign(campaignId,cursor,limit+1);
    if(!Array.isArray(rows)||rows.length>limit+1)throw new Error('Recovery source page invalid');
    const more=rows.length>limit,chosen=rows.slice(0,limit);
    let expiredClaims=0,uncertainSubmissions=0,recoveredClaims=0,markedUncertain=0,contended=0,previous=cursor;
    for(const row of chosen){
      if(row.campaignId!==campaignId||!messageIdPattern.test(row.id)||previous!==null&&row.id<=previous)throw new Error('Out-of-scope recovery page');
      previous=row.id;
      if(row.state!=='claimed'&&row.state!=='sending')continue;
      const current=await options.store.load(row.id);
      if(!current||current.id!==row.id||current.campaignId!==campaignId||current.state!==row.state||
        !current.lease||!Number.isSafeInteger(current.lease.expiresAt)||current.lease.expiresAt>now)continue;
      if(current.state==='claimed')expiredClaims++;else uncertainSubmissions++;
      if(dryRun)continue;
      const next:DurableEmailDeliveryRecord={...current,version:current.version+1,updatedAt:now,
        state:current.state==='claimed'?'pending':'uncertain',lease:null,
        ...(current.state==='sending'?{completedAt:now}:{})};
      if(await options.store.save(row.id,next,current.version)){
        if(next.state==='pending')recoveredClaims++;else markedUncertain++;
      }else contended++;
    }
    return {campaignId,scanned:chosen.length,expiredClaims,uncertainSubmissions,recoveredClaims,markedUncertain,contended,
      dryRun,nextCursor:more?chosen.at(-1)!.id:null,done:!more,automaticSmtpRetry:false as const};
  };
}

/** Repairs the database-only crash window between storing a delivery record and
 * registering its publish intent. A trusted host must validate the campaign is
 * ready/authorized; this scanner never reads recipient addresses or content. */
export function createMissingEmailPublishIntentScanner(options:{
  source:CampaignDeliverySource;
  outbox:{get(id:string):Promise<unknown>;register(id:string,opts:{scheduledAt:number;attempts:number}):Promise<unknown>};
  allowCampaign:(campaignId:string)=>Promise<boolean>|boolean;
}){
  if(!options?.source||typeof options.source.pageCampaign!=='function'||typeof options.outbox?.get!=='function'||
    typeof options.outbox?.register!=='function'||typeof options.allowCampaign!=='function')throw new TypeError('Missing-intent repair requires durable source, outbox and permission gate');
  return async function scan(campaignId:string,{cursor=null,limit=100,scheduledAt,attempts=5,dryRun=true}:{
    cursor?:string|null;limit?:number;scheduledAt:number;attempts?:number;dryRun?:boolean
  }){
    if(!campaignIdPattern.test(campaignId)||cursor!==null&&!messageIdPattern.test(cursor)||
      !Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(scheduledAt)||scheduledAt<0||
      !Number.isSafeInteger(attempts)||attempts<1||attempts>20||typeof dryRun!=='boolean')throw new TypeError('Invalid missing-intent repair bounds');
    if(await options.allowCampaign(campaignId)!==true)throw new Error('Campaign outbox repair forbidden');
    const rows=await options.source.pageCampaign(campaignId,cursor,limit+1);
    if(!Array.isArray(rows)||rows.length>limit+1)throw new Error('Invalid missing-intent campaign page');
    const more=rows.length>limit,items=rows.slice(0,limit);
    let missing=0,registered=0,previous=cursor;
    for(const row of items){
      if(row.campaignId!==campaignId||!messageIdPattern.test(row.id)||previous!==null&&row.id<=previous)throw new Error('Out-of-scope missing-intent page');
      previous=row.id;
      // Only new/pending records are eligible; completed or possibly submitted
      // messages cannot gain a new enqueue by running reconciliation.
      if(row.state!=='pending')continue;
      const present=await options.outbox.get(row.id);
      if(present)continue;
      missing++;
      if(!dryRun){await options.outbox.register(row.id,{scheduledAt,attempts});registered++;}
    }
    return {campaignId,scanned:items.length,missing,registered,dryRun,done:!more,
      nextCursor:more?items.at(-1)!.id:null};
  };
}
