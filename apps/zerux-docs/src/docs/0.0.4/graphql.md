---
{
  "title": "Opt-in GraphQL",
  "description": "Register authenticated bounded GraphQL controllers and distinct-connection SSE subscriptions.",
  "section": "Runtime",
  "order": 75,
  "sources": ["packages/zeruxjs/README.md", "packages/zeruxjs/src/graphql.ts", "packages/zeruxjs/package.json"],
  "related": ["plugins", "routing"]
}
---

## Explicit registration

`zeruxjs/graphql` exports `registerGraphQL`, `GraphQLOptions` and typed resolver
context contracts. GraphQL.js 16.14.2 and graphql-sse 2.6.3 are declared optional
MIT dependencies and load only when explicitly registered. The package README
contains a minimal typed public-import example. SDL and resolver registration are
server-owned; clients supply operations and bounded variables, never schemas.

The integration registers a POST module controller using the normal framework/zhost
HTTP owner. It reuses module providers, middleware, route-conflict checks and
request/generation disposal. No import creates a listener, GraphQL service key,
JSON-RPC/MCP bridge or executable package discovery.

## Identity and authorization

Authentication must verify the current server session/token and return subject,
tenant and absolute expiry. Field authorization runs on selected object fields;
loader authorization runs on keys and newly returned rows. Data-source queries must
still bind the verified tenant. Cached rows are operation-owned, never shared across
principals. Mutation protection must invoke the host's existing origin/CSRF policy;
POST alone is insufficient. Introspection and registered persisted-operation policy
are required explicit configuration. Unknown persisted IDs never become dynamic
client-populated cache entries.

Depth, complexity, aliases, parser tokens, variables, output bytes, list items,
concurrency and execution time are bounded. HTTP batches are disabled. Complexity
conservatively expands fragments and multiplies list costs by their configured item
ceiling. Internal errors retain trusted causes while clients receive fixed messages.
Authentication and resolver promises must cooperate with cancellation; an expired
response does not prove underlying work was stopped.

## Subscriptions and resource ownership

Optional subscriptions use maintained graphql-sse distinct-connection SSE over POST,
with connection authentication, immutable identity/expiry, periodic reauthorization
and bounded lifetime. Backpressure permits one outstanding data frame; heartbeat
retention is bounded by the maximum connection lifetime. Disconnect, expiry,
revocation or shutdown aborts the resolver signal and returns the source iterator.
Sources and external brokers must bound their own queues and unblock reads on abort.
There is no built-in distributed pubsub bus or automatic connection renewal.

Custom scalars, interface/union type resolvers, multipart uploads, WebSocket
subscription protocols, federation and incremental defer/stream are outside this
integration. Its local Node acceptance exercises real HTTP/SSE framing with fake
resolvers; production database/broker revocation and multi-instance delivery need
separate configured acceptance. See the package README for exact limits and the
[maintained protocol recipes](https://the-guild.dev/graphql/sse/guides/recipes).
