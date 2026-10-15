/** In-memory bounded public-object cache: never cache private or encrypted objects. */
export class FileByteCache {
  private readonly entries = new Map<string,{data:Uint8Array,expires:number}>();
  private bytes = 0; private hits = 0; private misses = 0;
  constructor(private readonly maxEntries = 64, private readonly maxBytes = 8*1024*1024, private readonly ttlMs = 15000) {
    if (![maxEntries,maxBytes,ttlMs].every(n => Number.isSafeInteger(n) && n > 0)) throw new RangeError('Invalid file cache limits');
  }
  get(key:string): Uint8Array | undefined {
    const hit=this.entries.get(key);
    if (!hit || Date.now()>hit.expires) { this.misses++; if(hit) this.delete(key); return undefined; }
    this.hits++; this.entries.delete(key); this.entries.set(key,hit); return hit.data.slice();
  }
  set(key:string,data:Uint8Array):void {
    if(data.byteLength>this.maxBytes)return;
    this.delete(key);this.entries.set(key,{data:data.slice(),expires:Date.now()+this.ttlMs});this.bytes+=data.byteLength;
    while(this.entries.size>this.maxEntries || this.bytes>this.maxBytes) this.delete(this.entries.keys().next().value!);
  }
  delete(key:string):void { const entry=this.entries.get(key);if(entry){this.bytes-=entry.data.byteLength;this.entries.delete(key);} }
  deletePrefix(prefix:string):void {for(const key of [...this.entries.keys()])if(key.startsWith(prefix))this.delete(key);}
  clear():void{this.entries.clear();this.bytes=0;}
  stats(){return {entries:this.entries.size,bytes:this.bytes,hits:this.hits,misses:this.misses};}
}
