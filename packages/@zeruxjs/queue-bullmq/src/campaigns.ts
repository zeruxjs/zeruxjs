import type {JobProcessor,ZeruxQueue,BullJobLike} from './index.js';
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Redis carries only a campaign ID and monotonic page sequence, never contact PII. */
export async function enqueueCampaignPlan(queue:ZeruxQueue,id:string,options:{sequence?:number;delay?:number}={}):Promise<BullJobLike>{
  const sequence=options.sequence??0,delay=options.delay??0;
  if(!idPattern.test(id)||!Number.isSafeInteger(sequence)||sequence<0||sequence>1_000_000_000||!Number.isSafeInteger(delay)||delay<0||delay>365*86_400_000)throw new TypeError('Invalid campaign scheduling request');
  return queue.add('campaign.plan',{campaignId:id,sequence},{jobId:`campaign-${id}-${sequence}`,delay,attempts:5,backoff:{type:'exponential',delay:5000}});
}
/** Explicit planner allowlist; retrying this processor cannot double enqueue emails with stable job IDs. */
export function createCampaignPlanningProcessor(options:{
  planners:Record<string,{runOnce:(id:string,owner:string)=>Promise<{status:string;processed:number}>}>;
  /** Schedule next page; if status is scheduled, respect the campaign's future sendAt. */
  scheduleNext:(id:string,sequence:number,status:'running'|'scheduled')=>Promise<unknown>;
}):JobProcessor{
  if(!options||typeof options.scheduleNext!=='function')throw new TypeError('A campaign scheduling callback is required');
  return async(job)=>{
    if(job.name!=='campaign.plan'||typeof job.data?.campaignId!=='string'||!idPattern.test(job.data.campaignId)||
      !Number.isSafeInteger(job.data.sequence)||Number(job.data.sequence)<0||Number(job.data.sequence)>1_000_000_000)throw new TypeError('Invalid campaign job');
    const id=job.data.campaignId,sequence=Number(job.data.sequence),planner=options.planners[id];
    if(!Object.hasOwn(options.planners,id)||!planner)throw new Error('Unknown campaign planner');
    const result=await planner.runOnce(id,`bullmq-${sequence}`);
    if(result.status==='running'||result.status==='scheduled')await options.scheduleNext(id,sequence+1,result.status);
    // Scheduled (early) and busy results should retry via the application's scheduler.
    if(result.status==='busy')throw Object.assign(new Error('Campaign planner currently leased'),{code:'CAMPAIGN_BUSY'});
    return {status:result.status,processed:result.processed};
  };
}
