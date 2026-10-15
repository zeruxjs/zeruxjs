// SQL-compiler compatibility smoke test, NOT a live PostgreSQL/MySQL service test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSqlConnector} from '@zeruxjs/db-sql-core';
const context={connection:{slug:'reporting',connector:'sql',options:{},name:'Reporting'}};
for(const [name,dialect] of [
 ['postgresql',{kind:'pg',quoteIdentifier:s=>`"${s}"`,placeholder:i=>`$${i}`,functions:{},supportsIfNotExistsIndex:true,autoIncrementKeyword:'GENERATED ALWAYS AS IDENTITY'}],
 ['mysql',{kind:'mysql',quoteIdentifier:s=>`\`${s}\``,placeholder:()=>'? ',functions:{},supportsIfNotExistsIndex:false,autoIncrementKeyword:'AUTO_INCREMENT'}]
])test(`${name} compilation supports composite uniqueness and resumable keyset queries`,async()=>{
 const seen=[];const connector=createSqlConnector(dialect,{executor:(sql,params)=>{seen.push({sql,params});return /^SELECT/i.test(sql)?[]:{affectedRows:1};}});
 await connector.execute({op:'createIndex',table:'analytics_events_numeric',name:'analytics_evt_prop_unique',columns:['event_id','property_name'],unique:true,ifNotExists:true},context);
 await connector.execute({op:'select',table:'analytics_events',columns:['id','properties_json'],where:{and:[
  {field:'occurred_at',operator:'gte',value:100},
  {field:'occurred_at',operator:'lte',value:200},
  {field:'id',operator:'gt',value:'cursor-id'}
 ]},orderBy:[{by:'id',direction:'asc'}],limit:101},context);
 assert.match(seen[0].sql,/CREATE UNIQUE INDEX/);
 assert.match(seen[0].sql,/event_id/);
 assert.match(seen[0].sql,/property_name/);
 assert.match(seen[1].sql,/ORDER BY/);
 assert.match(seen[1].sql,/id/);
 assert.deepEqual(seen[1].params.slice(0,3),[100,200,'cursor-id']);
 assert.ok(seen[1].sql.includes(name==='postgresql'?'$3':'?'));
});
