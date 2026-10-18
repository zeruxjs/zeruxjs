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
const manualText = 'A dynamic route uses a bracketed directory name such as [slug].';
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

## Install and select the integration

```sh
npm install @zeruxjs/ai-model@0.0.3
```

There is no automatic `ai-model` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Build a knowledge base from documents the requesting principal is allowed to read. Use stable source IDs, deterministic chunks and an explicit overlap/context budget. Keyword ranking scans document text; it is not vector retrieval, training or fine-tuning. Pass the returned evidence separately from generated text so a UI can inspect source IDs instead of treating model prose as verified citations.

## TypeScript: inputs, results and ownership

```ts
import { createKnowledgeBase } from '@zeruxjs/ai-model';

type Inputs = Parameters<typeof createKnowledgeBase>;
type Result = Awaited<ReturnType<typeof createKnowledgeBase>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createKnowledgeBase>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Keep persistence paths private and serialize competing file writers. Size bounds and atomic replacement prevent some corruption modes but do not provide a multi-process transaction. Rebuild or reload the appropriate tenant snapshot rather than populating a shared index with unauthorized content. A grounded prompt is still vulnerable to untrusted instructions in evidence; application tools and privileged actions need independent authorization.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### KnowledgeOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `stopWords` | `string[]` | Yes |
| `maxDocuments` | `number` | Yes |
| `maxDocumentCharacters` | `number` | Yes |

### ChunkingOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxCharacters` | `number` | Yes |
| `overlapCharacters` | `number` | Yes |
| `maxChunks` | `number` | Yes |

### EvidenceOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `limit` | `number` | Yes |
| `maxExcerptCharacters` | `number` | Yes |
| `maxTotalCharacters` | `number` | Yes |
