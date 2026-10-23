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

## Install and select the integration

```sh
npm install @zeruxjs/accessibility@0.0.3
```

There is no automatic `accessibility` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Mount DOM helpers after the owning elements exist. Supply stable label/description IDs, focusable controls and a meaningful initial focus target. Keep the controller in the component or route owner; creating a new trap on every keypress can leave stale focus listeners. Nested traps intentionally let only the top trap capture keyboard focus.

## TypeScript: inputs, results and ownership

```ts
import { createAccessibleDialog } from '@zeruxjs/accessibility';

type Inputs = Parameters<typeof createAccessibleDialog>;
type Result = Awaited<ReturnType<typeof createAccessibleDialog>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createAccessibleDialog>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Call destroy on dialog/trap/announcer teardown and remove any event listener your application attached itself. Refresh roving lists after items are added, disabled or reordered. Test keyboard-only interaction, focus restoration after close and nested Escape behavior. These helpers do not independently make the rest of the page inert or implement all semantics of a complex application widget.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### FocusTrapOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `initialFocus` | `()=>HTMLElement\|null` | Yes |
| `fallbackFocus` | `()=>HTMLElement\|null` | Yes |
| `returnFocus` | `boolean` | Yes |
| `escapeDeactivates` | `boolean` | Yes |
| `onEscape` | `(event:KeyboardEvent)=>void` | Yes |

### RovingOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `orientation` | `'horizontal'\|'vertical'\|'both'` | Yes |
| `loop` | `boolean` | Yes |
| `direction` | `'ltr'\|'rtl'` | Yes |
| `isDisabled` | `(node:HTMLElement)=>boolean` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/accessibility@0.0.3`.

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


## Implementation sources

- [packages/@zeruxjs/accessibility/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/accessibility/README.md)
- [packages/@zeruxjs/accessibility/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/accessibility/package.json)
