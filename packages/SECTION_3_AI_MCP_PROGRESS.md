# Section 3 — AI, knowledge retrieval, MCP

This section introduces modular implementations of `@zeruxjs/ai`, `@zeruxjs/ai-model`, and `@zeruxjs/mcp`.

- AI: configurable OpenAI-style chat completion provider, secure URL validation, abort/timeout handling, bounded response reading, typed errors, retry and fallback adapters.
- AI Model: local document retrieval, Unicode indexing, title weighting, snapshots, atomic batch adds, context limits, and grounded-prompt builder.
- MCP: tool and resource registries, minimal argument-schema validation, and an MCP-style JSON-RPC dispatcher with initialize, ping, tools/list, tools/call, resources/list, and resources/read.

## Verification

Isolated TypeScript builds (using temporary no-Node-types configurations) and 8 focused runtime tests pass. No full integration build was run.

## Remaining gaps

These packages are not universal AI infrastructure. MCP still requires authenticated transports, complete protocol/version negotiation and full JSON Schema; AI needs streaming and provider-specific capabilities; AI Model needs scalable persistent/semantic indexing and secure retrieval policies. The added README files document public APIs and explicit limitations.

> **Section 31 migration note:** `@zeruxjs/mcp` has been retired; its tool/resource
> APIs now live in `zsrv/src/protocols/mcp` and are exported from `zsrv`.
