---
{
  "title": "Retrieval knowledge bases",
  "description": "Retrieve bounded lexical evidence and keep citations separate from generated text.",
  "section": "Packages",
  "order": 26,
  "sources": [
    "packages/@zeruxjs/ai-model/README.md",
    "packages/@zeruxjs/ai-model/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/ai-model"
}
---

## What the package does

This is a local keyword retrieval/chunking layer, not model training, embeddings or a vector database. It ranks source documents, budgets excerpts and can pass evidence to a compatible chat provider.

```ts
import { createKnowledgeBase, chunkDocument, retrieveEvidence } from '@zeruxjs/ai-model';
const kb = createKnowledgeBase({ maxDocuments: 5000, maxDocumentCharacters: 100000 });
kb.addMany(chunkDocument({ id: 'routing', title: 'Routing', text: manualText },
  { maxCharacters: 1200, overlapCharacters: 150 }));
const evidence = retrieveEvidence(kb, 'dynamic routes', { limit: 4, maxTotalCharacters: 4000 });
```

## Identity and persistence

Chunk IDs are deterministic and carry source metadata. Snapshot imports reject duplicate IDs and use bounded atomic filesystem writes with symlink checks. Serialize writers; local snapshots do not coordinate separate machines.

## Grounded answers

createGroundedAssistant returns an answer and structured sources. Validate citations against the retrieved evidence and render evidence separately. Prompt instructions and JSON quoting reduce accidental delimiter confusion but do not establish resistance to prompt injection.

## Access policy and scale

Apply document authorization before populating/searching the knowledge base. Search is lexical and linear in corpus size; it is not semantic reranking. Avoid treating an answer as accurate or authorized simply because sources were attached.
