# @zeruxjs/ai-model

A local dependency-light **retrieval knowledge base**, not a model-training or embedding runtime. It offers keyword-based ranking, chunking, source-addressable excerpts, context budgeting, snapshots and optional filesystem persistence.

```ts
import {
  createKnowledgeBase,
  chunkDocument,
  retrieveEvidence,
} from '@zeruxjs/ai-model';

// This base contains public sample text; private sources need host authorization first.
const kb = createKnowledgeBase({
  maxDocuments: 5000,
  maxDocumentCharacters: 100_000,
});
kb.addMany(
  chunkDocument(
    {
      id: 'guide/routing',
      title: 'Routing guide',
      text: 'Register explicit request handlers for application routes.',
    },
    { maxCharacters: 1200, overlapCharacters: 150 }
  )
);
// Return source records for presentation without calling any external provider.
const sources = retrieveEvidence(kb, 'request handlers', {
  limit: 4,
  maxTotalCharacters: 4000,
});
console.log(sources.map((source) => source.sourceId));
```

Chunk IDs are deterministic (`originalId#0`, etc.). Chunk metadata contains `sourceId` and chunk number. The assistant returns citations as structured source data, allowing consumers to display evidence separately from generated text. `createGroundedPrompt` and `DocumentKnowledgeBase.search()` remain available. Document and snapshot sizes are bounded; snapshots use atomic replacement and reject symlink targets.

Search is lexical, linear in the number and length of documents; no embeddings, cross-encoder reranking or remote model training is implied. Grounded instructions are **not** a security boundary against prompt injection, nor a guarantee that answers are accurate; validate generated citations against the returned evidence and apply your own authorization filters before populating the knowledge base.

Snapshot imports reject duplicate IDs without replacing existing documents. IDs reject controls and queries are bounded. Evidence excerpts are serialized as untrusted JSON strings inside the prompt. This reduces delimiter spoofing but does not guarantee resistance to prompt injection, nor does the package train or fine-tune a model.

## Opt-in reproducible repository corpus

`@zeruxjs/ai-model/corpus` adds a local generator, validated snapshots and an
authorized evidence reader. Root/legacy imports remain available. Imports never
scan a repository, start a watcher, evaluate source or call an AI provider. The
[public-import example](examples/corpus.mjs) explicitly selects public package
manifests, export source declarations and authored documentation. No glob or
package discovery occurs. Retrieval remains here; model transport remains in AI.

`generateRepositoryCorpus({root,packages,previous?,signal?,...budgets})` reads only
the listed files. Packages must have public package.json manifests under packages/;
private packages reject. Each chosen public export name must exist in the real
export map (or root main/types), and its explicit src declaration must match a
declared dist target with the same relative stem. The initial mapper supports
this repository's src-to-dist JS/MJS/CJS/declaration layout, not arbitrary compiler
plugins, bundler remapping or wildcard expansion. It does not import/execute an
entry or expand transitive modules. Authored docs are .md files within that package
or the explicitly named apps/zerux-docs/src/docs tree.

