import {object,string} from '@zeruxjs/validator';
import {createToolExecutor} from '@zeruxjs/ai/tools';
// Host callbacks verify shared sessions and current tenant permissions, never model fields.
export function configureTools({authenticate,authorizeLookup,loadRecord,audit}){
 const executor=createToolExecutor({authenticate,audit,maxConcurrent:4,timeoutMs:3000});
 executor.register('lookup-record',{
  description:'Read a record in the authenticated tenant',
  inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},
  schema:object({id:string()}),sideEffect:false,
  authorize:(context,args)=>authorizeLookup(context.principal,args.id),
  execute:(args,context)=>loadRecord({tenant:context.principal.tenant,id:args.id,signal:context.signal}),
 });
 return executor;
}
// const session=await executor.session(hostVerifiedRequest,requestSignal);
// try { const outcome=await session.execute('lookup-record',{id:'public-id'}); }
// finally {await session.close();} // drain actual handlers, then close executor with generation
