# Accessible browser interactions

Own focus, dialogs, roving selection and live announcements explicitly.


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


## Public entry points

Manifest reference for `@zeruxjs/accessibility@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/accessibility

DOM accessibility helpers with **explicit lifecycle cleanup**. No framework dependency.

- `createFocusTrap(element, options)` supports nested traps (only the top trap captures focus), focus restoration, fallback targets, optional Escape deactivation, and temporary `tabindex=-1` for otherwise unfocusable containers.
- `createAccessibleDialog(element, options)` manages `role=dialog`, `aria-modal`, optional labels/descriptions, Escape-to-close, focus, show/close/destroy. Escape is handled by the **topmost** dialog.
- `createRovingTabIndex(getElements, options)` supports orientation, Home/End, RTL arrow behavior, disabled filtering, optional wraparound, and programmatic selection.
- `createLiveAnnouncer(document)` supports polite/urgent announcements, clear and destroy.

```ts
const dialog = createAccessibleDialog(element, { labelledBy: 'dialog-title' });
dialog.show();
// On component teardown:
dialog.destroy();

const roving = createRovingTabIndex(() => [...items], {orientation:'horizontal', direction:'rtl'});
roving.refresh();
container.addEventListener('keydown', roving.onKey);
// Also remove your event listener at teardown.
```

**Browser requirement:** Focus and live-region APIs require a DOM. Dialog helpers do not independently implement backdrop management, page-level inertness, or full WAI-ARIA application semantics. Test with keyboard navigation and assistive technology.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/accessibility/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/accessibility/README.md)
- [packages/@zeruxjs/accessibility/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/accessibility/package.json)
