import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCacheHelper,createIORedisCacheHelper} from '../dist/index.js';
import {createCacheManagerWithHelper} from '@zeruxjs/cache';

test('LIVE Redis: two tenants share a standalone Redis without global namespace flushing', {skip:!process.env.CACHE_REDIS_URL,timeout:20_000},async()=>{
 const client=await createCacheHelper({driver:'ioredis',url:process.env.CACHE_REDIS_URL});
 const base=`s75_${randomUUID().replaceAll('-','').slice(0,16)}`;
 const a=createCacheManagerWithHelper(client,{prefix:base+'_a'});
 const b=createCacheManagerWithHelper(client,{prefix:base+'_b'});
 try{
   await a.setMany({first:1,second:2});await b.set('first',3);
   await a.clear();assert.equal(await a.get('first'),undefined);assert.equal(await b.get('first'),3);
 }finally{await b.delete('first');await client.close();}
});
test('LIVE Redis Cluster: scan every master and clear only the tenant prefix', {skip:!process.env.CACHE_REDIS_CLUSTER_NODES,timeout:30_000},async()=>{
 const {default:IORedis}=await import('ioredis');
 const nodes=process.env.CACHE_REDIS_CLUSTER_NODES.split(',').map(endpoint=>{
   const [host,port]=endpoint.split(':');return {host,port:Number(port)};
 });
 const redis=new IORedis.Cluster(nodes,{redisOptions:{password:process.env.CACHE_REDIS_CLUSTER_PASSWORD||undefined}});
 const adapter=createIORedisCacheHelper(redis,{ownClient:true});
 const base=`s75_${randomUUID().replaceAll('-','').slice(0,16)}`;
 const a=createCacheManagerWithHelper(adapter,{prefix:base+'_a'});
 const b=createCacheManagerWithHelper(adapter,{prefix:base+'_b'});
 try{
   for(let n=0;n<35;n++)await a.set(`key${n}`,n);
   await b.set('safe',true);
   await a.clear();
   for(let n=0;n<35;n++)assert.equal(await a.get(`key${n}`),undefined);
   assert.equal(await b.get('safe'),true);
 }finally{try{await b.delete('safe');}finally{await adapter.close();}}
});
