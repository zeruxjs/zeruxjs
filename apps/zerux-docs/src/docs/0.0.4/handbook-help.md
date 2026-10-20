---
{
  "title": "Use the handbook your way",
  "description": "Search, keyboard controls, local progress, bookmarks, motion and optional offline reading.",
  "section": "Getting started",
  "order": 7,
  "sources": [
    "apps/zerux-docs/src/lib/academy.mjs",
    "packages/zeruxjs/src/bootstrap/types.ts",
    "packages/zlocale/src/index.ts"
  ],
  "related": [
    "learn",
    "solutions",
    "capabilities"
  ]
}
---

## Find an answer without reading every chapter

Start at [the solution finder](solutions.md) for a symptom, [the glossary](glossary.md) for a word, [the course](learn.md) for a guided path or [the package directory](packages.md) for an import contract. The sidebar groups tasks by responsibility; the page outline links directly to headings. Search loads its local index when you ask for it, not on the first page view.

## Keyboard controls

Use the visible Search button or Ctrl/Command+K. Search results support Up/Down arrows, Enter follows the focused result, and Escape closes the dialog. `/` opens search and `?` opens shortcut help when focus is not in a form/editable field. The help dialog lets you disable single-key shortcuts. Ordinary Tab/Shift+Tab and Enter/Space on native controls remain available.

Shortcuts never replace labeled controls. If assistive technology or your workflow reserves a key, disable the optional single-key shortcuts. Your preference stays in this browser when storage is available. Focus returns to the triggering control after a dialog closes.

## Progress, questions and bookmarks

Knowledge checks appear at the end of each course lesson. Correct answers earn 10 points once per question, with explanations and retries. A lesson is complete after its questions and your exercise confirmation. Points are self-assessment, not a credential; all lessons stay open regardless of progress.

Progress, recent pages and bookmarks are stored locally for this docs version/mount. No account, analytics request or background synchronization is used. Browser storage may be blocked or cleared. A status message reports storage failure, and all content remains readable. Export progress as a small JSON backup for your own records; reset requires explicit confirmation. There is no automatic cross-device import/sync.

The bookmark button saves a reading link locally; it does not download that page for offline access. Reading/quiz actions do not send feedback to maintainers. To report a real documentation issue, use the explicit repository issue link and remove secrets from your example.

## Motion and appearance

The theme control cycles System, Light and Dark. Reduced-motion preferences disable decorative movement. The Motion button lets you pause optional page animations independently. Animation helps show relationships and hover/focus feedback; no content depends on an animation completing. Printing removes navigation/interactive chrome and preserves article text/code.

## Optional install and offline reading

Use Enable offline reading to register the docs-only service worker on a secure origin. No service worker registers until you explicitly opt in. It caches a bounded set of eligible public docs pages/assets as you read; it does not download every package or the entire website. An unvisited article may not be available offline. The offline page explains how to reconnect.

The worker is scoped to this documentation mount, including its branch preview path. It must not control the ecosystem home, another documentation preview or application API requests. URLs with query parameters, non-GET requests and external URLs are not cached as document pages. Browser storage quota/eviction can remove saved content.

Online HTML is requested from the network first. A previously read eligible page can fall back to its cached copy on a network failure; the offline indicator reminds you to reconnect for the latest content. Updates activate through the explicit update control rather than silently replacing the current reading session. Removing offline support unregisters this mount's worker and clears its docs cache without deleting learning progress or another site's caches.

Install availability varies by browser/platform. An Install button appears only when the browser offers its install prompt; other browsers may provide Add to Home Screen in their own menu. Installation is optional and never required for reading. There are no push notifications or background account services.

## Content and version boundaries

This is the 0.0.4 preview documentation for the stated 0.0.3 package line, including independently versioned packages. Source links point to the preview branch. Keep package versions and docs versions distinct when following examples. The capabilities page records real implemented/placeholder boundaries.

Each article has a raw Markdown alternative. Use View Markdown without JavaScript, or explicitly copy the Markdown when clipboard access is available. Those files are prebuilt data, not executed components. Search, course points, offline support and bookmarks are progressive enhancements; static article content and links remain usable without them.
