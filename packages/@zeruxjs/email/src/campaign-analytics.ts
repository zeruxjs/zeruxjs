/** Optional adapter to @zeruxjs/analytics. Operational counters are best-effort;
 * committed campaign state remains the system of record. Recipient activity tracking
 * is a separate, per-email choice and is never toggled by this adapter. */
export function createCampaignAnalyticsReporter(analytics:{track(event:{name:string;source:'email';site:string;properties:Record<string,string|number>}):Promise<unknown>},site:string){
  if(typeof analytics?.track!=='function'||typeof site!=='string'||!site.trim()||site.length>200)throw new TypeError('Invalid campaign analytics adapter');
  return async(event:{campaignId:string;kind:'queued'|'scheduled'|'completed'|'cancelled';at:number;count:number})=>{
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(event.campaignId)||!['queued','scheduled','completed','cancelled'].includes(event.kind))return;
    try{await analytics.track({name:`email.campaign.${event.kind}`,source:'email',site,properties:{campaignId:event.campaignId,count:event.count}});}catch{/* telemetry may never block mail planning */}
  };
}
