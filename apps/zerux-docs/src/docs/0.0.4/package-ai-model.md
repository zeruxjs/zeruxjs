---
{
  "title": "Retrieval knowledge bases",
  "description": "Retrieve bounded lexical evidence and keep citations separate from generated text.",
  "section": "Packages",
  "order": 26,
  "sources": [
    "packages/@zeruxjs/ai-model/README.md",
    "packages/@zeruxjs/ai-model/package.json",
    "packages/@zeruxjs/ai-model/src/corpus.ts",
    "packages/@zeruxjs/ai-model/examples/corpus.mjs",
    "packages/@zeruxjs/ai-model/src/evidence.ts",
    "packages/@zeruxjs/ai-model/examples/evidence.mjs"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/ai-model"
}
---

## What the package does

This is a local keyword retrieval/chunking layer. It does not train models, generate embeddings or own a vector database. It ranks source documents, budgets excerpts and can pass evidence to a compatible chat provider; the separate evidence API can explicitly borrow a host-qualified embedding ranker.

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

Apply document authorization before populating/searching the knowledge base. Default search is lexical and linear in corpus size; it is not semantic reranking. Avoid treating an answer as accurate or authorized simply because sources were attached.

## Install and select the integration

```sh
npm install @zeruxjs/ai-model@0.0.4
```

There is no automatic `ai-model` startup service in `zerux.config.js` for this package. Import its public APIs and create the server-side object in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Build a knowledge base from documents the requesting principal is allowed to read. Use stable source IDs, deterministic chunks and an explicit overlap/context budget. Default keyword ranking scans document text; it is not vector retrieval, training or fine-tuning. Pass the returned evidence separately from generated text so a UI can inspect source IDs instead of treating model prose as verified citations.

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

| Field                   | Accepted type/value | Optional |
| ----------------------- | ------------------- | -------- |
| `stopWords`             | `string[]`          | Yes      |
| `maxDocuments`          | `number`            | Yes      |
| `maxDocumentCharacters` | `number`            | Yes      |

### ChunkingOptions

| Field               | Accepted type/value | Optional |
| ------------------- | ------------------- | -------- |
| `maxCharacters`     | `number`            | Yes      |
| `overlapCharacters` | `number`            | Yes      |
| `maxChunks`         | `number`            | Yes      |

### EvidenceOptions

| Field                  | Accepted type/value | Optional |
| ---------------------- | ------------------- | -------- |
| `limit`                | `number`            | Yes      |
| `maxExcerptCharacters` | `number`            | Yes      |
| `maxTotalCharacters`   | `number`            | Yes      |

## Reproducible public corpus

The optional `@zeruxjs/ai-model/corpus` entry reads an explicit allowlist of public
manifests, matching public export declarations and authored docs. It checks Git
ignore rules and excludes notes/private/generated sources. No source module is
evaluated and no provider call starts automatically.

Sources/chunks retain paths, content/indexed-text hashes, package/version and
public-module/symbol labels. Current manifest hashes gate cache reuse; changed
sources replace chunks and removed sources disappear. Candidate validation and
atomic private snapshots preserve the prior file on failure.

An explicit reader requires a verified tenant/subject and reauthorizes each source
before lexical retrieval. Evidence remains untrusted quoted data, not permission
to run instructions or tools. Authored docs are labeled claims, not proof of tested
features. Read the package README and corpus example for source/snapshot budgets,
Git requirements, stable-checkout assumptions and host privacy/authorization duties.

## Ranked evidence with explicit insufficiency

The optional evidence entry adds configured field-weighted lexical ranking and a
host-injected authorized-candidate embedding capability. Authorization precedes
ranking/packing and asynchronous permission changes reject the entire result.
Remote embedding requires explicit host approval; no SDK or upload is enabled by
default.

Full serialized prompt budgets use a declared token estimator or conservative
UTF-8 fallback. Duplicate/overlapping chunks are removed with retained source
spans. Results distinguish insufficient evidence, coverage and context truncation.
The new buffered assistant rejects citations outside returned evidence and skips
the provider when evidence is insufficient. This validates IDs, not truth or
prompt-injection safety. See README and evidence example for exact limits and the
small reproducible ranking comparison; no live semantic-provider evaluation is
claimed.

## Ownership and source maintenance

The root entry includes Node filesystem persistence, and `/corpus` and `/evidence` load Node filesystem/cryptography helpers. Keep their runtime imports on the server; erased type-only imports do not load those dependencies. The package does not automatically create a browser controller, scan sources or start an AI provider.

The package README maps storage, Unicode chunking, legacy excerpts, corpus generation and ranked context packing to their source owners. Public examples document their input/return and disposal contracts. Retain/close corpus readers and await evidence-retriever close; assistants borrow those owners. Abort can stop caller waiting while an embedding adapter still holds its native slot. Permission/remote-consent changes after async ranking reject the whole stale result.

Legacy ranking defaults and locale ties remain compatible. Explicit weighted ranking, code-point spans and complete-prompt token accounting are separate opt-in contracts. Local fixture comparisons and valid citation IDs do not establish factual entailment or live model grounding.
