import type {createExperimentEvaluator, ExperimentEvaluatorOptions} from 'ztrial/experiments';
import type {DevtoolsEndpointContext, DevtoolsModuleEndpoint, TransportDevtoolsModule} from './module-endpoints.js';

export interface ExperimentInspectionAudit {
    action: 'inspect' | 'preview' | 'test';
    appId: string; generationId: string; moduleEpoch: number; actor: string;
    experiment: string; at: number; expiresAt?: number; variant?: string; test?: string;
    phase: 'authorized' | 'completed' | 'failed';
}
export interface ExperimentInspectionOptions {
    mode: 'development' | 'production';
    createEvaluator: typeof createExperimentEvaluator;
    /** Private host configuration. Store/recording/assignment overrides are deliberately excluded. */
    evaluation: Pick<ExperimentEvaluatorOptions, 'catalog' | 'tenant' | 'tenantSalt' | 'resolveContext'>;
    endpoint: Pick<Extract<DevtoolsModuleEndpoint,{kind:'mcp'}>, 'bind' | 'publicOrigin' | 'allowedOrigins' | 'limits'>;
    authorize(action: ExperimentInspectionAudit['action'], context: DevtoolsEndpointContext): boolean | Promise<boolean>;
    verifyCsrf(request: DevtoolsEndpointContext['request'], context: DevtoolsEndpointContext): boolean | Promise<boolean>;
    audit(event: Readonly<ExperimentInspectionAudit>): void | Promise<void>;
    tests?: Readonly<Record<string, (context: DevtoolsEndpointContext) => boolean | Promise<boolean>>>;
}
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(v);
/** Development-only consumer of ztrial's evaluator. No production assignment mutation API. */
export function createExperimentInspectionModule(options: ExperimentInspectionOptions): TransportDevtoolsModule {
    if (options.mode !== 'development') throw new Error('Experiment inspection requires development mode');
    if (typeof options.createEvaluator !== 'function' || typeof options.authorize !== 'function' || typeof options.verifyCsrf !== 'function' || typeof options.audit !== 'function') throw new TypeError('Explicit experiment inspection policies required');
    const config = options.evaluation;
    if (!config || Object.keys(config).some(k=>!['catalog','tenant','tenantSalt','resolveContext'].includes(k))) throw new TypeError('Inspection cannot configure persistence, recording or assignment overrides');
    const tests = new Map(Object.entries(options.tests ?? {}));
    if (tests.size > 16 || [...tests].some(([k,v])=>!token(k)||typeof v!=='function')) throw new TypeError('Invalid trusted test registry');
    const origins = [...options.endpoint.allowedOrigins];
    if (!origins.length || origins.some(value=>{try{return new URL(value).origin!==value;}catch{return true;}})) throw new TypeError('Explicit inspection origins required');
    // Delay ownership acquisition until module setup, so an unused definition owns no secret copy.
    let evaluator: ReturnType<typeof createExperimentEvaluator> | undefined;
    let disposed = false;
    const check = (ctx: DevtoolsEndpointContext) => {
        ctx.signal.throwIfAborted();
        if (disposed || !evaluator || Date.now() >= ctx.deadline || Date.now() >= ctx.principal.expiresAt) throw new Error('Inspection inactive');
    };
    const emit = async (action: ExperimentInspectionAudit['action'], phase: ExperimentInspectionAudit['phase'], args: Record<string,unknown>, ctx:DevtoolsEndpointContext, expiresAt?:number) => {
        await options.audit(Object.freeze({action,phase,appId:ctx.appId,generationId:ctx.generationId,moduleEpoch:ctx.moduleEpoch,actor:ctx.principal.subject,experiment:String(args.experiment),at:Date.now(),...(expiresAt?{expiresAt}:{}),...(action==='preview'?{variant:String(args.variant)}:{}),...(action==='test'?{test:String(args.test)}:{})}));
    };
    const tool = (action:ExperimentInspectionAudit['action']) => ({
        name: 'experiment.'+action,
        inputSchema: {type:'object', properties:{experiment:{type:'string'}, ...(action==='preview'?{variant:{type:'string'},ttlMs:{type:'integer'}}:{}),...(action==='test'?{test:{type:'string'}}:{})},required:['experiment',...(action==='preview'?['variant','ttlMs']:[]),...(action==='test'?['test']:[])],additionalProperties:false},
        authorize: async (_args:Record<string,unknown>,ctx:DevtoolsEndpointContext) => {
            check(ctx);
            if (await options.authorize(action,ctx)!==true) return false;
            if(action!=='inspect') {
                if(ctx.request.method!=='POST'||!origins.includes(String(ctx.request.headers.origin??'')))return false;
                if(await options.verifyCsrf(ctx.request,ctx)!==true)return false;
            }
            check(ctx); return true;
        },
        handle: async (args:Record<string,unknown>,ctx:DevtoolsEndpointContext) => {
            check(ctx);
            const keys=['experiment',...(action==='preview'?['variant','ttlMs']:[]),...(action==='test'?['test']:[])];
            if(Object.keys(args).some(k=>!keys.includes(k))||!token(args.experiment))throw new TypeError('Invalid inspection arguments');
            const definition=evaluator!.describe().definitions.filter(d=>d.id===args.experiment).at(-1);
            if(!definition)throw new Error('Unknown experiment');
            if(action==='preview'&&(!definition.variants.some(v=>v.name===args.variant)||!Number.isSafeInteger(args.ttlMs)||Number(args.ttlMs)<1||Number(args.ttlMs)>60000))throw new TypeError('Invalid preview');
            if(action==='test'&&(!token(args.test)||!tests.has(args.test)))throw new TypeError('Unknown test');
            const expiresAt=action==='preview'?Math.min(Date.now()+Number(args.ttlMs),ctx.principal.expiresAt,ctx.deadline):undefined;
            await emit(action,'authorized',args,ctx,expiresAt); check(ctx);
            try {
                const decision=await evaluator!.evaluate(args.experiment,ctx.principal,{signal:ctx.signal}); check(ctx);
                if(decision.status==='denied'){await emit(action,'completed',args,ctx);return {status:'denied',reason:decision.reason};}
                // Rebuild public data; do not spread resolver/context/test output into the response.
                const result={status:action==='preview'?'preview':'assigned',experiment:decision.experiment,version:decision.version,variant:action==='preview'?String(args.variant):decision.variant,reason:decision.explanation.reason,algorithm:decision.explanation.algorithm,variants:definition.variants.map(v=>({name:v.name,weight:v.weight})),previewOnly:action==='preview',...(expiresAt?{expiresAt}:{}),...(action==='test'?{passed:await tests.get(String(args.test))!(ctx)}:{})};
                if(action==='test'&&typeof result.passed!=='boolean')throw new TypeError('Invalid test outcome');
                check(ctx); await emit(action,'completed',args,ctx,expiresAt); check(ctx);return result;
            } catch(error) {await emit(action,'failed',args,ctx,expiresAt);throw new Error('Experiment inspection failed',{cause:error});}
        },
    });
    return {id:'experiments',title:'Experiments',endpoints:[{...options.endpoint,allowedOrigins:origins,id:'controls',kind:'mcp',tools:[tool('inspect'),tool('preview'),tool('test')],publicFields:['status','reason','experiment','version','variant','algorithm','variants','name','weight','previewOnly','expiresAt','passed']}],async setup({onDispose}) {
        if(disposed||evaluator)throw new Error('Create a fresh inspection module for each load');
        evaluator=options.createEvaluator({catalog:config.catalog,tenant:config.tenant,tenantSalt:config.tenantSalt,resolveContext:config.resolveContext,maxConcurrent:4,timeoutMs:Math.min(options.endpoint.limits.timeoutMs,60000)});
        onDispose(async()=>{disposed=true;await evaluator!.close();tests.clear();});
    }};
}
