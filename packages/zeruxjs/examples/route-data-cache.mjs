import {createMemoryCacheHelper,createCacheManagerWithHelper} from '@zeruxjs/cache';
import {createRouteDataCache} from 'zeruxjs/route-data-cache';
const cache=createCacheManagerWithHelper(createMemoryCacheHelper());
const data=createRouteDataCache({application:'shop',cache});
try {
 // Obtain tenant/principal from the host's verified session, never query parameters.
 const key={route:'catalog',path:'/catalog',locale:'en',scope:{tenant:'demo',principal:'verified-owner'}};
 const result=await data.load(key,{freshMs:1000,staleMs:2000,tags:['catalog']},async({signal})=>{
  signal.throwIfAborted();return {products:[]};
 });
 // A route returns result.response(); existing ETag handling remains authoritative.
 console.log(result.state,result.value);
 // Invoke only after authorized persistence commits (e.g. an actions invalidate callback).
 data.invalidate({tenant:'demo',tag:'catalog'});
} finally {await data.close();await cache.close();}
