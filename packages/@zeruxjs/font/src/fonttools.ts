import {spawn} from 'node:child_process';
export type FontBinaryFormat='woff2'|'woff'|'truetype'|'opentype';
export interface FontAxis {tag:string;min:number;default:number;max:number}
export interface FontInspection {toolVersion:string;axes:FontAxis[];codePoints:number[]}
export interface FontToolsTool {
 readonly name:'fonttools';
 inspect(bytes:Uint8Array,format:FontBinaryFormat,signal?:AbortSignal):Promise<FontInspection>;
 subset(bytes:Uint8Array,format:FontBinaryFormat,codePoints:readonly number[],signal?:AbortSignal):Promise<Uint8Array>;
}
const program=String.raw`
import sys,json,base64,io,resource
resource.setrlimit(resource.RLIMIT_AS,(536870912,536870912))
resource.setrlimit(resource.RLIMIT_CPU,(30,30))
resource.setrlimit(resource.RLIMIT_FSIZE,(0,0))
from fontTools.ttLib import TTFont
from fontTools import subset
import fontTools
if int(fontTools.__version__.split('.')[0]) < 4: raise RuntimeError('version')
v=json.load(sys.stdin)
f=TTFont(io.BytesIO(base64.b64decode(v['data'],validate=True)),recalcTimestamp=False)
if v['mode']=='subset':
 o=subset.Options();o.recalc_timestamp=False
 s=subset.Subsetter(options=o);s.populate(unicodes=v['codePoints']);s.subset(f)
 out=io.BytesIO();f.save(out,reorderTables=True)
 print(json.dumps({'data':base64.b64encode(out.getvalue()).decode('ascii')}))
else:
 axes=[{'tag':a.axisTag,'min':a.minValue,'default':a.defaultValue,'max':a.maxValue} for a in f['fvar'].axes] if 'fvar' in f else []
 cmap=f.getBestCmap() or {}
 covered=[cp for cp,name in cmap.items() if name!='.notdef' and f.getGlyphID(name)!=0]
 print(json.dumps({'toolVersion':fontTools.__version__,'axes':axes,'codePoints':sorted(covered)}))
f.close()
`;
/** Explicit POSIX Python/FontTools integration. No shell or caller-supplied tool arguments. */
export function createFontToolsTool(options:{executable?:string;timeoutMs?:number}={}):FontToolsTool {
 const executable=options.executable??'python3',timeout=options.timeoutMs??15000;
 // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
 if(typeof executable!=='string'||!executable||executable.length>2048||/[\x00-\x1f\x7f]/.test(executable)||!Number.isSafeInteger(timeout)||timeout<1||timeout>30000)throw new TypeError('Invalid FontTools configuration');
 async function call(bytes:Uint8Array,mode:'inspect'|'subset',codePoints:readonly number[],signal?:AbortSignal){
  if(!(bytes instanceof Uint8Array)||bytes.length>16*1024*1024||codePoints.length>65536||codePoints.some(cp=>!Number.isSafeInteger(cp)||cp<0||cp>0x10ffff||cp>=0xd800&&cp<=0xdfff))throw new RangeError('FontTools input limit');
  if(signal?.aborted)throw new Error('FontTools cancelled');
  return new Promise<any>((resolve,reject)=>{
   const child=spawn(executable,['-I','-B','-c',program],{stdio:['pipe','pipe','pipe'],shell:false,env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C.UTF-8'}});let output=0,failed=false;const chunks:Buffer[]=[];
   const kill=()=>{failed=true;child.kill('SIGKILL');};const timer=setTimeout(kill,timeout);signal?.addEventListener('abort',kill,{once:true});
   child.stdout.on('data',(chunk:Buffer)=>{output+=chunk.length;if(output>40*1024*1024)kill();else chunks.push(chunk);});child.stderr.on('data',()=>{/* Never emit font data, paths or tool stderr. */});
   child.stdin.on('error',()=>{failed=true;});child.once('error',()=>{failed=true;});
   child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',kill);if(failed||code!==0){reject(new Error('FontTools unavailable, cancelled or font processing failed'));return;}try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('Invalid FontTools output'));}});
   child.stdin.end(JSON.stringify({mode,data:Buffer.from(bytes).toString('base64'),codePoints}));
  });
 }
 return Object.freeze({name:'fonttools' as const,async inspect(bytes:Uint8Array,format:FontBinaryFormat,signal?:AbortSignal){void format;const result=await call(bytes,'inspect',[],signal);if(typeof result.toolVersion!=='string'||!Array.isArray(result.axes)||result.axes.length>64||!Array.isArray(result.codePoints)||result.codePoints.length>200000)throw new Error('FontTools inspection limit');return result as FontInspection;},async subset(bytes:Uint8Array,format:FontBinaryFormat,codePoints:readonly number[],signal?:AbortSignal){void format;const result=await call(bytes,'subset',codePoints,signal);if(typeof result.data!=='string'||result.data.length>24*1024*1024)throw new Error('FontTools subset limit');return new Uint8Array(Buffer.from(result.data,'base64'));}});
}
