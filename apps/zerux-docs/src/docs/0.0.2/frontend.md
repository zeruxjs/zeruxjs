---
{
  "title": "Rendering and accessibility",
  "description": "Understand the boundary between server routes and browser features.",
  "section": "Frontend",
  "order": 130,
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

## HTML rendering

A server page can return a complete HTML string. Layout files are reserved by discovery, but this does not automatically compose layouts or render MDX. This documentation site uses its own shared server-side template at build time.

## Frontend ecosystem

The monorepo includes React, Vue, ZyroJS and Zuixs packages. Check each package README and exports for current capabilities. Avoid assuming a complete hydration pipeline or framework adapter from its package name.

## Accessible enhancement

zeruxjs/accessibility exports bindAccessibleTabs and prefersReducedMotion. Tabs require buttons with matching aria-controls, panel IDs and aria-labelledby references. Destroy the binding on unmount. DOM globals are accessed inside browser functions, making imports safe on the server.

## Template variables

createVariableRegistry, variables, registerVariable and renderVariables expose configurable variable resolution. Treat escaping as a security boundary and use the correct escape mode for the output context.

## Application styling

Use [Zuixs utility-first styling](styling.md) for theme tokens, responsive utilities and component/Markdown recipes. The documentation site uses this compiler for its complete design.
