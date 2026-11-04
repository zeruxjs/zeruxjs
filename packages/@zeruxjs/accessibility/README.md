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

**Browser requirement:** Focus and live-region APIs require a DOM. Dialog helpers do not allocate backdrops or implement full WAI-ARIA application semantics. Explicit `inertBackground` ownership is described below. Test with keyboard navigation and assistive technology.

## Component contracts and owned modal behavior

Public types `ComponentA11yProps` and `LabelledComponentProps` describe explicit labels, descriptions, disabled/expanded/selected state, role and ID relationships. `applyLabelledComponentProps` requires exactly one authored `label` or `labelledBy`; it never invents a name from arbitrary text. `applyComponentProps` can preserve/validate an existing name, and `validateComponentProps` returns immutable `{ code, property }` issues without changing the DOM. Names and referenced content are not copied into diagnostics. The apply functions throw `AccessibilityValidationError` before applying invalid props.

Minimal mount/teardown example, after the referenced title is mounted:

```ts
import { applyLabelledComponentProps, createAccessibleDialog } from '@zeruxjs/accessibility';

export function mountSettings(element: HTMLElement, trigger: HTMLElement, fallback: HTMLElement) {
  const props = applyLabelledComponentProps(element, { labelledBy: 'settings-title' });
  const dialog = createAccessibleDialog(element, {
    inertBackground: true,
    focus: { returnFocusFallback: () => fallback },
  });
  const open = () => dialog.show();
  trigger.addEventListener('click', open); // Native button activation works with Enter/Space.
  return () => {
    trigger.removeEventListener('click', open);
    dialog.destroy();
    props.destroy();
  };
}
```

Use an actual button as the trigger and authored markup such as `<section hidden><h2 id="settings-title">Settings</h2>...</section>`. Escape closes the top dialog by default; wire any visible close button to `dialog.close()` through the same owner lifecycle. Supply a logical, available fallback for a removed opener. No frontend renderer, authorization layer or global component registration is installed.

### Validation boundaries

- `labelledBy`, `describedBy`, `controls`, `owns` and `activeDescendant` resolve against the element's root tree or explicit `options.root`. Lookup compares IDs directly rather than interpolating selectors. Missing/duplicate targets, malformed lists and self/unrelated active descendants reject. `activeDescendant` must refer to an actual descendant or explicitly owned subtree; comboboxes may reference descendants of a controlled popup. Target existence does not prove every ARIA role/state combination is valid.
- Defaults: at most 10,000 ID-bearing elements per reference scan (configurable to 50,000), 32 references per property, 128 characters per ID and 1,024 characters per string prop. Budget exhaustion throws rather than reporting a passing validation. Validation can run against an explicit detached subtree; references in another root/shadow tree are not inferred. Duplicate IDs are considered inside the selected reference tree only.
- Existing roles are preserved. Applying a conflicting explicit role rejects. Modal helpers accept existing `dialog`/`alertdialog` roles and add `dialog` only when no role exists; incompatible authored roles reject rather than being overwritten. Real DOM dialog references validate at `show()` so construction may precede mounting. Legacy unlabelled dialog creation remains compatible; use the explicit labelled component contract for required names.
- Native controls use native `disabled`; custom controls receive `aria-disabled`, with owned capture blocking for click and Enter/Space down/up. Disabled semantics never authorize a server operation. Disabled custom elements may remain focusable for discoverability; the composite controller decides its focus policy. Synthetic events, earlier ancestor listeners and host code remain the host's responsibility.
- Native `<label>` association and button text remain valid native labeling mechanisms. Use the generic contract when inspecting existing markup; the explicitly labelled contract intentionally requires its own label props. This is not a complete accessible-name computation or all-ARIA conformance checker.

### Nested dialog and focus ownership

`inertBackground: true` computes siblings along the current dialog's ancestor path. An explicit bounded element array can instead select background regions. Policies are document-local: nested dialogs temporarily unmask only helper-owned inert state on their own branch, while other background regions remain inert. An outer auto-inert policy continues while a child is open. Call `dialog.refresh()` after adding background regions. Native inert support (or a host-installed polyfill) is required for browser pointer/interaction enforcement; no polyfill or backdrop is loaded automatically.

Traps handle only the top active layer. Closing/destroying an inactive lower trap never steals focus from the top. Closing a DOM ancestor closes managed descendant dialogs before hiding that ancestor; portal lifecycle relationships are not inferred, so the host must destroy those separately. On top-layer close, a connected/available opener is restored; otherwise an enclosing trap or explicit `returnFocusFallback` provides the next logical location. `returnFocusTo` can supply an explicit restoration target. Invalid/out-of-trap initial/fallback focus targets reject, and activation failure releases listeners, temporary tabindex and inert leases. Author-specified `returnFocus: false` remains supported.

Owned attributes use compare-and-restore: original values return only while the current value still matches the helper's last write. Different host changes survive disposal; identical-value concurrent writes cannot be distinguished. Existing inert attributes remain intact. Temporary container tabindex is `-1` only. No positive tabindex is generated; positive authored tabindex is rejected by component validation and should not be used to manufacture order. These helpers manage custom modal elements, not native `<dialog>.showModal()` top-layer behavior; do not mix independent owners of those behaviors.