Manifests are projected to public identity/export/dependency/license/runtime
fields; scripts and unknown/private settings are excluded from text. The complete
file still contributes its SHA-256 identity. Generated output, dependencies,
VCS/dot paths, tests/fixtures/vendor, notes/drafts/private/secrets and traversal
paths reject, including when explicitly requested. Source symlinks, nonregular
files and hard links reject. Git check-ignore --no-index is required, honors
ignore rules even for tracked files and fails closed if a selected path is ignored
or the local Git check is unavailable. The command is fixed with NUL-delimited
stdin; source text never becomes a shell command. See the official
[Git ignore-check contract](https://git-scm.com/docs/git-check-ignore).

Public files still require host review/redaction. The generator rejects PEM
private-key markers and credential-bearing manifest URLs, but cannot prove an
arbitrary paragraph/source string contains no personal data or secrets. An
allowlist is an explicit publication approval, not a secret scanner. Environment
values are not loaded, source modules are not evaluated, URLs are not fetched and
notes/roadmap status are not converted into feature claims. Authored documents are
labeled authored-doc, export declarations export, and package facts manifest;
treat prose as claims to inspect, not evidence that a capability was tested.

### Incremental identity and snapshots

Each source records path, raw content hash, indexed-text hash, package name/version,
kind, public module name and symbol labels. By default the symbol label is its
public export subpath (e.g. . or ./corpus). Optional labels are explicit host-reviewed
annotations, not an AST-derived or compiler-certified named-symbol index. Every
chunk carries this source metadata plus a deterministic ID and chunk number.
No timestamp/random build ID changes repeated output. Unicode chunking reuses the
existing chunkDocument contract. Source-addressable evidence includes path/hash/
package/version/module/symbol metadata alongside bounded excerpts.

On a subsequent generation, source files are rehashed once; unchanged source and
chunk policy reuse prior chunks, changed sources replace all their chunks and
removed/no-longer-selected sources drop out. Missing explicitly listed files are
reported in changes.missing and never retain old evidence. A missing manifest drops
that package's sources; invalid/private manifests fail the candidate. This reads
bounded source bytes once per generation, not per question. It is incremental
chunk reuse, not an OS watcher or a claim of faster indexing.

Snapshots use the corpus V1 schema with a sourceManifestHash and integrityHash.
Validation checks limits, IDs, metadata, duplicate sources/chunks, chunk overlap,
reconstructed source text hashes and envelope integrity before acceptance. Hashes
bind cached chunks to the manifest and detect corruption; they are not signatures
or proof of authorship. Keep the expected hash in trusted generation/build state.
`loadRepositoryCorpus(file,expectedManifestHash)` and createCorpusReader both
reject stale manifests. Obtain that expected hash from a successful current source
generation/approved build, not from the same untrusted cache being checked.
A failed generation must not be treated as successful current-source validation.

`saveRepositoryCorpus` reuses existing bounded atomic snapshot I/O: a private
0600 exclusive temporary file, sync, validation of the final non-symlink target,
and rename. Candidate validation/write failure preserves the previous file;
concurrent writers remain last-complete-writer-wins. Output parents/root writers
must be trusted and privately owned. This is not an adversarial-filesystem sandbox,
a cross-process lock, crash-atomic deployment or an authenticity service.
The same private I/O helper now bounds legacy snapshot reads during the read,
without changing the existing save/load API.

### Bounds, authorization and AI use

Defaults: 64 packages maximum, 512 unique sources, 256 KiB/file (maximum 1 MiB),
8 MiB total source bytes (maximum 16 MiB), 4096 chunks (maximum 10000), 1600 Unicode
characters/chunk and 200 overlap. Custom overlap must remain less than half the
chunk width. Snapshot limit is 32 MiB. Git checks have a five-second bounded
subprocess deadline/output buffer. Reads use bounded buffers, verify stable source
stats and close descriptors; signal cancellation aborts the ignore check and stops
between bounded reads. Concurrent trusted writers can still change different files
between reads; generate from a stable checkout/build input for reproducibility.

`createCorpusReader(snapshot,{expectedManifestHash,principal,authorize})` requires
a server-verified tenant/subject and an explicit synchronous source authorizer.
No authentication is inferred from identifiers. The host must obtain the principal
from its session/authorization boundary, never query/model fields. Each prepare
reauthorizes sources **before ranking/IDF calculation** and populates a fresh scoped
in-memory knowledge base with only permitted chunks. Denied documents do not affect
ranking or consume result slots. Async/invalid authorization responses fail closed.
Close clears that reader's copied corpus; readers never mutate another reader or
the host snapshot. Original retrieval/assistant APIs retain their documented
host-owned filtering requirement.

`reader.prepare(question)` returns a quoted evidence prompt and structured sources,
ready for an explicitly configured AI provider. No question triggers filesystem
rescanning, network retrieval or automatic model/tool execution. Lexical retrieval
still scans the bounded authorized in-memory documents; no embedding index or
training claim is made. Source text remains untrusted data, including instructions
embedded in docs. Quoting and system guidance reduce delimiter confusion but are
not a prompt-injection security guarantee. Authorize and obtain consent before
sending evidence to an external provider; validate model citations against the
returned sources. A quoted document never grants tool permission.

Qualification uses disposable local Git/filesystem fixtures and an explicit
public-package example, not a full ecosystem fact audit, live model evaluation or
production permission service. Local Git and a trusted stable checkout are required;
external model credentials are needed only if the host elects to call a provider.

## Ranked, budgeted evidence (opt-in)

`@zeruxjs/ai-model/evidence` exports `createEvidenceRetriever`,
`createEvidenceAssistant` and `validateEvidenceCitations`. See
[the public-import example](examples/evidence.mjs). It consumes a validated corpus
and trusted current manifest hash; it never reads source files per question.
The existing lexical/assistant APIs retain their defaults and behavior.
`DocumentKnowledgeBase.search(query,limit,ranking?)` additionally accepts explicit
field ranking options; omitting them retains the legacy title-boost calculation.

The new retriever defaults to saturating field TF/IDF with title/text/symbol weights
8/1/4, NFKC normalization, case folding, optional diacritic folding (off by default)
and Han bigrams (on by default). This is a lexical heuristic, not embeddings,
full language segmentation, model training or Elasticsearch-equivalent scores.
Weights are finite 0–100 with at least one positive field. Normalization may be
NFC/NFKC/none. Han bigrams improve matching embedded short Chinese terms but do not
promise universal multilingual tokenization. Binary ID ordering breaks score ties
independently of host locale. Ranking still tokenizes/scans the bounded authorized
corpus per query; no speed improvement or persistent search index is claimed.

### Authorization and optional embedding capability

Construct with a verified opaque tenant/subject and mandatory synchronous source
`authorize`. Source authorization runs **before** lexical document-frequency
calculation, embedding input construction, scoring and packing. Unauthorized
content cannot influence lexical scores or consume returned evidence slots.
Queries allow at most 2000 characters/128 lexical terms. Privileges are host-owned;
identifiers alone are not authentication. Close the scoped retriever on teardown.

An optional injected `EmbeddingEvidenceIndex` must declare
`capability:'authorized-candidates-v1'`, local/remote location and a bounded model
label. Its rank request contains only authorized document copies, verified
principal, current corpus hash, limit and signal. It must rank within exactly that
candidate scope, even if it uses a prebuilt index. Returned unknown/duplicate IDs,
nonfinite/negative scores or oversized hit lists reject. Scores must be
nonnegative and backend-defined; zero never qualifies. Calibrate minScore per
backend rather than comparing lexical and embedding units.

No SDK, embedding generation/upload, remote store or background refresh is added.
Local is the default host integration. Remote adapters require explicit
allowRemoteEmbedding:true and per-query approveRemoteEmbedding for host consent.
Revoking consent cannot recall already transmitted bytes. Source authorization and
remote approval are rechecked after asynchronous ranking; a changed scope rejects
the whole result rather than post-filtering scores computed from now-denied data.
Adapters are trusted host code: a declared local adapter is not a network sandbox.
Cache vectors only with appropriate tenant/permission scope, source content hash
and model/version identity; a corpus hash alone is not authorization.

Default embedding bounds are 256 authorized documents/1 MiB text characters
(maximum 1000/8 MiB); oversized plans reject instead of silently dropping rows or
uploading an unbounded corpus. Adapters report complete/partial candidate coverage.
Outage rejects without a hidden lexical fallback. Embedding resources are borrowed
unless ownEmbedding:true; owned close runs after active rank work settles.
Default maximum pending queries is four (maximum 32), no queue, with a 5-second
cooperative deadline (maximum 60 seconds). Abort/timeout stops caller waiting but
retains the slot until actual adapter settlement. Noncooperative adapters can delay
close; synchronous lexical/estimator work cannot be preempted by JavaScript timers.

### Context budgets, spans and missing evidence

Default limits: 64 ranked candidates (maximum 1000), five packed chunks (maximum
100), 1200 code points/excerpt (maximum 20000), 16000 prompt UTF-16 characters
(maximum 200000) and 4096 estimated tokens (maximum 100000). Positive scores below
minScore are excluded; minSources counts distinct source paths, defaults to one
and may be 1–16 within maxSources. Exact repeated chunk text and already covered
source intervals are deduplicated. Excerpts preserve sourcePath/contentHash/
indexed-text hash and Unicode-code-point start/end spans; offsets are in indexed
text, not bytes/line numbers. Small fragments caused solely by a tight budget are
excluded rather than treated as complete evidence.

Budgeting measures the **entire serialized prompt**, including instructions,
question, provenance, IDs and JSON-escaped excerpts. Supply a trusted pure
estimateTokens plus estimatorId for the actual target tokenizer when available.
The default utf8-bytes-v1 uses UTF-8 byte count, a conservative character-based
fallback for typical byte tokenizers, not a universal model context guarantee.
Invalid/nonfinite estimates reject. Hosts must reserve model output tokens and
budget extra system messages themselves. Context limits do not prove that a
provider with a different tokenizer will accept the request.

Results contain ready/insufficient status, reason, estimatedTokens, deduplicated,
considered, coverage/truncated metadata and corpus/ranking/threshold/budget/estimator
settings. Missing/below-threshold evidence, insufficient distinct sources and
context exhaustion are explicit; unknown is never synthesized into an API claim.
Coverage refers to the authorized candidate set, not completeness of the repository
or world knowledge. maxCandidates saturation marks possible truncation. No raw
question, principal or private document is automatically logged or sent to analytics.

The optional assistant makes **no provider call** for insufficient evidence. Ready
answers must cite returned IDs using [evidence:ID]; unknown/malformed IDs and missing
citations reject before answer delivery. The standalone validator enforces this
citation syntax, not factual entailment. Other bracketed prose is not interpreted
as a citation. The new assistant is buffered only so unvalidated partial citations
are never streamed as verified output. Existing grounded assistant behavior remains
compatible and opt-in consumers can migrate deliberately. Evidence and generated
answers remain untrusted text; quoting is not a prompt-injection defense, valid IDs
do not prove a claim, and no tool permission follows from a citation.

### Reproducible small ranking comparison

`test/evidence.test.mjs` defines fixture zx018-v1: public routing/cache/session
notes, Chinese route text, accented French café text, duplicate chunks and a long
repeated-keyword distractor. A hidden fixture is excluded for both rankings.
The same five queries/expected top source are:

| Query   | Expected source |
| ------- | --------------- |
| routing | routing.md      |
| cache   | cache.md        |
| session | session.md      |
| 路由    | unicode.md      |
| cafe    | drinks.md       |

On this deliberately adversarial fixture, legacy top-1 was 0/5 and configured
weighted top-1 was 5/5 (8/1/4, NFKC, diacritic folding, Han bigrams). The test records
fixture version, corpus hash, full public query/label list, counts and elapsed time.
This compares the whole configured heuristic bundle, not a causal claim about one
weight, a representative retrieval evaluation, statistical significance or
production latency. Lexical and injected embedding fixtures qualify authorization,
budgets, Unicode spans, duplicate removal, cancellation and citation rejection;
no live embedding/model provider or semantic grounding evaluation was performed.

## Source ownership and maintenance

- `knowledge-base.ts`, `tokenizer.ts` and `ranking.ts` retain separate legacy and explicit weighted ranking. Legacy locale folding/ties stay unchanged; opt-in ranking uses its documented binary ID tie order. Bulk adds and restores validate a complete staged replacement first.
- `chunking.ts` uses Unicode code points for chunks/overlap. `retrieval.ts` and `context.ts` preserve legacy UTF-16 excerpt/context budgets. `evidence.ts` separately owns code-point spans and budgets the entire serialized prompt, including question/provenance overhead.
- `snapshot-io.ts` owns file descriptors and private temporary siblings. `persistence.ts` preserves legacy V1 loading/saving. Parents and concurrent-writer coordination remain trusted host responsibilities; atomic rename is not a distributed transaction.
- `corpus.ts` owns explicit source selection, bounded Git/filesystem reads, public manifest projection and source/hash/overlap validation. A successful candidate is not automatically saved. Missing selections remove stale chunks; source text is never imported or executed.
- `evidence.ts` owns query admission, authorization before lexical IDF/embedding inputs, post-embedding permission/consent rechecks, deduplication and native settlement. Its close drains jobs and closes only an explicitly owned embedding adapter. The returned assistant borrows both dependencies and makes no provider call when evidence is insufficient.

The root entry eagerly exports Node filesystem persistence; `/corpus` and `/evidence` also load Node filesystem/cryptography helpers. These entries are server-side modules. Erased type-only imports do not load runtime dependencies. This package does not install a browser controller or framework service automatically.

Public examples document parameters, returns and cleanup ownership. Fixed prompt strings and embedded source fixtures retain their contents during formatting. Local deterministic retrieval/citation checks are separate from live embedding/model acceptance, factual entailment and prompt-injection resistance. The strict readability gate retains visible complexity advisories for the large validation and packing paths; no security or ownership rules are disabled to remove those warnings.
