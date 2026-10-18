# Retrieval knowledge bases

Retrieve bounded lexical evidence and keep citations separate from generated text.


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


## Public entry points

Manifest reference for `@zeruxjs/ai-model@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/ai-model

A local dependency-light **retrieval knowledge base**, not a model-training or embedding runtime. It offers keyword-based ranking, chunking, source-addressable excerpts, context budgeting, snapshots and optional filesystem persistence.

```ts
import {createKnowledgeBase, chunkDocument, retrieveEvidence, createGroundedAssistant,
        saveKnowledgeBase, loadKnowledgeBase} from '@zeruxjs/ai-model';
import {createOpenAICompatibleProvider} from '@zeruxjs/ai';

const kb = createKnowledgeBase({maxDocuments:5000,maxDocumentCharacters:100_000});
kb.addMany(chunkDocument({id:'guide/routing',title:'Routing guide',text:manualText},
  {maxCharacters:1200,overlapCharacters:150}));
const sources = retrieveEvidence(kb,'How does routing work?',{limit:4,maxTotalCharacters:4000});
const assistant = createGroundedAssistant(kb, provider); // any compatible chat provider
const {answer,sources:citations} = await assistant.answer('How does routing work?');
await saveKnowledgeBase(kb,'./private/knowledge.json');
const restored = await loadKnowledgeBase('./private/knowledge.json');
```

Chunk IDs are deterministic (`originalId#0`, etc.). Chunk metadata contains `sourceId` and chunk number. The assistant returns citations as structured source data, allowing consumers to display evidence separately from generated text. `createGroundedPrompt` and `DocumentKnowledgeBase.search()` remain available. Document and snapshot sizes are bounded; snapshots use atomic replacement and reject symlink targets.

Search is lexical, linear in the number and length of documents; no embeddings, cross-encoder reranking or remote model training is implied. Grounded instructions are **not** a security boundary against prompt injection, nor a guarantee that answers are accurate; validate generated citations against the returned evidence and apply your own authorization filters before populating the knowledge base.

Section 80: snapshot imports reject duplicate IDs without replacing existing documents. IDs reject controls and queries are bounded. Evidence excerpts are serialized as untrusted JSON strings inside the prompt. This reduces delimiter spoofing but does not guarantee resistance to prompt injection, nor does the package train or fine-tune a model.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/ai-model/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/ai-model/README.md)
- [packages/@zeruxjs/ai-model/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/ai-model/package.json)
