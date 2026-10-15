import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCampaignAnalyticsReporter} from '../dist/index.js';
test('marketing operations emit only identifiers, never recipient data or activity tracking flags',async()=>{
 const calls=[];const reporter=createCampaignAnalyticsReporter({track:async e=>calls.push(e)},'my-store');
 await reporter({campaignId:'campaign-123',kind:'queued',count:3,at:1234});
 assert.deepEqual(calls,[{name:'email.campaign.queued',source:'email',site:'my-store',properties:{campaignId:'campaign-123',count:3}}]);
 await createCampaignAnalyticsReporter({track:async()=>{throw Error('Analytics down')}},'my-store')({campaignId:'abc',kind:'completed',at:1234,count:1});
});