### Dynamic roving lists

`refresh()` re-reads the current list after application reconciliation, restores attributes/listeners on removed nodes and chooses the nearest surviving enabled item if the current item disappears. A focused removal can move focus to that replacement without stealing focus already moved elsewhere. Native disabled fieldsets, hidden/inert ancestors, `aria-disabled` and the synchronous `isDisabled` predicate are excluded. Maximum list size defaults to 10,000 and can be set up to 50,000 through `maxElements`.

`attach(container)` optionally owns its keydown listener; `destroy()` releases attached listeners, per-item focus listeners and original tabindex values. Existing manual `onKey` integration remains supported, but the host must remove manually installed listeners. Use one controller per list. The controller writes only `0` and `-1`, preserves user roles, skips disabled entries, handles nested event targets, supports horizontal RTL reversal and leaves Tab/Enter/Space activation to native/component behavior. Home/End and optional wrapping remain supported. No mutation observer starts automatically; call refresh on insert/remove/disable changes. Disposed reads/mutations reject, while late `onKey` callbacks are inert.

### Lint and qualification

Opt-in `@zeruxjs/lint` package/application presets now include `zerux/a11y-required-label` and `zerux/a11y-relationships`. Checks cover the explicit labelled helper, intrinsic JSX dialog/alertdialog names, malformed literal ARIA references, self active-descendants, positive tabindex and duplicate literal IDs in one unconditional native JSX subtree. Spreads, custom components, conditional branches and unknown external target existence are not guessed. There is no autofix or automatic label synthesis; reviewed cases can use scoped standard ESLint overrides.

Focused checks include DOM emulation, real headless Chrome key dispatch, public packed imports and typed contracts. `node --test test/browser.test.mjs` uses `google-chrome` or `ZERUX_A11Y_CHROME` with an isolated temporary profile, public-import browser bundle and bounded DevTools requests. It exercises real Tab/Shift+Tab/Enter/Escape/RTL arrows, native inert/disabled behavior, removal restoration and listener cleanup. No user application starts. Missing Chrome is explicitly skipped; a present browser that cannot launch fails. Node DOM emulation alone does not qualify native inert/default keyboard behavior.

Observed qualification is Chrome 156 on Linux. Screen readers (NVDA, JAWS, VoiceOver, Orca), touch exploration, magnification/high contrast and other browser/OS combinations were **not** tested. The [WAI-ARIA modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) inform the ownership behavior; automated checks do not certify WCAG compliance or complete assistive-technology compatibility.

## Optional scoped preferences

`createPreferenceState` is headless, per-owner state. `bindPreferenceStyles` applies it to one explicit container, and `createPreferencePanel` adds an optional inline fieldset with native labelled selects/buttons. Importing the package does not access storage/media, inject CSS, start speech or send network requests.

```ts
import { createPreferenceState, createPreferencePanel, createSpeechController } from '@zeruxjs/accessibility';

export function mountPreferences(host: HTMLElement, target: HTMLElement, approvedText: () => string) {
  const state = createPreferenceState(); // Memory only; no browser storage by default.
  const speech = createSpeechController(window, { ownership: 'exclusive' });
  const panel = createPreferencePanel(host, state, { target, speech, speechText: approvedText });
  return () => {
    panel.destroy();
    speech.destroy();
    state.destroy();
  };
}
```

Call after mounting the host/target, preferably with the panel host inside the target. The callback supplies only text the host deliberately approves for reading; the library never scrapes the page, selection, password fields or stored content for speech. Omit `speech` and `speechText` for a preferences-only panel. State and speech controllers are borrowed by the panel; destroy them explicitly after the panel. `panel.focus()` explicitly focuses its first native control; mounting does not move focus or trap keyboard navigation. Destroying a focused panel restores the previous available element or `options.returnFocus()`.

### State, persistence and reset

Values are `textScale: 1 | 1.25 | 1.5 | 2`, `contrast: 'system' | 'light' | 'dark' | 'high'`, and `motion: 'system' | 'reduce'`. `getSnapshot()` returns a stable frozen V2 snapshot until values/system state change; `set(partial)` validates first, and subscriptions have explicit disposal handles (maximum 128). Instances never share preference values automatically. Destroy rejects subsequent operations and releases subscriptions. Observer failures produce fixed error codes and do not disable the panel.

Persistence is optional and synchronous, explicitly injected through:

```ts
const state = createPreferenceState({
  persistence: { key: 'my-app:accessibility', storage: () => window.localStorage },
  onError: code => console.warn(code), // Fixed codes only; no saved values or speech text.
});
```

The lazy storage factory also catches blocked `localStorage` access. Read/parse/write/reset failures fall back to the current in-memory state and expose `getStatus().persistence === 'failed'` plus an optional diagnostic code; writes are not silently claimed successful or retried remotely. Only the configured key is read/written/removed. There is no storage-event sync, remote collection, cookie integration or telemetry. The host chooses a stable app/account scope, consent policy and logout cleanup; do not share one mutable server instance between users. Precedence is library defaults → valid persisted values → explicit initial overrides.

