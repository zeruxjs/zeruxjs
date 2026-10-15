import type {ChartData} from './types.js';

/** Minimal, PII-free interface produced by @zeruxjs/queue's campaign reporter. */
export interface CampaignDeliverySnapshot {
  campaignId:string;complete:boolean;scanned:number;
  counts:Record<'pending'|'claimed'|'sending'|'sent'|'suppressed'|'uncertain'|'rejected',number>;
  days:Array<{day:string;sent:number;suppressed:number;uncertain:number;other:number}>;
}
/**
 * Project durable delivery statuses into existing Reports chart data.
 * Never confuse SMTP sent state with inbox delivery, or an incomplete scan with a total.
 * Requires application-level tenant authorization before obtaining a snapshot.
 */
export function campaignDeliveryCharts(report:CampaignDeliverySnapshot):{statuses:ChartData;sentByDay:ChartData}{
  const labels=['pending','claimed','sending','sent','suppressed','uncertain','rejected'] as const;
  if(!report||!Number.isSafeInteger(report.scanned)||report.scanned<0||typeof report.complete!=='boolean'||
    labels.some(key=>!Number.isSafeInteger(report.counts?.[key])||report.counts[key]<0)||
    labels.reduce((total,key)=>total+report.counts[key],0)!==report.scanned||!Array.isArray(report.days)||report.days.length>5000)throw new TypeError('Invalid campaign snapshot');
  const ordered=[...report.days].sort((a,b)=>a.day.localeCompare(b.day));
  if(ordered.some((d,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||
    (i>0&&d.day===ordered[i-1].day)||!['sent','suppressed','uncertain','other'].every(key=>Number.isSafeInteger(d[key as keyof typeof d])&&Number(d[key as keyof typeof d])>=0)))throw new TypeError('Invalid delivery timeline');
  if(ordered.reduce((sum,d)=>sum+d.sent+d.suppressed+d.uncertain+d.other,0)!==report.scanned)throw new TypeError('Delivery report timeline mismatch');
  const shared={sampledRows:report.scanned,truncated:!report.complete};
  return {
    statuses:{...shared,id:'campaign_delivery_status',title:'Durable SMTP delivery states',type:'bar',labels:[...labels],values:labels.map(key=>report.counts[key]),total:report.scanned},
    sentByDay:{...shared,id:'campaign_sent_by_day',title:'SMTP accepted by UTC day',type:'line',labels:ordered.map(d=>d.day),values:ordered.map(d=>d.sent),total:report.counts.sent}
  };
}

/** Exact SQL/Mongo grouped state totals. Provider outcomes are event counts only. */
export interface CampaignPerformanceSnapshot {
  campaignId:string;mode:'database';complete:true;total:number;
  counts:CampaignDeliverySnapshot['counts'];
  dailyCoverage:'not-computed';activityCoverage:'not-computed';
  smtpAcceptedPercent:number|null;
  provider:null|{events:number;coverage:'reported-events-only';counts:Record<'delivered'|'deferred'|'hard-bounce'|'soft-bounce'|'complaint',number>};
}
/** No false timeline or engagement graphs are fabricated from unavailable source data. */
export function campaignPerformanceCharts(report:CampaignPerformanceSnapshot):{statuses:ChartData;providerOutcomes:ChartData|null}{
  const labels=['pending','claimed','sending','sent','suppressed','uncertain','rejected'] as const;
  if(!report||report.mode!=='database'||report.complete!==true||report.dailyCoverage!=='not-computed'||report.activityCoverage!=='not-computed'||
    !Number.isSafeInteger(report.total)||report.total<0||labels.some(label=>!Number.isSafeInteger(report.counts?.[label])||report.counts[label]<0)||
    labels.reduce((sum,k)=>sum+report.counts[k],0)!==report.total||
    (report.smtpAcceptedPercent!==null&&(!Number.isFinite(report.smtpAcceptedPercent)||report.smtpAcceptedPercent<0||report.smtpAcceptedPercent>100)))throw new TypeError('Invalid native campaign performance');
  const statuses:ChartData={id:'campaign_all_time_statuses',title:'All-time durable SMTP delivery states',type:'bar',
    labels:[...labels],values:labels.map(label=>report.counts[label]),total:report.total,sampledRows:report.total,truncated:false,queryMode:'database'};
  if(report.provider===null)return {statuses,providerOutcomes:null};
  const providerLabels=['delivered','deferred','hard-bounce','soft-bounce','complaint'] as const;
  const provider=report.provider;
  if(provider.coverage!=='reported-events-only'||!Number.isSafeInteger(provider.events)||provider.events<0||
    providerLabels.some(label=>!Number.isSafeInteger(provider.counts?.[label])||provider.counts[label]<0)||
    providerLabels.reduce((sum,k)=>sum+provider.counts[k],0)!==provider.events)throw new TypeError('Invalid provider event summary');
  return {statuses,providerOutcomes:{id:'campaign_provider_reported',title:'Authenticated provider notifications (reported events only)',type:'bar',
    labels:[...providerLabels],values:providerLabels.map(label=>provider.counts[label]),total:provider.events,
    sampledRows:provider.events,truncated:false,queryMode:'database'}};
}

/** Database-native daily trends. Counts reflect the last durable state update,
 * not an immutable event log or inbox delivery. Provider results are notifications,
 * which can include multiple events for a single message. */
export interface CampaignDailyTrendsSnapshot {
  campaignId:string;from:string;to:string;mode:'database';complete:true;
  deliveryCoverage:'last-state-update-day';providerCoverage:'reported-events-only'|'not-configured';snapshotConsistent:false;
  total:number;providerEvents:number|null;
  days:Array<{day:string;counts:CampaignDeliverySnapshot['counts'];total:number;
    provider:Record<'delivered'|'deferred'|'hard-bounce'|'soft-bounce'|'complaint',number>|null;
    providerEvents:number|null}>;
}
export function campaignDailyTrendsCharts(report:CampaignDailyTrendsSnapshot):{smtpSentByDay:ChartData;providerDeliveredByDay:ChartData|null}{
  if(!report||report.mode!=='database'||report.complete!==true||report.snapshotConsistent!==false||
    report.deliveryCoverage!=='last-state-update-day'||!['reported-events-only','not-configured'].includes(report.providerCoverage)||
    !/^\d{4}-\d\d-\d\d$/.test(report.from)||!/^\d{4}-\d\d-\d\d$/.test(report.to)||
    !Array.isArray(report.days)||report.days.length>366||!Number.isSafeInteger(report.total)||report.total<0)
    throw new TypeError('Invalid campaign daily trends');
  const states=['pending','claimed','sending','sent','suppressed','uncertain','rejected'] as const;
  const kinds=['delivered','deferred','hard-bounce','soft-bounce','complaint'] as const;
  const sum=(values:number[])=>values.reduce((n,v)=>n+v,0);
  let previous='';
  for(const day of report.days){
    if(!day||!/^\d{4}-\d\d-\d\d$/.test(day.day)||day.day<=previous||day.day<report.from||day.day>report.to||
      !Number.isSafeInteger(day.total)||day.total<0||states.some(key=>!Number.isSafeInteger(day.counts?.[key])||day.counts[key]<0)||
      sum(states.map(k=>day.counts[k]))!==day.total)throw new TypeError('Invalid campaign daily state counts');
    previous=day.day;
    if(report.providerCoverage==='reported-events-only'){
      if(!day.provider||kinds.some(k=>!Number.isSafeInteger(day.provider?.[k])||day.provider![k]<0)||
        !Number.isSafeInteger(day.providerEvents)||sum(kinds.map(k=>day.provider![k]))!==day.providerEvents)
        throw new TypeError('Invalid daily provider notifications');
    }else if(day.provider!==null||day.providerEvents!==null)throw new TypeError('Unexpected provider trend data');
  }
  if(sum(report.days.map(d=>d.total))!==report.total||
    (report.providerCoverage==='reported-events-only'?sum(report.days.map(d=>d.providerEvents!))!==report.providerEvents:report.providerEvents!==null))
    throw new TypeError('Inconsistent daily campaign trend totals');
  const common={labels:report.days.map(d=>d.day),truncated:false,queryMode:'database' as const};
  const smtpSentByDay:ChartData={...common,id:'campaign_daily_last_update_sent',title:'Current SMTP-sent state by last update UTC day',type:'line',
    values:report.days.map(d=>d.counts.sent),total:sum(report.days.map(d=>d.counts.sent)),sampledRows:report.total};
  const providerDeliveredByDay:ChartData|null=report.providerCoverage==='reported-events-only'?{
    ...common,id:'campaign_daily_provider_delivered',title:'Provider-reported delivery notifications by UTC day',type:'line',
    values:report.days.map(d=>d.provider!.delivered),total:sum(report.days.map(d=>d.provider!.delivered)),sampledRows:report.providerEvents!}:null;
  return {smtpSentByDay,providerDeliveredByDay};
}

/** Section 60 immutable transition history (as observed and journaled).
 * Counts are transitions into a state, not current delivery states or unique recipients. */
export interface CampaignTransitionHistorySnapshot {
  campaignId:string;from:string;to:string;coverage:'recorded-transitions-only';snapshotConsistent:false;
  days:Array<{day:string;counts:CampaignDeliverySnapshot['counts'];total:number}>;
}
export function campaignTransitionHistoryCharts(report:CampaignTransitionHistorySnapshot):{sentTransitions:ChartData;uncertainTransitions:ChartData}{
  if(!report||report.coverage!=='recorded-transitions-only'||report.snapshotConsistent!==false||
    !/^\d{4}-\d{2}-\d{2}$/.test(report.from)||!/^\d{4}-\d{2}-\d{2}$/.test(report.to)||
    !Array.isArray(report.days)||report.days.length>366)throw new TypeError('Invalid campaign transition history');
  const statuses=['pending','claimed','sending','sent','suppressed','uncertain','rejected'] as const;
  let previous='';let total=0;
  for(const day of report.days){
    if(!day||!/\d{4}-\d{2}-\d{2}/.test(day.day)||day.day<=previous||day.day<report.from||day.day>report.to||
      !Number.isSafeInteger(day.total)||day.total<0||statuses.some(key=>!Number.isSafeInteger(day.counts?.[key])||day.counts[key]<0)||
      statuses.reduce((sum,key)=>sum+day.counts[key],0)!==day.total)throw new TypeError('Invalid historical transition day');
    total+=day.total;previous=day.day;
  }
  if(!Number.isSafeInteger(total))throw new TypeError('Transition count overflow');
  const shared={labels:report.days.map(d=>d.day),queryMode:'database' as const,sampledRows:total,truncated:false};
  const chart=(key:'sent'|'uncertain',name:string):ChartData=>({...shared,id:`campaign_history_${key}`,title:name,type:'line',
    values:report.days.map(d=>d.counts[key]),total:report.days.reduce((sum,day)=>sum+day.counts[key],0)});
  return {sentTransitions:chart('sent','Observed transitions into SMTP-sent state'),
    uncertainTransitions:chart('uncertain','Observed uncertain SMTP transitions')};
}
