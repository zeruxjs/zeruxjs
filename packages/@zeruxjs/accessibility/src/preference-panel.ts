import { bindPreferenceStyles, preferenceId } from './preference-styles.js';
import { isFocusAvailable } from './focus.js';
import type { PreferenceState, PreferenceValues } from './preferences.js';
import type { SpeechController } from './speech.js';
/** Authored native-control labels; defaults are English, not a localization engine. */
export interface PreferencePanelLabels {
  /** Native fieldset group label, inserted through textContent. */
  legend: string;
  /** Authored native text-size select label. */
  textSize: string;
  /** Explicit palette choice; system leaves host styling and forced colors keeps precedence. */
  contrast: string;
  /** System or reduce; no user value forces motion against a reduced-motion system preference. */
  motion: string;
  /** Authored reset-button text; reset removes only the configured storage key. */
  reset: string;
  /** Authored read-button text; actual speech still needs a trusted native action. */
  speak: string;
  /** Authored pause-button text for the owned speech lease. */
  pause: string;
  /** Authored resume-button text; a fresh trusted action is required. */
  resume: string;
  /** Authored stop-button text; foreign engine work is never cancelled. */
  stop: string;
}
/** Authored English native-control labels; hosts may supply bounded replacements. */
const defaults: PreferencePanelLabels = {
  legend: 'Accessibility preferences',
  textSize: 'Text size',
  contrast: 'Contrast',
  motion: 'Motion',
  reset: 'Reset preferences',
  speak: 'Read approved text',
  pause: 'Pause speech',
  resume: 'Resume speech',
  stop: 'Stop speech',
};
/** Mount native labelled controls without starting speech or moving focus on creation.
 * @param {HTMLElement} host - Explicit mounting container; state/speech dependencies remain borrowed.
 * @param {PreferenceState} state - Borrowed state; the panel/style binding must not destroy it.
 * @param {{ target?: HTMLElement; speech?: SpeechController; speechText?: () => string; labels?: Partial<PreferencePanelLabels>; nonce?: string; returnFocus?: () => HTMLElement | null; }} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @param {HTMLElement} [options.target] - Explicit same-document styling target; defaults to the panel host.
 * @param {SpeechController} [options.speech] - Borrowed optional controller; destroy it separately after the panel.
 * @param {() => string} [options.speechText] - Host-approved text supplier called only by the Read button.
 * @param {Partial<PreferencePanelLabels>} [options.labels] - Bounded authored label overrides; no strings are parsed as HTML.
 * @param {string} [options.nonce] - Optional host-provided CSP nonce; it is not authorization.
 * @param {() => HTMLElement | null} [options.returnFocus] - Optional logical restoration target supplier when focused controls are removed.
 * @returns {{element:HTMLFieldSetElement,focus:()=>void,destroy:()=>void}} Owned fieldset/controller; state and speech remain borrowed and need separate teardown.
 * @throws {TypeError} For invalid labels/text supplier, cross-document target or invalid style policy.
 * @throws {Error} For native/borrowed setup failures; state and speech are never destroyed as rollback.
 */
