import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMarketingCampaignDashboard,createMarketingCampaignService} from '../dist/index.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
async function setup(){const connector=await createConnector({filename:':memory:',driver:'node'});
 const db=Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,args=>connector.execute({op,...args},ctx)]));
 return {db,close:()=>connector.disconnect()};}
const delivery=()=>{const rows=new Map();return {async create(r){if(rows.has(r.id))return false;rows.set(r.id,r);return true;},async load(id){return rows.get(id)??null;}};};
const origin='https://marketing.example.com';
const request=(method,path,data,headers={})=>new Request(origin+path,{method,headers:{...headers,...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
test('marketing dashboard requires auth, CSRF, origins, scoping and restricts exposed data',async()=>{
 const {db,close}=await setup();try{
  const service=createMarketingCampaignService({db,delivery:delivery(),queue:{async add(){}},now:()=>1000});
  const code=await service.create({name:'Campaign',subject:'Hello {{name}}',content:'<p>{{password}}</p>',account:'private_smtp',
    recipients:[{name:'Sample',email:'sample@example.com',data:{password:'top-secret'}}],autoEnqueue:false});
  let active=true,scoped=true,csrf=true,allowList=false;
  const dashboard=createMarketingCampaignDashboard({service,
    authorize:()=>active?{role:'admin'}:null,authorizeCampaign:(_p,id)=>scoped&&id===code,authorizeCreate:()=>true,
    authorizeList:()=>allowList,verifyCsrf:()=>csrf,csrfToken:()=>('t'.repeat(32))});
  assert.equal((await dashboard.handle(request('GET','/_email/marketing/api?code='+code))).status,200);
  assert.equal((await dashboard.handle(request('GET','/_email/marketing/api?code='+code+'&view=recipients'))).status,200);
  const r=await dashboard.handle(request('GET','/_email/marketing/api?code='+code+'&view=recipients'));
  const raw=await r.text();assert.match(raw,/sample@example.com/);assert.doesNotMatch(raw,/top-secret|password/);
  const preview=await (await dashboard.handle(request('GET','/_email/marketing/api?code='+code+'&view=previews'))).json();
  assert.match(preview.items[0].html,/top-secret/);assert.ok(!('messageId' in preview.items[0]));
  const summary=await (await dashboard.handle(request('GET','/_email/marketing/api?code='+code+'&view=overview'))).text();
  assert.doesNotMatch(summary,/sample@example.com|top-secret|private_smtp/);
  assert.equal((await dashboard.handle(request('GET','/_email/marketing/api?view=list'))).status,403);
  allowList=true;assert.equal((await dashboard.handle(request('GET','/_email/marketing/api?view=list'))).status,200);
  active=false;assert.equal((await dashboard.handle(request('GET','/_email/marketing'))).status,403);
  active=true;scoped=false;assert.equal((await dashboard.handle(request('GET','/_email/marketing/api?code='+code))).status,403);
  scoped=true;csrf=false;
  const post=request('POST','/_email/marketing/api',{code,action:'pause'},{origin});
  assert.equal((await dashboard.handle(post)).status,403);
  csrf=true;
  assert.equal((await dashboard.handle(request('POST','/_email/marketing/api',{code,action:'pause'},{origin:'https://attacker.invalid'}))).status,403);
  assert.equal((await dashboard.handle(request('POST','/_email/marketing/api',{code,action:'pause'},{origin}))).status,200);
  assert.equal((await dashboard.handle(request('POST','/_email/marketing/api',{code,action:'resume'},{origin}))).status,200);
  assert.equal((await dashboard.handle(request('POST','/_email/marketing/api',{code,action:'cancel'},{origin}))).status,200);
 }finally{await close();}
});
