import {test} from 'node:test';import assert from 'node:assert/strict';
import {initializeRuntimeServices} from '../dist/bootstrap/services.js';
import {createCampaignPlanner,createMemoryCampaignStore} from '@zeruxjs/email';
test('campaign dashboard is opt-in, generation-owned, session and scope guarded',async()=>{
 const events=[],store=createMemoryCampaignStore(),planner=createCampaignPlanner({store,now:()=>1000,source:{page:async()=>({contacts:[],done:true,nextCursor:null})},isSubscribed:async()=>true,isSuppressed:async()=>false,ensureMessage:async()=>{},enqueue:async()=>{}});
 const config={email:{accounts:[],campaignDashboard:{planner,authorize:async()=>({role:'operator'}),verifyCsrf:async()=>true,csrfToken:async()=> 'abcdefghijklmnopqrstuvwxyz123456',authorizeCampaign:async()=>true}}};
 const providers={database:async()=>({close:()=>events.push('db')}),cache:async()=>({close:()=>events.push('cache')}),email:async()=>({close:()=>events.push('email')})};
 const scope=await initializeRuntimeServices(config,process.cwd(),providers);
 assert.equal(config.email,undefined);
 const route=scope.httpRoutes().find(x=>x.pattern==='/_email/campaigns');assert.equal(route?.service,'email');
 const response=await route.handler(new Request('https://site.test/_email/campaigns'));
 assert.equal(response.status,200);
 assert.doesNotMatch(await response.text(),/smtpPassword|recipient@example\.test/);
 await scope.close();assert.equal(scope.httpRoutes().length,0);assert.deepEqual(events,['email','cache','db']);
});
test('misconfigured campaign dashboard fails closed on startup',async()=>{
 const config={email:{accounts:[],campaignDashboard:{planner:{},authorize:async()=>true}}};
 const events=[],p={database:async()=>({close:()=>events.push('db')}),cache:async()=>({close:()=>events.push('cache')}),email:async()=>({close:()=>events.push('email')})};
 await assert.rejects(initializeRuntimeServices(config,process.cwd(),p),/requires session auth/);
 assert.deepEqual(events,['cache','db']);
});
test('provider feedback endpoint only mounted when explicitly signed-configured',async()=>{
 const events=[],p={database:async()=>({close:()=>events.push('db')}),cache:async()=>({close:()=>events.push('cache')}),email:async()=>({close:()=>events.push('email')})};
 const feedback={enabled:true,suppression:{recordFeedback:async()=>({blocked:true})},verifySignature:async()=>false,parse:async()=>[]};
 const scope=await initializeRuntimeServices({email:{accounts:[],marketingFeedback:feedback}},process.cwd(),p);
 const route=scope.httpRoutes().find(x=>x.pattern==='/_email/feedback');assert.ok(route);
 const response=await route.handler(new Request('https://example.test/_email/feedback',{method:'POST',headers:{'content-type':'application/json'},body:'[]'}));
 assert.equal(response.status,401);
 await scope.close();assert.equal(scope.httpRoutes().length,0);
});
