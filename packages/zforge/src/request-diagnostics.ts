import type { RequestSpan, TracingAdapter } from 'zeruxjs';
import type { DevtoolsSectionDefinition } from './module-registry.js';
import { escapeHtml } from './components/document.js';
export interface DevtoolsRequestRecord {
    applicationId: string;
    generationId: string;
    requestId: string;
    traceId: string;
    spanId: string;
    startedAt: number;
    durationMs: number;
    status: number;
    outcome: RequestSpan['outcome'];
    route: string;
    headers: Record<string, string>;
    bodyPreview: Record<string, string | number | boolean | null>;
    errorCode?: string;
}
export interface RequestDiagnosticsOptions {
    applications: readonly string[];
    routes: readonly string[];
    maxRecordsPerApp?: number;
    maxBytesPerApp?: number;
    retentionMs?: number;
    bodyFields?: readonly string[];
    normalizeApiError?: typeof import('zeruxjs')['normalizeApiError'];
    now?: () => number;
}
const sensitive = /password|secret|token|cookie|authorization|credential|api.?key|session|email|stack|message|code/i;
function label(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
    throw new TypeError('Invalid diagnostics label'); }
export function createRequestDiagnostics(options: RequestDiagnosticsOptions) {
    if (!options || !Array.isArray(options.applications) || !options.applications.length || options.applications.length > 16 || new Set(options.applications).size !== options.applications.length || !Array.isArray(options.routes) || options.routes.length > 64)
        throw new TypeError('Explicit diagnostics apps/routes required');
    options.applications.forEach(label);
    options.routes.forEach(label);
    const apps = new Set(options.applications), routes = new Set([...options.routes, 'other']), fields = [...(options.bodyFields ?? [])];
    if (fields.length > 16 || fields.some(k => typeof k !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(k)))
        throw new TypeError('Invalid preview fields');
    const max = options.maxRecordsPerApp ?? 100, bytes = options.maxBytesPerApp ?? 262144, retention = options.retentionMs ?? 900000, now = options.now ?? Date.now, normalize = options.normalizeApiError;
    if (!Number.isSafeInteger(max) || max < 1 || max > 1000 || !Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 1048576 || !Number.isSafeInteger(retention) || retention < 1 || retention > 3600000 || normalize !== undefined && typeof normalize !== 'function')
        throw new TypeError('Invalid diagnostics budgets');
    const state = new Map<string, {
        generation: string;
        records: DevtoolsRequestRecord[];
        bytes: number;
        dropped: number;
    }>();
    let closed = false;
    const prune = (entry: {
        records: DevtoolsRequestRecord[];
        bytes: number;
    }) => { const cutoff = now() - retention; entry.records = entry.records.filter(r => r.startedAt >= cutoff); entry.bytes = entry.records.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0); };
    const store = {
        activate(app: string, generation: string) { label(generation); if (closed || !apps.has(app))
            throw new Error('Diagnostics app unavailable'); state.set(app, { generation, records: [], bytes: 0, dropped: 0 }); },
        record(span: Readonly<RequestSpan>, preview: {
            route?: string;
            headers?: Record<string, unknown>;
            body?: unknown;
            error?: unknown;
        } = {}) {
            if (closed)
                return false;
            const entry = state.get(span.applicationId);
            if (!entry || span.generationId !== entry.generation)
                return false;
            for (const id of [span.requestId, span.traceId, span.spanId])
                label(id);
            if (!Number.isFinite(span.startedAt) || span.startedAt < 0 || !Number.isFinite(span.durationMs) || span.durationMs < 0 || span.durationMs > 3600000 || !Number.isInteger(span.status) || span.status < 100 || span.status > 599 || !['completed', 'disconnected', 'error'].includes(span.outcome))
                throw new TypeError('Invalid framework request span');
            const headers: Record<string, string> = {};
            for (const name of ['content-type', 'content-length']) {
                const d = preview.headers && Object.getOwnPropertyDescriptor(preview.headers, name);
                if (!d || !('value' in d) || typeof d.value !== 'string')
                    continue;
                if (name === 'content-type') {
                    const mime = d.value.split(';')[0].toLowerCase();
                    if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) && mime.length < 128)
                        headers[name] = mime;
                }
                else if (/^\d{1,10}$/.test(d.value))
                    headers[name] = d.value;
            }
            const bodyPreview: DevtoolsRequestRecord['bodyPreview'] = {};
            if (preview.body && typeof preview.body === 'object' && !Array.isArray(preview.body))
                for (const key of fields) {
                    if (sensitive.test(key))
                        continue;
                    const d = Object.getOwnPropertyDescriptor(preview.body, key);
                    if (!d || !('value' in d))
                        continue;
                    const value = d.value;
                    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
                        bodyPreview[key] = value;
                    else if (typeof value === 'string')
                        bodyPreview[key] = value.slice(0, 128);
                }
            let errorCode: string | undefined;
            if (preview.error !== undefined && normalize) {
                const result = normalize(preview.error);
                const code = result.body.error.code;
                if (typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code))
                    errorCode = code;
            }
            const record: DevtoolsRequestRecord = { applicationId: span.applicationId, generationId: span.generationId, requestId: span.requestId, traceId: span.traceId, spanId: span.spanId, startedAt: span.startedAt, durationMs: span.durationMs, status: span.status, outcome: span.outcome, route: routes.has(preview.route ?? '') ? preview.route! : 'other', headers, bodyPreview, ...(errorCode ? { errorCode } : {}) };
            prune(entry);
            const size = Buffer.byteLength(JSON.stringify(record));
            if (size > bytes) {
                entry.dropped++;
                return false;
            }
            while (entry.records.length >= max || entry.bytes + size > bytes) {
                entry.bytes -= Buffer.byteLength(JSON.stringify(entry.records.shift()));
                entry.dropped++;
            }
            entry.records.push(record);
            entry.bytes += size;
            return true;
        },
        list(app: string, generation: string) { if (closed)
            throw new Error('Diagnostics closed'); const entry = state.get(app); if (!entry || entry.generation !== generation)
            return []; prune(entry); return JSON.parse(JSON.stringify(entry.records)) as DevtoolsRequestRecord[]; },
        adapter(app: string, generation: string): TracingAdapter { store.activate(app, generation); return { export(span, signal) { if (!signal.aborted && span.applicationId === app && span.generationId === generation)
                store.record(span); }, shutdown() { if (state.get(app)?.generation === generation)
                state.delete(app); } }; },
        section(app: string, generation: string): DevtoolsSectionDefinition { return { id: 'requests', title: 'Requests', render(context) { if (context.app.routeName !== app)
                throw new Error('Diagnostics app denied'); return renderRequestDiagnostics(store.list(app, generation)); } }; },
        status(app: string) { const entry = state.get(app); if (entry)
            prune(entry); return { records: entry?.records.length ?? 0, bytes: entry?.bytes ?? 0, dropped: entry?.dropped ?? 0 }; },
        close() { closed = true; state.clear(); }
    };
    return store;
}
export function renderRequestDiagnostics(records: readonly DevtoolsRequestRecord[]): string { return '<section aria-label="Request diagnostics"><table><caption>Retained request observations</caption><thead><tr><th scope="col">Generation</th><th scope="col">Route</th><th scope="col">Status</th><th scope="col">Duration (ms)</th><th scope="col">Preview</th></tr></thead><tbody>' + records.slice(0, 1000).map(r => '<tr><td>' + escapeHtml(r.generationId) + '</td><td>' + escapeHtml(r.route) + '</td><td>' + escapeHtml(String(r.status)) + '</td><td>' + escapeHtml(String(r.durationMs)) + '</td><td><details><summary>Redacted preview</summary><pre>' + escapeHtml(JSON.stringify({ headers: r.headers, body: r.bodyPreview, errorCode: r.errorCode })) + '</pre></details></td></tr>').join('') + '</tbody></table></section>'; }
