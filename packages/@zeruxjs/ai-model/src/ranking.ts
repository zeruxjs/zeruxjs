import type { KnowledgeDocument, KnowledgeResult } from './types.js';
import { tokenize } from './tokenizer.js';
export interface KnowledgeRankingOptions {
    weights?: {
        title?: number;
        text?: number;
        symbols?: number;
    };
    normalization?: 'NFC' | 'NFKC' | 'none';
    foldDiacritics?: boolean;
    cjkBigrams?: boolean;
}
export function rankingSettings(options: KnowledgeRankingOptions = {}) {if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['weights','normalization','foldDiacritics','cjkBigrams'].includes(k))||options.weights!==undefined&&(!options.weights||typeof options.weights!=='object'||Array.isArray(options.weights)||Object.keys(options.weights).some(k=>!['title','text','symbols'].includes(k))))throw new TypeError('Invalid ranking fields'); const weights = { title: options.weights?.title ?? 8, text: options.weights?.text ?? 1, symbols: options.weights?.symbols ?? 4 }; for (const v of Object.values(weights))
    if (!Number.isFinite(v) || v < 0 || v > 100)
        throw new TypeError('Invalid evidence field weight'); if (!Object.values(weights).some(v => v > 0) || options.normalization !== undefined && !['NFC', 'NFKC', 'none'].includes(options.normalization) || options.foldDiacritics !== undefined && typeof options.foldDiacritics !== 'boolean' || options.cjkBigrams !== undefined && typeof options.cjkBigrams !== 'boolean')
    throw new TypeError('Invalid ranking settings'); return { weights, normalization: options.normalization ?? 'NFKC', foldDiacritics: options.foldDiacritics ?? false, cjkBigrams: options.cjkBigrams ?? true }; }
export function rankingTokens(text: string, settings: ReturnType<typeof rankingSettings>): string[] { let value = settings.normalization === 'none' ? text : text.normalize(settings.normalization); value = value.toLowerCase(); if (settings.foldDiacritics)
    value = value.normalize('NFD').replace(/\p{M}+/gu, ''); const result = tokenize(value); if (settings.cjkBigrams)
    for (const part of value.match(/\p{Script=Han}+/gu) ?? []) {
        const chars = Array.from(part);
        for (let i = 0; i + 1 < chars.length; i++)
            result.push(chars[i] + chars[i + 1]);
    } return result; }
/** Opt-in field-weighted saturating TF/IDF, not a cross-engine score contract. */
export function rankKnowledgeDocuments(documents: readonly KnowledgeDocument[], query: string, limit: number, options: KnowledgeRankingOptions, stop: ReadonlySet<string> = new Set()): KnowledgeResult[] {
    if(!Array.isArray(documents)||documents.length>10000||typeof query!=='string'||query.length>10000||!Number.isSafeInteger(limit)||limit<0||limit>1000)throw new TypeError('Invalid ranking input');
    const settings = rankingSettings(options), terms = [...new Set(rankingTokens(query, settings).filter(t => !stop.has(t)))];
    if (terms.length > 128)
        throw new RangeError('Evidence query complexity exceeded');
    if (!terms.length)
        return [];
    const rows = documents.map(doc => ({ doc, title: rankingTokens(doc.title ?? '', settings), text: rankingTokens(doc.text, settings), symbols: rankingTokens(doc.metadata?.symbols ?? '', settings) }));
    const df = new Map<string, number>();
    let total = 0;
    for (const row of rows) {
        total += row.text.length;
        const words = new Set([...row.title, ...row.text, ...row.symbols]);
        for (const term of terms)
            if (words.has(term))
                df.set(term, (df.get(term) ?? 0) + 1);
    }
    const avg = Math.max(1, total / Math.max(1, rows.length));
    const results = rows.map(row => { let score = 0; for (const field of ['title', 'text', 'symbols'] as const) {
        const counts = new Map<string, number>();
        for (const word of row[field])
            counts.set(word, (counts.get(word) ?? 0) + 1);
        for (const term of terms) {
            const tf = counts.get(term) ?? 0;
            if (tf) {
                const idf = Math.log(1 + (rows.length - (df.get(term) ?? 0) + .5) / ((df.get(term) ?? 0) + .5));
                const norm = field === 'text' ? 1.2 * (.25 + .75 * row.text.length / avg) : 1;
                score += settings.weights[field] * idf * tf / (tf + norm);
            }
        }
    } return { document: row.doc, score }; });
    return results.filter(r => r.score > 0).sort((a, b) => b.score - a.score || (a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0)).slice(0, limit);
}
