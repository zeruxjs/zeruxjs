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
