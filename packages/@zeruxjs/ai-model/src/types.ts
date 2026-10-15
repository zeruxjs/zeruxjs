export interface KnowledgeDocument { id: string; text: string; title?: string; metadata?: Record<string,string> }
export interface KnowledgeResult { document: KnowledgeDocument; score: number }
export interface KnowledgeSnapshot { version: 1; documents: KnowledgeDocument[] }
export interface KnowledgeOptions { stopWords?: string[]; maxDocuments?: number; maxDocumentCharacters?: number }
