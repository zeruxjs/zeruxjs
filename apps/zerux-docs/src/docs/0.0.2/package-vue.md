---
{
  "title": "Vue state bridges",
  "description": "Inject real Vue 3 APIs and connect stores within an explicit effect scope.",
  "section": "Packages",
  "order": 29,
  "sources": [
    "packages/@zeruxjs/vue/README.md",
    "packages/@zeruxjs/vue/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/vue"
}
---

## Prefer scoped bindings

```ts
import { shallowRef, readonly, getCurrentScope, onScopeDispose, watch } from 'vue';
import { createVueBindings } from '@zeruxjs/vue';
const bridge = createVueBindings({ shallowRef, readonly, getCurrentScope, onScopeDispose, watch });
// Inside setup() or effectScope.run():
const state = bridge.useStore(externalStore);
```

The caller supplies actual Vue functions. useStore rejects a missing scope rather than leaking a subscription. Outside setup, connect returns a ref plus stop function that the caller must invoke.

## SSR

Use useStore(store, { ssr: true }) for a one-time snapshot without a long-lived subscription. The host still owns initial state serialization and renderer integration.

## Legacy primitives

createVueRef is a framework-independent primitive, not Vue's native ref. fromVueRef without a subscription callback does not watch future writes. Use injected Vue watch for real reactive interoperability, and dispose synchronization on teardown.
