---
{
  "title": "Accessible browser interactions",
  "description": "Own focus, dialogs, roving selection and live announcements explicitly.",
  "section": "Packages",
  "order": 27,
  "sources": [
    "packages/@zeruxjs/accessibility/README.md",
    "packages/@zeruxjs/accessibility/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/accessibility"
}
---

## Choose a helper

| API | Responsibility |
| --- | --- |
| createFocusTrap | Topmost trap keyboard capture and focus restoration |
| createAccessibleDialog | Dialog roles, labels, Escape and show/close/destroy |
| createRovingTabIndex | Arrow/Home/End navigation, orientation, RTL and disabled items |
| createLiveAnnouncer | Polite/urgent live-region messages and cleanup |

## Lifecycle

```ts
import { createAccessibleDialog } from '@zeruxjs/accessibility';
const dialog = createAccessibleDialog(element, { labelledBy: 'dialog-title' });
dialog.show();
// On component teardown:
dialog.destroy();
```

The element and matching labels are application-owned DOM nodes. Dialog/trap stacks ensure only the topmost active layer handles Escape/focus. Register and remove your own event listeners when using the roving helper directly.

## Markup and testing

Helpers cannot invent correct semantics for the whole application. Provide matching labels and panel references, test keyboard navigation and assistive technology, and decide backdrop/inertness behavior. DOM APIs need a browser. The separate zeruxjs/accessibility entrypoint includes the framework's accessible-tab binder.
