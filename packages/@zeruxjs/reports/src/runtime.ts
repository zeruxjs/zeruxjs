import {createHash} from 'node:crypto';
import type {ReportsOptions,ReportsStore,AnalyticsReportSource,ReportAction,ChartDefinition,ChartData} from './types.js';
import {createMemoryReportsStore,validateReports,queryChart,isReportId} from './model.js';
import {campaignPerformanceCharts,campaignDailyTrendsCharts} from './campaign-delivery.js';
import type {CampaignPerformanceSnapshot,CampaignDailyTrendsSnapshot} from './campaign-delivery.js';
import {marketingDeliveryPageCharts,campaignActivityCharts} from './campaign-reports.js';
import type {CampaignActivitySnapshot} from './campaign-reports.js';
import {reportDashboard} from './dashboard.js';

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','vary':'Cookie, Authorization'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const error=(message:string,status:number)=>json({error:message},status);
const validSite=(site:unknown):site is string=>typeof site==='string'&&site.length>0&&site.length<=200&&!/[\x00-\x1f]/.test(site);
const date=(s:string|null)=>{
  if(!s||!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new TypeError('Invalid UTC date');
  return Date.parse(s+'T00:00:00Z');
};
function utcWindow(params:URLSearchParams,required=false){
  const since=params.get('since'),until=params.get('until');
  if(!since&&!until&&!required)return {};
  if(!since||!until||!/^\d+$/.test(since)||!/^\d+$/.test(until))throw new TypeError('Both numeric since and until must be supplied');
  const a=Number(since),b=Number(until);
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<a||b-a>366*86400000)throw new RangeError('Date range must be bounded to 366 days');
  return {since:a,until:b};
}
function campaignDays(params:URLSearchParams){
  const from=params.get('from'),to=params.get('to');const first=date(from),last=date(to);
  if(last<first||last-first>365*86400000)throw new RangeError('Campaign date range exceeds 366 days');
  return {from:from!,to:to!};
}
const sha=(source:string)=>"'sha256-"+createHash('sha256').update(source).digest('base64')+"'";
const escapeCsv=(item:unknown)=>{
  const value=String(item??'');
  // Spreadsheet formulas must remain literal data, even when preceded by whitespace.
  const safe=/^[\s\uFEFF]*[=+@\-\t\r]/.test(value)?"'"+value:value;
  return '"'+safe.replace(/"/g,'""')+'"';
};
const csv=(items:ChartData[])=>[
  ['chartId','title','dimension','value','total','mode','coverage','truncated'].map(escapeCsv).join(','),
  ...items.flatMap(item=>item.labels.map((label,index)=>[item.id,item.title,label,item.values[index],item.total,item.queryMode??'unknown',item.coverage??item.numericCoverage??'',item.truncated].map(escapeCsv).join(',')))
].join('\r\n')+'\r\n';
function exported(data:unknown,format:string,filename:string){
  const payload=format==='csv'?csv(Array.isArray(data)?data as ChartData[]:[data as ChartData]):JSON.stringify(data);
  if(Buffer.byteLength(payload)>256*1024)return error('Export exceeds 256 KiB limit; narrow your selection',413);
  return new Response(payload,{headers:{...headers,'content-type':format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8',
    'content-disposition':`attachment; filename="${filename}.${format}"`}});
}
export function createReports(options:ReportsOptions){
  if(!options?.analytics||typeof options.authorize!=='function')throw new TypeError('Reports requires analytics and an application authorizer');
  if(options.resolveScope&&typeof options.resolveScope!=='function')throw new TypeError('Invalid tenant resolver');
  if(options.site!==undefined&&!validSite(options.site))throw new TypeError('Invalid enforced site');
  const prefix=options.prefix??'/_reports';if(!/^\/[A-Za-z0-9/_-]+$/.test(prefix)||prefix.includes('//')||prefix.endsWith('/'))throw new TypeError('Invalid reports path');
  if(options.dashboardHost&&!/^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(options.dashboardHost))throw new TypeError('Invalid reports dashboard host');
  if(options.maxSourceRows!==undefined&&(!Number.isSafeInteger(options.maxSourceRows)||options.maxSourceRows<1||options.maxSourceRows>500))throw new RangeError('Invalid report row cap');
  const store:ReportsStore=options.store??createMemoryReportsStore();
  const source=options.source??options.analytics;
  const authorized=async(req:Request,action:ReportAction,id?:string)=>{
    if(options.dashboardHost&&new URL(req.url).host!==options.dashboardHost)return false;
    try{return await options.authorize(req,action,id)===true;}catch{return false;}
  };
  const scoped=async(req:Request):Promise<{site:string|undefined;store:ReportsStore;source:AnalyticsReportSource}>=>{
    if(!options.resolveScope)return {site:options.site,store,source};
    const scope=await options.resolveScope(req);
    if(!scope||!validSite(scope.site)||!scope.store||typeof scope.store.load!=='function'||typeof scope.store.save!=='function'||
      !scope.source&&typeof source.events!=='function'||scope.source&&typeof scope.source.events!=='function'||
      options.site!==undefined&&scope.site!==options.site)throw new Error('Untrusted reports tenant scope');
    return {site:scope.site,store:scope.store,source:scope.source??source};
  };
  const main=async(req:Request)=>{
    if(!await authorized(req,'read'))return new Response('Not found',{status:404});
    const html=reportDashboard(prefix);
    const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]??'';
    const style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]??'';
    return new Response(html,{headers:{...headers,'content-type':'text/html; charset=utf-8',
      'content-security-policy':`default-src 'none'; script-src ${sha(script)}; style-src ${sha(style)}; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`}});
  };
  const api=async(req:Request)=>{
    const action:ReportAction=req.method==='PUT'?'edit':'read';
    if(!await authorized(req,action))return error('Forbidden',403);
    if(!['GET','PUT'].includes(req.method))return error('Method not allowed',405);
    let tenantStore:ReportsStore;
    try{tenantStore=(await scoped(req)).store;}catch{return error('Report storage unavailable',503);}
    if(req.method==='GET'){try{return json(validateReports(await tenantStore.load()));}catch{return error('Report storage unavailable',503);}}
    if(req.headers.get('origin')!==new URL(req.url).origin)return error('Origin required',403);
    let next;
    try{const raw=await req.text();if(Buffer.byteLength(raw)>256*1024)return error('Report document too large',413);
      next=validateReports(JSON.parse(raw));}catch{return error('Invalid report document',422);}
    try{if(!await tenantStore.save(next,next.version-1))return error('Version conflict',409);
      return json({ok:true,version:next.version});}catch{return error('Report storage unavailable',503);}
  };
  const catalog=async(req:Request)=>{
    if(!await authorized(req,'read'))return error('Forbidden',403);
    if(req.method!=='GET')return error('Method not allowed',405);
    try{
      const params=new URL(req.url).searchParams;
      const rawLimit=params.get('limit')??'20',rawCursor=params.get('cursor');
      if(!/^\d{1,2}$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>50) return error('Invalid page size',422);
      const doc=validateReports(await (await scoped(req)).store.load());
      let offset=0;
      if(rawCursor){const match=/^(\d+):(\d{1,3})$/.exec(rawCursor);if(!match)return error('Invalid page cursor',422);
        if(Number(match[1])!==doc.version)return error('Report catalog changed; reload from first page',409);
        offset=Number(match[2]);if(offset>doc.reports.length)return error('Invalid page cursor',422);
      }
      const take=Number(rawLimit),items=doc.reports.slice(offset,offset+take).map(r=>({id:r.id,name:r.name,description:r.description??'',pages:r.pages.length}));
      return json({version:doc.version,items,nextCursor:offset+take<doc.reports.length?`${doc.version}:${offset+take}`:null,total:doc.reports.length});
    }catch{return error('Report catalog unavailable',503);}
  };
  const locate=(doc:ReturnType<typeof validateReports>,params:URLSearchParams)=>{
    const reportId=params.get('report'),pageId=params.get('page'),chartId=params.get('chart');
    const report=doc.reports.find(r=>r.id===reportId),page=report?.pages.find(p=>p.id===pageId);
    if(!page)return null;
    if(chartId&&!page.charts.some(c=>c.id===chartId))return null;
    return {report,page,charts:chartId?page.charts.filter(c=>c.id===chartId):page.charts};
  };
  const charts=async(req:Request,kind:'query'|'export')=>{
    if(req.method!=='GET')return error('Method not allowed',405);
    const params=new URL(req.url).searchParams;
    if(kind==='export'&&!['json','csv'].includes(params.get('format')??'json'))return error('Invalid export format',422);
    let window:ReturnType<typeof utcWindow>;
    try{window=utcWindow(params);}catch{return error('Invalid or excessive UTC date window',422);}
    try{
      const scope=await scoped(req),doc=validateReports(await scope.store.load()),target=locate(doc,params);
      if(!target)return error('Unknown report page or chart',404);
      if(kind==='query'&&target.charts.length!==1)return error('Choose exactly one chart',422);
      if(target.charts.length>12)return error('Page export is limited to 12 charts',422);
      // 366-day native grouping issues one COUNT per UTC day; bound multi-chart amplification.
      let estimatedQueries=0;
      for(const chart of target.charts){const merged={...chart,...window};
        if(merged.groupBy==='day'&&merged.since!==undefined&&merged.until!==undefined){
          const from=Date.UTC(new Date(merged.since).getUTCFullYear(),new Date(merged.since).getUTCMonth(),new Date(merged.since).getUTCDate());
          const to=Date.UTC(new Date(merged.until).getUTCFullYear(),new Date(merged.until).getUTCMonth(),new Date(merged.until).getUTCDate());
          estimatedQueries+=2+Math.floor((to-from)/86400000);
        }else estimatedQueries++;
      }
      if(estimatedQueries>500)return error('Export exceeds query budget; narrow the UTC date range or select one chart',422);
      for(const chart of target.charts)if(chart.groupBy.startsWith('property:')&&!await authorized(req,'sensitive',chart.id))return error('Sensitive chart permission required',403);
      const results:ChartData[]=[];
      for(const chart of target.charts){const merged:ChartDefinition={...chart,...window};
        results.push(await queryChart(scope.source,merged,options.maxSourceRows??500,scope.site));}
      if(kind==='query')return json(results[0]);
      const format=params.get('format')??'json';
      return exported(format==='csv'?results:{report:target.report!.id,page:target.page.id,
        generatedAt:new Date().toISOString(),site:scope.site??null,charts:results,
        disclaimer:'Coverage is chart-specific. SMTP acceptance and provider notifications do not confirm inbox delivery.'},
        format,`reports-${target.report!.id}-${target.page.id}`);
    }catch{return error('Report query unavailable',503);}
  };
  const query=async(req:Request)=>{
    if(!await authorized(req,'read'))return error('Forbidden',403);
    return charts(req,'query');
  };
  const exportRoute=async(req:Request)=>{
    if(!await authorized(req,'export'))return error('Forbidden',403);
    return charts(req,'export');
  };
  const campaign=async(req:Request)=>{
    if(req.method!=='GET')return error('Method not allowed',405);
    if(!options.campaigns)return error('Campaign reporting unavailable',404);
    const params=new URL(req.url).searchParams;
    const code=params.get('code');if(!isReportId(code))return error('Invalid campaign code',422);
    if(!await authorized(req,'campaign',code))return error('Forbidden',403);
    const kind=params.get('kind')??'delivery';
    if(!['delivery','performance','daily','activity'].includes(kind))return error('Invalid campaign report kind',422);
    let days:{from:string;to:string}|undefined;
    if(kind==='daily'||kind==='activity')try{days=campaignDays(params);}catch{return error('Invalid or excessive campaign UTC date window',422);}
    const cursor=params.get('cursor');const rawLimit=params.get('limit')??'200';
    if(kind==='delivery'&&(!/^\d{1,3}$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>200||cursor!==null&&(cursor.length>1024||!cursor)))return error('Invalid campaign recipient page',422);
    try{
      // Scope resolution and the campaign service independently enforce the same application-selected tenant.
      const site=(await scoped(req)).site;
      if(kind==='delivery'){
        const page=await options.campaigns.report(code,{cursor,limit:Number(rawLimit),site});
        if(page.campaignCode!==code)throw new Error('Campaign mismatch');
        return json({kind,code,...marketingDeliveryPageCharts(page)});
      }
      if(kind==='performance'){
        if(!options.campaigns.performance)return error('Native campaign performance not configured',404);
        const snapshot=await options.campaigns.performance(code,site) as CampaignPerformanceSnapshot;
        if(snapshot.campaignId!==code)throw new Error('Campaign mismatch');
        return json({kind,code,charts:campaignPerformanceCharts(snapshot),coverage:{smtp:'durable-delivery-states',provider:'reported-events-only'}});
      }
      if(kind==='daily'){
        if(!options.campaigns.dailyTrends)return error('Daily campaign trends not configured',404);
        const snapshot=await options.campaigns.dailyTrends(code,days!.from,days!.to,site) as CampaignDailyTrendsSnapshot;
        if(snapshot.campaignId!==code||snapshot.from!==days!.from||snapshot.to!==days!.to)throw new Error('Campaign mismatch');
        return json({kind,code,charts:campaignDailyTrendsCharts(snapshot),coverage:{delivery:'last-state-update-day',snapshotConsistent:false}});
      }
      if(!options.campaigns.activity)return error('Campaign tracking reports not configured',404);
      const activity=await options.campaigns.activity(code,days!.from,days!.to,site) as CampaignActivitySnapshot;
      if(activity.campaignCode!==code||activity.from!==days!.from||activity.to!==days!.to)throw new Error('Campaign mismatch');
      return json({kind,code,...campaignActivityCharts(activity)});
    }catch{return error('Campaign report unavailable',503);}
  };
  return {store,query:async(reportId:string,pageId:string,chartId:string)=>{
    if(options.resolveScope)throw new Error('Tenant-scoped reports require an authorized HTTP request');
    const doc=validateReports(await store.load());const chart=doc.reports.find(r=>r.id===reportId)?.pages.find(p=>p.id===pageId)?.charts.find(c=>c.id===chartId);
    if(!chart)throw new Error('Unknown report chart');return queryChart(source,chart,options.maxSourceRows??500,options.site);
  },routes(){return [{pattern:prefix,handler:main},{pattern:prefix+'/api',handler:api},
    {pattern:prefix+'/catalog',handler:catalog},{pattern:prefix+'/query',handler:query},
    {pattern:prefix+'/export',handler:exportRoute},{pattern:prefix+'/campaign',handler:campaign}];}};
}
