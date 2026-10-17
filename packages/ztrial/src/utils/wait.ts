/** Poll a condition until it passes, times out or receives an AbortSignal. */
export async function waitFor<T>(condition:()=>T|Promise<T>,options:{timeoutMs?:number;intervalMs?:number;signal?:AbortSignal}={}):Promise<T>{
 const timeoutMs=options.timeoutMs??1000, interval=options.intervalMs??20;
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(interval)||interval<=0)throw new RangeError('Invalid waitFor timing');
 const deadline=Date.now()+timeoutMs;let lastError:unknown;
 while(Date.now()<deadline){
  if(options.signal?.aborted)throw options.signal.reason??new Error('Aborted');
  try{const value=await condition();if(value)return value;lastError=new Error('Condition not satisfied');}catch(e){lastError=e;}
  const remaining=deadline-Date.now();if(remaining<=0)break;
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(done,Math.min(interval,remaining));
   function done(){options.signal?.removeEventListener('abort',abort);resolve();}
   function abort(){clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(options.signal?.reason??new Error('Aborted'));}
   options.signal?.addEventListener('abort',abort,{once:true});
   if(options.signal?.aborted)abort();
  });
 }
 throw lastError instanceof Error?new Error(`waitFor timed out: ${lastError.message}`,{cause:lastError}):new Error('waitFor timed out');
}
