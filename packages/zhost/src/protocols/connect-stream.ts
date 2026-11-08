/** Bounded Connect stream framing (JSON). This is a Connect subset, not gRPC transcoding. */
import type { RpcContext } from './json-rpc.js';
export interface ConnectStreamOptions { maxMessageBytes?: number; maxMessages?: number; maxTotalBytes?: number; signal?: AbortSignal }
const DEFAULT_MAX_MESSAGE = 1024 * 1024;
const DEFAULT_MAX_COUNT = 256;
export function encodeConnectEnvelope(message: unknown, end = false): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > DEFAULT_MAX_MESSAGE) throw new RangeError('Connect stream message too large');
  const frame = Buffer.allocUnsafe(5 + body.length);
  frame[0] = end ? 2 : 0; frame.writeUInt32BE(body.length, 1); body.copy(frame, 5);
  return frame;
}
export async function* readConnectEnvelopes(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options: ConnectStreamOptions = {}): AsyncGenerator<unknown> {
  const max = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE;
  const countLimit = options.maxMessages ?? DEFAULT_MAX_COUNT;
  const totalLimit = options.maxTotalBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(max) || max < 1 || max > 16 * 1024 * 1024 || !Number.isSafeInteger(totalLimit) || totalLimit < 1 || totalLimit > 64 * 1024 * 1024 || !Number.isSafeInteger(countLimit) || countLimit < 1 || countLimit > 10_000) throw new RangeError('Invalid Connect frame limits');
  const header=Buffer.alloc(5);let headerSize=0, body:Buffer|undefined, bodySize=0, flags=0, count=0, total=0, ended=false;
  for await(const input of source){
    options.signal?.throwIfAborted();
    if(!(input instanceof Uint8Array))throw new TypeError('Invalid Connect chunk');
    total+=input.byteLength;if(total>totalLimit)throw new RangeError('Connect request stream too large');
    let offset=0;
    while(offset<input.byteLength){
      options.signal?.throwIfAborted();if(ended)throw new Error('Data after end-stream');
      if(!body){const size=Math.min(5-headerSize,input.byteLength-offset);header.set(input.subarray(offset,offset+size),headerSize);headerSize+=size;offset+=size;if(headerSize<5)continue;
        flags=header[0];const length=header.readUInt32BE(1);if(flags!==0&&flags!==2)throw new Error('Unsupported Connect flags');if(length>max)throw new RangeError('Connect frame too large');body=Buffer.alloc(length);bodySize=0;}
      const size=Math.min(body.length-bodySize,input.byteLength-offset);body.set(input.subarray(offset,offset+size),bodySize);bodySize+=size;offset+=size;
      if(bodySize===body.length){const frame=body;body=undefined;headerSize=0;if(flags===2){ended=true;continue;}if(++count>countLimit)throw new RangeError('Too many Connect messages');
        let message:unknown;try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame));}catch{throw new Error('Invalid Connect JSON frame');}yield message;}
    }
  }
  if(headerSize||body)throw new Error('Truncated Connect frame');
}
export type ConnectStreamHandler = (messages: AsyncIterable<unknown>, context: RpcContext) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
export class ConnectStreamRouter {
  private readonly methods = new Map<string, ConnectStreamHandler>();
  register(service: string, method: string, handler: ConnectStreamHandler): () => void {
    if (!/^[A-Za-z][\w.]{0,127}$/.test(service) || !/^[A-Za-z]\w{0,63}$/.test(method) || typeof handler !== 'function') throw new TypeError('Invalid Connect stream route');
    const path = `/${service}/${method}`;
    if (this.methods.has(path)) throw new Error('Duplicate Connect stream route');
    this.methods.set(path, handler);
    return () => { if (this.methods.get(path) === handler) this.methods.delete(path); };
  }
  paths(): string[] { return [...this.methods.keys()]; }
  has(path: string): boolean { return this.methods.has(path); }
  async call(path: string, messages: AsyncIterable<unknown>, context: RpcContext): Promise<AsyncIterable<unknown>> {
    const handler = this.methods.get(path); if (!handler) throw new Error('Unknown Connect stream route');
    return handler(messages, context);
  }
}
export function createConnectStreamRouter() { return new ConnectStreamRouter(); }
