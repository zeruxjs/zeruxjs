---
{
  "title": "React state bridges",
  "description": "Connect stable external stores to real React hooks without bundling React.",
  "section": "Packages",
  "order": 28,
  "sources": [
    "packages/@zeruxjs/react/README.md",
    "packages/@zeruxjs/react/package.json"
  ],
  "related": [
    "frontend-ssr",
    "package-vue",
    "frontend"
  ],
  "package": "@zeruxjs/react"
}
---

## Inject React APIs

```tsx
import { createReactBindings, createReactStore } from '@zeruxjs/react';
import { useMemo, useSyncExternalStore, useCallback } from 'react';
const bindings = createReactBindings({ useMemo, useSyncExternalStore });
const store = createReactStore({ count: 0 });
/** Render counter state. @returns A button. Reads the explicitly owned store. */
function Counter() {
  const selector = useCallback((state: { count: number }) => state.count, []);
  const count = bindings.useSelector(store, selector);
  return <button onClick={() => store.update(s => ({ count: s.count + 1 }))}>{count}</button>;
}
```

Use the real React hooks inside components. Stable selectors and equality prevent accidental snapshot churn. The package does not install React or register an application renderer.

## SSR and hydration

Provide a stable server snapshot and serialize the same initial state into the client hydration payload. Do not let a shared server singleton leak one user's state into another request. A store bridge does not create HTML rendering, hydration transport or route transitions for the framework.

## Ownership

Batch/transaction operations coordinate store notifications. Observable adapters bridge structural stores without bundling Zyro. Unsubscribe on owner teardown; if a store is shared, its lifetime must be intentional.
