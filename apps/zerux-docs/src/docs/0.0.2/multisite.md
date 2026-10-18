---
{
  "title": "Multisite",
  "description": "Resolve hosts and path prefixes into application folders.",
  "section": "Runtime",
  "order": 120,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "introduction",
    "deployment"
  ]
}
---

## Enable mappings

Set multisite: true in configuration, then register mappings from middleware using context.multisiteRegister(hostAndPath, folder). More-specific path prefixes match first. Exact hosts take priority over wildcard hosts at equal specificity.

## Request mapping

A mapping example.com/shop to shop resolves example.com/shop/api/health against app/shop/api/health/route.ts. Use * to register a host wildcard. Unmatched hosts do not fall through into unrelated root dynamic routes when mappings are registered.

## Tenant boundaries

Host routing chooses an application folder. It does not replace database tenant filters, authentication, authorization or a trusted proxy configuration.
