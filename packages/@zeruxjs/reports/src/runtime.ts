import type {ReportsOptions,ReportsStore} from './types.js';
import {createMemoryReportsStore,validateReports,queryChart} from './model.js';
import {reportDashboard} from './dashboard.js';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export function createReports(options:ReportsOptions){
  if(!options?.analytics||typeof options.authorize!=='function')throw new TypeError('Reports requires analytics and an application authorizer');
  const prefix=options.prefix??'/_reports';if(!/^\/[A-Za-z0-9/_-]+$/.test(prefix)||prefix.includes('//')||prefix.endsWith('/'))throw new TypeError('Invalid reports path');
  if(options.dashboardHost&&!/^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(options.dashboardHost))throw new TypeError('Invalid reports dashboard host');
  const store:ReportsStore=options.store??createMemoryReportsStore();
  const source=options.source??options.analytics;
  const authorized=async(req:Request)=>{
    if(options.dashboardHost&&new URL(req.url).host!==options.dashboardHost)return false;
    try{return await options.authorize(req)===true;}catch{return false;}
  };
  const main=async(req:Request)=>{
    if(!await authorized(req))return new Response('Not found',{status:404});
    return new Response(reportDashboard(prefix),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}});
  };
  const api=async(req:Request)=>{
    if(!await authorized(req))return json({error:'Forbidden'},403);
    if(req.method==='GET')return json(await store.load());
    if(req.method!=='PUT')return json({error:'Method not allowed'},405);
    if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Origin required'},403);
    try{const raw=await req.text();if(Buffer.byteLength(raw)>256*1024)return json({error:'Report document too large'},413);
      const next=validateReports(JSON.parse(raw));if(!await store.save(next,next.version-1))return json({error:'Version conflict'},409);
      return json({ok:true,version:next.version});
    }catch{return json({error:'Invalid report document'},422);}
  };
  const query=async(req:Request)=>{
    if(!await authorized(req))return json({error:'Forbidden'},403);
    if(req.method!=='GET')return json({error:'Method not allowed'},405);
    try{
      const params=new URL(req.url).searchParams;
      const reportId=params.get('report'),pageId=params.get('page'),chartId=params.get('chart');
      const doc=await store.load(),report=doc.reports.find(x=>x.id===reportId),page=report?.pages.find(x=>x.id===pageId),chart=page?.charts.find(x=>x.id===chartId);
      if(!chart)return json({error:'Unknown report chart'},404);
      return json(await queryChart(source,chart,options.maxSourceRows??500,options.site));
    }catch{return json({error:'Report query unavailable'},503);}
  };
  return {store,query:async(reportId:string,pageId:string,chartId:string)=>{
    const doc=await store.load();const chart=doc.reports.find(r=>r.id===reportId)?.pages.find(p=>p.id===pageId)?.charts.find(c=>c.id===chartId);
    if(!chart)throw new Error('Unknown report chart');return queryChart(source,chart,options.maxSourceRows??500,options.site);
  },routes(){return [{pattern:prefix,handler:main},{pattern:prefix+'/api',handler:api},{pattern:prefix+'/query',handler:query}];}};
}
