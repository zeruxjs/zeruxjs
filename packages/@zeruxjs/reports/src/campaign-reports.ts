import type {ChartData,MarketingReportPage} from './types.js';

const deliveryLabels=['notQueued','pending','claimed','sending','smtpAccepted','suppressed','uncertain','rejected','missing'] as const;
const num=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
/** Page-scoped state reporting for the function-based marketing service.
 * The service authorizes the read and MUST bind it to its own tenant. */
export function marketingDeliveryPageCharts(page:MarketingReportPage):{statuses:ChartData;coverage:{scope:'complete'|'page';scanned:number;nextCursor:string|null;done:boolean;disclaimer:string}} {
  if(!page||typeof page.campaignCode!=='string'||!num(page.scanned)||!['complete','page'].includes(page.scope)||
    typeof page.done!=='boolean'||page.nextCursor!==null&&typeof page.nextCursor!=='string'||
    (page.done&&page.nextCursor!==null)||(!page.done&&(!page.nextCursor||page.nextCursor.length>1024))||
    typeof page.disclaimer!=='string'||!page.disclaimer.includes('not confirmed')||
    deliveryLabels.some(k=>!num(page.states?.[k]))||deliveryLabels.reduce((n,k)=>n+page.states[k],0)!==page.scanned||
    (page.scope==='complete'&&(!page.done||page.nextCursor!==null)))throw new TypeError('Invalid marketing delivery page');
  const coverage={scope:page.scope,scanned:page.scanned,nextCursor:page.nextCursor,done:page.done,
    disclaimer:'SMTP accepted is not proof of inbox delivery; this is a recipient page unless scope is complete.'};
  return {statuses:{id:'marketing_delivery_states',title:'Recipient states (SMTP acceptance only)',type:'bar',
    labels:[...deliveryLabels],values:deliveryLabels.map(k=>page.states[k]),total:page.scanned,
    sampledRows:page.scanned,truncated:!page.done,queryMode:page.scope==='complete'?'database':'sampled',
    coverage:page.scope==='complete'?'complete-recipient-scan':'page-of-recipient-states'},coverage};
}

export interface CampaignActivitySnapshot {
  campaignCode:string;from:string;to:string;coverage:'observed-tracking-events-only';
  /** Event totals are not unique recipients or confirmed views; mail clients and blockers affect opens. */
  opens:number;clicks:number;downloadClicks:number;downloads:number;
  /** Unique verified recipients must not be asserted by this interface. */
  uniqueRecipients:null;
}
export function campaignActivityCharts(input:CampaignActivitySnapshot):{activity:ChartData;disclaimer:string}{
  if(!input||typeof input.campaignCode!=='string'||input.coverage!=='observed-tracking-events-only'||
    !/^\d{4}-\d\d-\d\d$/.test(input.from)||!/^\d{4}-\d\d-\d\d$/.test(input.to)||input.from>input.to||
    input.uniqueRecipients!==null||!['opens','clicks','downloadClicks','downloads'].every(k=>num(input[k as keyof CampaignActivitySnapshot])))
    throw new TypeError('Invalid campaign activity snapshot');
  const keys=['opens','clicks','downloadClicks','downloads'] as const;
  const values=keys.map(k=>input[k]);
  return {activity:{id:'marketing_activity',title:'Observed tracking events (not unique people)',type:'bar',labels:[...keys],values,
    total:values.reduce((a,b)=>a+b,0),sampledRows:0,truncated:false,coverage:'observed-tracking-events-only'},
    disclaimer:'Open pixels can be blocked or prefetched; clicks are observed events, not unique users or confirmed deliveries. Tracking must be explicitly enabled and permitted.'};
}
