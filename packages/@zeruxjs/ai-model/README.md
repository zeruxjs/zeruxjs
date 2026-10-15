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
