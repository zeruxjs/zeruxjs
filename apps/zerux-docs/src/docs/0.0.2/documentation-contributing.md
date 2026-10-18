---
{
  "title": "Contributing to the docs",
  "description": "Author, validate, version and extend the documentation without editing the renderer.",
  "section": "Contributing",
  "order": 10,
  "sources": [
    "apps/zerux-docs/src/site.config.mjs",
    "apps/zerux-docs/src/lib/content.mjs",
    "apps/zerux-docs/src/lib/markdown.mjs"
  ],
  "related": [
    "capabilities",
    "mental-model"
  ]
}
---

## Content format

Each version has a flat directory of Markdown files in apps/zerux-docs/src/docs/<version>/. A file starts with a JSON metadata block delimited by --- lines, followed by ordinary Markdown. JSON makes metadata validation explicit and avoids ambiguous YAML coercions.

```json
{
  "title": "Your topic",
  "description": "The concrete task or contract this page explains.",
  "section": "Fundamentals",
  "order": 100,
  "sources": ["packages/zeruxjs/src/bootstrap/types.ts"],
  "related": ["routing", "request-lifecycle"]
}
```

The filename determines the stable slug. Include package for a package guide, for example @zeruxjs/cache. Exactly one authored guide may claim a package for a version.

## Author useful pages

Explain when to use a feature, show a minimal complete example, define ownership and cleanup, cover errors/constraints, and link the implementation. Use real public imports. Distinguish standalone package configuration from framework startup configuration. Define application-supplied callbacks instead of presenting them as built-ins.

## Markdown conventions

Use level-two headings for primary sections and level-three for subsections. Stable unique heading slugs become table-of-contents links. Link to another page as [label](routing.md), including a heading fragment if necessary. Fenced code accepts a language and an optional title attribute for a filename. Tables, lists, blockquotes and inline code use standard Markdown. Raw HTML is escaped; do not embed script tags or executable MDX.

## Build validation

Run npm run build in apps/zerux-docs. The build rejects missing metadata, unknown sections, broken source references, duplicate routes/IDs, invalid related pages, missing static assets and broken local links/anchors. It checks search entries too, and promotes the new output only after validation. npm run check rechecks an existing export.

## Add a documentation version

Before bumping live packages, run npm run snapshot -- <old-version>. Commit the reference.snapshot.json file, mark that version reference as snapshot in src/site.config.mjs, and pin its ref to a Git commit/tag. Add the new version and copy/review its Markdown directory, then set site.latest. Version switching keeps the current slug when it exists or falls back to introduction.

Do not leave old documentation reading current manifests: that silently changes archived API contracts. The live reference builder requires the framework version to match the live docs version; independently released ecosystem packages keep their own versions.

## Review expectations

Keep reference links and examples synchronized with code. State implementation boundaries without claiming a whole framework ecosystem from a package name. Security, durability, authorization and query coverage should be described at the relevant API boundary, not only in a generic disclaimer. Review both desktop and mobile output and exercise keyboard navigation when changing presentation.
