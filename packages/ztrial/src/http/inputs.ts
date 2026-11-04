/** Deterministic test inputs only; never use this sequence as cryptographic entropy. */
export function createSequenceRandom(values: readonly number[]): () => number {
  if (!Array.isArray(values) || !values.length || values.length > 1024 || values.some(value=>!Number.isFinite(value)||value<0||value>=1)) throw new TypeError('Invalid random sequence');
  const snapshot=[...values];let index=0;
  return ()=>{if(index===snapshot.length)throw new Error('Test random sequence exhausted');return snapshot[index++];};
}
/** Manual fixture clock, independent of Date/timers. advance wakes due sleeps in order. */
export function createTestClock(initial=0) {
  if(!Number.isSafeInteger(initial)||initial<0)throw new TypeError('Invalid test clock');
  let time=initial,closed=false;
  const pending=new Set<{due:number;resolve:()=>void;reject:(error:unknown)=>void;unlink:()=>void}>();
  return {
    now:()=>time,
    sleep(ms:number,signal:AbortSignal):Promise<void>{
      if(!(signal instanceof AbortSignal)||!Number.isSafeInteger(ms)||ms<0||ms>600000||!Number.isSafeInteger(time+ms))throw new RangeError('Invalid test delay');
      if(closed)return Promise.reject(new Error('Test clock closed'));
      if(signal.aborted)return Promise.reject(signal.reason);
      if(!ms)return Promise.resolve();
      if(pending.size>=128)return Promise.reject(new Error('Test clock waiter limit'));
      return new Promise((resolve,reject)=>{
        const abort=()=>{pending.delete(entry);entry.unlink();reject(signal.reason);};
        const entry={due:time+ms,resolve,reject,unlink:()=>signal.removeEventListener('abort',abort)};
        pending.add(entry);signal.addEventListener('abort',abort,{once:true});
      });
    },
    advance(ms:number){
      if(closed||!Number.isSafeInteger(ms)||ms<0||!Number.isSafeInteger(time+ms))throw new RangeError('Invalid clock advance');
      time+=ms;
      for(const entry of [...pending].sort((a,b)=>a.due-b.due))if(entry.due<=time){pending.delete(entry);entry.unlink();entry.resolve();}
    },
    close(){if(closed)return;closed=true;for(const entry of pending){entry.unlink();entry.reject(new Error('Test clock closed'));}pending.clear();},
    pending:()=>pending.size
  };
}
