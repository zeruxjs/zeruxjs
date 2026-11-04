import { snapshotToolJson } from './tools.js';
export interface ApprovedToolOperation {
    operationId: string;
    method: string;
    path: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
/** Read trusted in-memory OpenAPI only. No fetching, refs, binding or execution. */
export function approvedOpenApiToolOperations(document: unknown, policy: {
    trusted: true;
    approve(operation: Readonly<ApprovedToolOperation>): boolean;
}): readonly ApprovedToolOperation[] {
    if (policy?.trusted !== true || typeof policy.approve !== 'function')
        throw new TypeError('Trusted source and explicit operation approval required');
    const doc = snapshotToolJson(document, 1048576) as any;
    if (!doc || !['3.0.3', '3.1.0'].includes(doc.openapi) || !doc.paths || typeof doc.paths !== 'object' || Array.isArray(doc.paths))
        throw new TypeError('Unsupported OpenAPI document');
    const approved: ApprovedToolOperation[] = [], names = new Set<string>();
    let count = 0;
    for (const [path, item] of Object.entries(doc.paths)) {
        if (!path.startsWith('/') || path.length > 512 || /[\x00-\x20\\?#]/.test(path) || path.includes('..') || /[{}]/.test(path) || !item || typeof item !== 'object' || Array.isArray(item))
            throw new TypeError('Invalid operation path');
        if(Object.hasOwn(item,'$ref')||Object.hasOwn(item,'parameters'))throw new TypeError('Unsupported path parameters/reference');
        for (const [verb, raw] of Object.entries(item)) {
            if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(verb))
                continue;
            if (++count > 128)
                throw new TypeError('OpenAPI operation budget exceeded');
            const value = raw as any;
            if (!value || typeof value.operationId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value.operationId) || names.has(value.operationId) || value.parameters!==undefined || value.$ref || value.requestBody?.$ref || value.requestBody!==undefined&&!value.requestBody?.content?.['application/json']?.schema)
                throw new TypeError('Unsupported operation');
            names.add(value.operationId);
            const schema = value.requestBody?.content?.['application/json']?.schema ?? { type: 'object', properties: {} };
            const serialized = JSON.stringify(schema);
            if (/"\$(?:ref|dynamicRef)"\s*:/.test(serialized) || schema.type !== 'object')
                throw new TypeError('Unsupported operation schema');
            const description = value.summary ?? value.description ?? value.operationId;
            if (typeof description !== 'string' || description.length > 1024)
                throw new TypeError('Invalid operation description');
            const operation = { operationId: value.operationId, method: verb.toUpperCase(), path, description, inputSchema: snapshotToolJson(schema, 65536) as Record<string, unknown> };
            const decision:unknown = policy.approve(Object.freeze({ ...operation, inputSchema: snapshotToolJson(schema, 65536) as Record<string, unknown> }));
            if(decision&&typeof(decision as PromiseLike<unknown>).then==='function')void Promise.resolve(decision).catch(()=>{});
            if (decision !== true && decision !== false)
                throw new TypeError('Approval must be synchronous');
            if (decision)
                approved.push(operation);
        }
    }
    return approved;
}