export function createPreferencePanel(
  host: HTMLElement,
  state: PreferenceState,
  options: {
    /** Explicit same-document container for scoped styles; defaults to the panel host. */
    target?: HTMLElement;
    /** Borrowed optional controller; the panel never destroys it or starts stored speech. */
    speech?: SpeechController;
    /** Trusted approved-text supplier called only by the Read button, never during rendering. */
    speechText?: () => string;
    /** Bounded authored label overrides; use the headless API for fully customized localization. */
    labels?: Partial<PreferencePanelLabels>;
    /** Optional host-provided CSP nonce; it is not generated or treated as authorization. */
    nonce?: string;
    /** Logical available focus target on focused-panel removal; defaults to the captured opener. */
    returnFocus?: () => HTMLElement | null;
  } = {}
) {
  /** Validated caller label overrides inserted only as text, never HTML. */
  const labels = { ...defaults };
  // Each key/value overrides a known authored label; reject unknown/blank/oversized text.
  for (const [key, value] of Object.entries(options.labels ?? {})) {
    if (
      !Object.hasOwn(defaults, key) ||
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 256
    ) {
      throw new TypeError('Invalid preference panel label');
    }
    labels[key as keyof PreferencePanelLabels] = value;
  }
  if (
    options.speechText !== undefined &&
    typeof options.speechText !== 'function'
  ) {
    throw new TypeError('Invalid speech text provider');
  }
  /** Explicit same-document container receiving scoped preferences and CSS. */
  const target = options.target ?? host;
  if (target.ownerDocument !== host.ownerDocument) {
    throw new TypeError('Preference target must share the panel document');
  }
  /** Owning document for controls, labels and focus restoration. */
  const doc = host.ownerDocument;
  /** Previously focused element captured before mounting; panel creation does not move focus. */
  const previous = doc.activeElement as HTMLElement | null;
  /** Generated document-local safe ID prefix used for controls and scoped styling. */
  const token = preferenceId(doc);
  /** Owned native controls container removed on panel destruction. */
  const fieldset = doc.createElement('fieldset');
  /** Owned authored group label inserted through textContent. */
  const legend = doc.createElement('legend');
  /** Owned panel-only focus stylesheet; no global filter or HTML content is injected. */
  const style = doc.createElement('style');
  fieldset.id = token;
  legend.textContent = labels.legend;
  fieldset.appendChild(legend);
  style.textContent = `
#${token} {
  font: inherit;
  color: inherit;
}
#${token} :where(select, button):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}`;
  if (options.nonce) {
    style.setAttribute('nonce', options.nonce);
  }
  fieldset.appendChild(style);
  /** Owned listener/subscription removers, released before borrowed state/speech owners. */
  const cleanup: (() => void)[] = [];
  /** Register a native listener and immediately retain its exact remover.
   * @param {HTMLElement} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
   * @param {string} type - Native event name for this owned registration.
   * @param {(event: Event) => void} callback - Borrowed host callback; no server authorization is inferred from UI state.
   * @returns {void} Retains an exact listener remover in the panel cleanup owner.
   */
  const listen = (
    element: HTMLElement,
    type: string,
    callback: (event: Event) => void
  ) => {
    element.addEventListener(type, callback);
    cleanup.push(() => element.removeEventListener(type, callback));
  };
  /** Create an authored native select with an explicit label/control association.
   * @param {string} name - Fixed attribute/control/protocol name selected by the owning implementation.
   * @param {string} label - Authored native control label inserted as text, never HTML.
   * @param {readonly (readonly [string, string])[]} choices - Fixed option value/text pairs; labels are not evaluated or parsed as markup.
   * @returns {HTMLSelectElement} New owned labelled native select with fixed option choices.
   */
  const select = (
    name: string,
    label: string,
    choices: readonly (readonly [string, string])[]
  ) => {
    /** Owned structural control wrapper; no arbitrary markup is parsed. */
    const wrapper = doc.createElement('p');
    /** Owned native label whose htmlFor targets the generated control ID. */
    const caption = doc.createElement('label');
    /** Owned native control with authored type/options and explicit listener ownership. */
    const control = doc.createElement('select');
    control.id = token + '-' + name;
    caption.htmlFor = control.id;
    caption.textContent = label;
    // Each fixed option pair becomes native value/text data, never parsed markup.
    for (const [value, text] of choices) {
      /** Owned native option; values/text come from fixed choices rather than executable data. */
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = text;
      control.appendChild(option);
    }
    wrapper.append(caption, control);
    fieldset.appendChild(wrapper);
    return control;
  };
  /** Text-size select for the documented finite scaling choices. */
  const text = select('text', labels.textSize, [
    ['1', '100%'],
    ['1.25', '125%'],
    ['1.5', '150%'],
    ['2', '200%'],
  ]);
  /** Contrast select disabled when system forced colors owns that policy. */
  const contrast = select('contrast', labels.contrast, [
    ['system', 'Host default'],
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['high', 'High contrast'],
  ]);
  /** Motion select; a user choice cannot override system reduced motion to force motion on. */
  const motion = select('motion', labels.motion, [
    ['system', 'Follow system'],
    ['reduce', 'Reduce motion'],
  ]);
  /** Owned polite status output exposing fixed messages rather than private speech text. */
  const status = doc.createElement('output');
  status.id = token + '-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  contrast.setAttribute('aria-describedby', status.id);
  motion.setAttribute('aria-describedby', status.id);
  /** Create an owned native button and its click subscription.
   * @param {string} name - Fixed attribute/control/protocol name selected by the owning implementation.
   * @param {(event: Event) => void} callback - Borrowed host callback; no server authorization is inferred from UI state.
   * @returns {HTMLButtonElement} New native button with an owned click listener.
   */
  const button = (name: string, callback: (event: Event) => void) => {
    /** Owned native control with authored type/options and explicit listener ownership. */
    const control = doc.createElement('button');
    control.type = 'button';
    control.textContent = name;
    fieldset.appendChild(control);
    listen(control, 'click', callback);
    return control;
  };
  listen(text, 'change', () =>
    state.set({
      textScale: Number(text.value) as PreferenceValues['textScale'],
    })
  );
  listen(contrast, 'change', () =>
    state.set({ contrast: contrast.value as PreferenceValues['contrast'] })
  );
  listen(motion, 'change', () =>
    state.set({ motion: motion.value as PreferenceValues['motion'] })
  );
  button(labels.reset, () => {
    state.reset();
    options.speech?.stop();
  });
  let speechButtons: HTMLButtonElement[] = [];
  if (options.speech) {
    speechButtons = [
      button(labels.speak, (event) => {
        try {
          if (options.speechText) {
            /** Fixed speech outcome from the borrowed controller; utterance text is never displayed in errors. */
            const outcome = options.speech!.speak(options.speechText(), event);
            if (outcome === 'busy') {
              status.textContent = 'Speech is already in use.';
            } else if (outcome === 'denied' || outcome === 'error') {
              status.textContent =
                'Speech could not start; use the speech button with approved text.';
            }
          }
        } catch {
          status.textContent = 'Speech text is unavailable.';
        }
      }),
      button(labels.pause, () => options.speech!.pause()),
      button(labels.resume, (event) => {
        options.speech!.resume(event);
      }),
      button(labels.stop, () => options.speech!.stop()),
    ];
  }
  fieldset.appendChild(status);
  /** Reflect current state/capabilities without starting speech or reading page contents.
   * @returns {void} Reflects current state in owned DOM/controls without starting speech or network collection.
   */
  const update = () => {
    /** Borrowed immutable preference snapshot; native controls display its values. */
    const snapshot = state.getSnapshot();
    text.value = String(snapshot.values.textScale);
    contrast.value = snapshot.values.contrast;
    motion.value = snapshot.values.motion;
    contrast.disabled = snapshot.system.forcedColors;
    /** Fixed status phrases; no persisted values/private exception payloads are interpolated. */
    const messages = [
      state.getStatus().persistence === 'failed'
        ? 'Preferences apply only to this page; storage is unavailable.'
        : 'Preferences apply to this container.',
    ];
    if (snapshot.system.forcedColors) {
      messages.push('System forced colors are active.');
    }
    if (snapshot.system.reducedMotion) {
      messages.push('System reduced motion is active.');
    }
    if (options.speech) {
      /** Borrowed capability/status snapshot used to enable actual available controls. */
      const speech = options.speech.getStatus();
      /** Fixed speech controls selected from the owned panel markup. */
      const [start, pause, resume, stop] = speechButtons;
      if (!start || !pause || !resume || !stop) {
        return;
      }
      start.disabled =
        !speech.available || speech.active || !options.speechText;
      pause.disabled = !speech.active || speech.paused;
      resume.disabled = !speech.active || !speech.paused;
      stop.disabled = !speech.active;
      if (!speech.available) {
        messages.push('Speech is unavailable: a local voice is required.');
      }
      if (speech.error === 'FAILED') {
        messages.push(
          'Speech stopped because the browser could not complete it.'
        );
      }
    }
    status.textContent = messages.join(' ');
  };
  let binding: ReturnType<typeof bindPreferenceStyles> | undefined;
  try {
    binding = bindPreferenceStyles(target, state, {
      ...(options.nonce ? { nonce: options.nonce } : {}),
    });
    host.appendChild(fieldset);
    cleanup.push(state.subscribe(update));
    if (options.speech) {
      cleanup.push(options.speech.subscribe(update));
    }
    update();
  } catch (error) {
    // stop removes one owned listener/subscription; state and speech owners remain borrowed.
    for (const stop of cleanup.reverse()) {
      stop();
    }
    fieldset.remove();
    binding?.destroy();
    throw error;
  }
  let disposed = false;
  return {
    element: fieldset,
    /** Explicitly focus the first owned native panel control; mounting itself never moves focus.
     * @returns {void} No value; calls native focus on the first owned text-size select without creating a trap.
     */
    focus() {
      if (disposed) {
        throw new Error('Preference panel destroyed');
      }
      text.focus();
    },
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; removes this panel/style/subscriptions and restores available focus only when needed.
     */
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      /** Whether teardown removes the currently focused owned control. */
      const restore = fieldset.contains(doc.activeElement);
      // stop removes one owned listener/subscription; state and speech owners remain borrowed.
      for (const stop of cleanup.reverse()) {
        stop();
      }
      fieldset.remove();
      binding?.destroy();
      if (restore) {
        /** Explicit same-document container receiving scoped preferences and CSS. */
        const target = options.returnFocus?.() ?? previous;
        if (target && isFocusAvailable(target)) {
          target.focus();
        }
      }
    },
  };
}