`serializePreferenceSnapshot(values)` emits `{version:2,values:{textScale,contrast,motion}}`. `parsePreferenceSnapshot(text)` validates a maximum 4096 UTF-8 bytes, rejects unknown fields/versions and returns immutable V2 data. The explicit V1 import format is `{version:1,preferences:{textSize:100|125|150|200,contrast:'default'|'high',reducedMotion:boolean}}`; it maps percent sizes to scale, `default` to `system`, and the boolean to `system`/`reduce`. V1 is a defined migration/import contract, not a claim that an earlier package release shipped this panel. Loading migrates in memory; the next actual user value change writes V2. Unknown data is never guessed or evaluated.

`reset()` restores library defaults and removes only the scoped storage key; it does not turn off system reduced motion/forced colors. The panel Reset button also stops its configured controller's owned speech. Headless reset does not operate unrelated speech controllers. Preferences never contain speech text, voice queues or an auto-start flag.

### Scoped appearance and system settings

`bindPreferenceStyles(container, state, { nonce?, observeMedia? })` owns one container binding, a scoped style element, media listeners and temporary `data-zx-*` attributes. Duplicate bindings on the same container reject. Destroy removes only owned CSS/listeners and compare-and-restores attributes; other containers and host styles remain separate. A host-provided CSP nonce is supported, never generated or treated as authorization. The inline panel has its own native-control focus styling.

Non-default text choices apply a parent-relative percentage font size at that container. Inherited/em-based text responds; fixed pixel/rem typography, media, charts and arbitrary authored markup are not repaired. Defaults leave host typography intact. Contrast choices use explicit legible root palettes (`#111`/white, white/`#111`, black/white), not a global CSS filter. Native controls inherit color-scheme and visible focus outlines are retained. Host-authored child backgrounds/colors can still require component-specific work.

Media observation uses the supplied container's window. Effective reduced motion is system reduce **or** an explicit reduce choice; there is no preference that overrides the system to force motion on. Scoped CSS also honors `prefers-reduced-motion` directly, minimizing animation/transition durations and smooth scrolling. Forced colors use native system color keywords and a visible system focus color; the panel disables conflicting contrast selection while active. Disabling JS media observation does not disable CSS media safeguards; hosts may supply system state via `setSystem`. These policies follow [Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/) and do not replace component-specific motion design.

### Deliberately narrow speech policy

Speech is separately configured through `createSpeechController(window, {ownership:'exclusive'})`. The [Web Speech synthesis API](https://webaudio.github.io/web-speech-api/#tts-section) has a window-global queue/pause/cancel state, so the host must grant exclusive use while a controller has an active lease. An existing speaking/pending/paused engine or another managed lease returns `busy`; no other owner's speech is cancelled. Unmanaged code must not enqueue into the engine during this lease. Pause/stop affect only the granted owned lease; stopping also normalizes the paused empty queue before release.

`speak(text, nativeClickEvent)` and `resume(nativeClickEvent)` require a trusted click still in dispatch, with active transient user activation where supported. The same event cannot be reused. A native button activated by keyboard works; synthetic `.click()`, stored events, delayed callbacks and hydrated preferences cannot start speech. `pause()` and `stop()` are explicit controls, and destroy cancels owned work and removes voice/utterance listeners. Outcomes distinguish `started`, `resumed`, `denied`, `busy`, `unavailable` and `error`.

Only voices the browser reports as `localService: true` are selected; a configured `voiceURI` must match an available local voice. At most 256 voice entries are inspected. No local voice means unavailable, without remote/default-voice fallback. Text is bounded to 2000 characters by default (maximum configurable 10000); `<`/`>` markup is rejected and SSML is unsupported. No utterance is constructed before a valid action. Error hooks/status use fixed codes and never expose text or native utterance error events. Browser/OS voice privacy and actual output remain host/platform responsibilities; `localService` is a browser capability report, not a network audit.

The panel's speech controls are disabled when unavailable. Speech text providers run only from the Read button handler, never storage loading, rendering or voice-list updates. No recognition/microphone API is used. Labels/legend/button captions can be supplied through `options.labels`; the default panel uses English option/status text. Use headless state for a fully localized/custom UI rather than treating this as a universal overlay.

### Preference qualification and limits

Focused checks cover V1→V2 migration, corrupt/blocked storage, isolated instances, reset scope, media changes, keyboard controls, synthetic-action denial, unavailable/remote-only voices, busy ownership, pause/resume/stop and teardown. Chrome 156 Linux tests use real keyboard dispatch and media emulation to verify scoped font/contrast/focus and reduced-motion/forced-colors behavior. Speech-engine state/failure paths are simulated while retaining actual trusted browser clicks; audible local-voice output was not qualified. A functioning installed local voice/audio device, screen-reader testing and other browser/OS qualification remain prerequisites for those claims.

This optional panel cannot repair arbitrary inaccessible markup, replace accessible application design or certify WCAG compliance. Host CSS can override generated rules; test the actual components and content, including assistive technology.
