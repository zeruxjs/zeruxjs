import { DocumentKnowledgeBase } from './knowledge-base.js';
import type { KnowledgeOptions, KnowledgeSnapshot } from './types.js';
import { readBoundedSnapshot, writeBoundedSnapshot } from './snapshot-io.js';
export async function saveKnowledgeBase(base: DocumentKnowledgeBase, file: string): Promise<void> { return writeBoundedSnapshot(base.snapshot(), file); }
export async function loadKnowledgeBase(file: string, options?: KnowledgeOptions): Promise<DocumentKnowledgeBase> { const base = new DocumentKnowledgeBase(options); base.restore(await readBoundedSnapshot(file) as KnowledgeSnapshot); return base; }
