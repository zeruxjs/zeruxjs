export type SpeechOutcome =
  | 'started'
  | 'resumed'
  | 'unavailable'
  | 'denied'
  | 'busy'
  | 'error';
/** Fixed native capability and lease status; never exposes approved text or raw events. */
export interface SpeechStatus {
  /** Whether a currently reported local approved voice exists; not audible-output certification. */
  readonly available: boolean;
  /** Whether this owner currently has an active trap/utterance; not a permission grant. */
  readonly active: boolean;
  /** Whether the current owned utterance is paused in the native engine. */
  readonly paused: boolean;
  /** Optional fixed availability/failure code; approved text and native errors stay private. */
  readonly error?: 'UNAVAILABLE' | 'FAILED';
}
/** Disposable local-voice controller requiring explicit trusted actions and engine ownership. */
export interface SpeechController {
  /** Read fixed capability/persistence status without exposing text or native errors.
   * @returns {SpeechStatus} Current fixed status; no private text/native error events are returned.
   */
  getStatus(): SpeechStatus;
  /** Register a bounded owner-local observer and return its exact unsubscribe callback.
   * @param {() => void} listener - Borrowed synchronous observer; unsubscribe removes only this registration.
   * @returns {() => void} Exact unsubscribe handle; callers own eventual invocation.
   */
  subscribe(listener: () => void): () => void;
  /** Speak approved bounded plain text only after a fresh trusted native click and lease acquisition.
   * @param {string} text - Host-approved plain text within the configured budget; never read automatically from the page.
   * @param {Event} event - Borrowed trusted action/native event; stored/synthetic events cannot start speech.
   * @returns {SpeechOutcome} Fixed start outcome: started, denied, busy, unavailable or error; no automatic replay occurs.
   */
  speak(text: string, event: Event): SpeechOutcome;
  /** Pause only this controller currently owned utterance.
   * @returns {void} No value; pauses only this current lease, otherwise leaving the native engine untouched.
   */
  pause(): void;
  /** Resume only owned work after a fresh trusted native click.
   * @param {Event} event - Borrowed trusted action/native event; stored/synthetic events cannot start speech.
   * @returns {SpeechOutcome} Resumed after a valid owned gesture, otherwise denied, unavailable or error.
   */
  resume(event: Event): SpeechOutcome;
  /** Stop only this lease; never cancel foreign/unmanaged speech.
   * @returns {void} No value; stops only this owned lease and never cancels foreign engine work.
   */
  stop(): void;
  /** Release this owner resources; borrowed dependencies remain caller-owned.
   * @returns {void} No value; removes voice/utterance listeners and cancels only this owner active lease.
   */
  destroy(): void;
}
/** Weak engine-global ownership records; only the current managed lease may cancel native work. */
const leases = new WeakMap<SpeechSynthesis, object>();
/** Create optional local-voice speech behind trusted user actions and explicit exclusive ownership.
 * @param {Window} win - Borrowed realm for native feature detection/events; not a new browser process.
 * @param {{ ownership: 'exclusive'; maxCharacters?: number; voiceURI?: string; onError?: (code: 'UNAVAILABLE' | 'FAILED') => void; }} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @param {'exclusive'} options.ownership - Required exclusive speech lease policy; unmanaged callers must cooperate.
 * @param {number} [options.maxCharacters] - Approved text limit in UTF-16 code units, default 2,000 and maximum 10,000.
 * @param {string} [options.voiceURI] - Optional exact URI among reported local-service voices; never a fetch destination.
 * @param {(code: 'UNAVAILABLE' | 'FAILED') => void} [options.onError] - Host hook receiving fixed codes only; no private values or native utterance payloads.
 * @returns {SpeechController} Owned controller with fixed outcomes; never auto-starts from stored preferences.
 * @throws {TypeError} For missing exclusive ownership or invalid character/voice policy; unavailable engines yield an unavailable controller.
 */
export function createSpeechController(
  win: Window,
  options: {
    /** Required explicit exclusive engine policy; unmanaged callers must cooperate during a lease. */
    ownership: 'exclusive';
    /** Approved-text character bound, default 2,000 and maximum 10,000. */
    maxCharacters?: number;
    /** Optional URI matching a reported local-service voice; never triggers a fetch. */
    voiceURI?: string;
    /** Trusted diagnostic callback receiving fixed codes only; failures/reentrancy are isolated. */
    onError?: (code: 'UNAVAILABLE' | 'FAILED') => void;
  }
): SpeechController {
  if (options?.ownership !== 'exclusive') {
    throw new TypeError('Speech requires explicit exclusive engine ownership');
  }
  options = { ...options };
  /** Validated approved-text character budget; defaults to 2,000 and is capped at 10,000. */
  const max = options.maxCharacters ?? 2000;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 10000 ||
    (options.voiceURI !== undefined &&
      (typeof options.voiceURI !== 'string' ||
        !options.voiceURI.trim() ||
        options.voiceURI.length > 256))
  ) {
    throw new TypeError('Invalid speech policy');
  }
  /** Borrowed browser realm for native events and utterance feature detection. */
  const browser = win as Window & typeof globalThis;
  let synth: SpeechSynthesis | undefined;
  try {
    synth = browser.speechSynthesis;
  } catch {
    /* Unavailable browser capability. */
  }
  /** Required native API surface; this does not certify a local voice or audible output. */
  const capable =
    !!synth &&
    typeof browser.SpeechSynthesisUtterance === 'function' &&
    [
      'speak',
      'cancel',
      'pause',
      'resume',
      'getVoices',
      'addEventListener',
      'removeEventListener',
    ].every(
      (name) =>
        typeof (synth as unknown as Record<string, unknown>)[name] ===
        'function'
    );
  /** Opaque per-controller lease identity, unrelated to user identity or remote analytics. */
  const owner = {};
  /** Per-controller observers, capped at 32 and removed on destroy. */
  const listeners = new Set<() => void>();
  /** Trusted click events already consumed; stored/reused gestures cannot start more work. */
  const consumed = new WeakSet<Event>();
  let utterance: SpeechSynthesisUtterance | undefined,
    disposed = false,
    notifying = false,
    reporting = false,
    stopping = false,
    lastError: 'UNAVAILABLE' | 'FAILED' | undefined;
  /** Read at most 256 reported voices, retaining only explicitly local approved choices.
   * @returns {SpeechSynthesisVoice[]} At most 256 reported local-service voices matching any explicit URI; never a remote fallback.
   */
  const voices = () => {
    if (!capable) {
      return [];
    }
    try {
      return synth!
        .getVoices()
        .slice(0, 256)
        .filter(
          (voice) =>
            voice.localService === true &&
            (!options.voiceURI || voice.voiceURI === options.voiceURI)
        );
    } catch {
      return [];
    }
  };
  /** Reject operations after this speech controller is destroyed.
   * @returns {void} No value; throws after this controller/state has been destroyed.
   */
  const assertLive = () => {
    if (disposed) {
      throw new Error('Speech controller destroyed');
    }
  };
  /** Produce a frozen capability/ownership view without exposing approved text or native errors.
   * @returns {SpeechStatus} Frozen capability/active/paused view with optional fixed error code.
   */
  const status = (): SpeechStatus =>
    Object.freeze({
      available: voices().length > 0,
      active: !!utterance,
      paused: !!utterance && !!synth?.paused,
      ...(lastError ? { error: lastError } : {}),
    });
  /** Notify active observers without allowing recursive ownership changes or error escalation.
   * @returns {void} Synchronous isolated observer delivery; recursive notification is suppressed.
   */
  const notify = () => {
    if (notifying || disposed) {
      return;
    }
    notifying = true;
    try {
      // listener remains registered for this controller; observers cannot take the native speech lease.
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) {
          try {
            listener();
          } catch {
            /* Observers cannot take engine ownership. */
          }
        }
      }
    } finally {
      notifying = false;
    }
  };
  /** Expose only fixed availability/failure codes; private native utterance errors stay internal.
   * @param {'UNAVAILABLE' | 'FAILED'} code - Fixed diagnostic code; never include persisted values or approved speech text.
   * @returns {void} Updates fixed issue/status metadata without echoing private values or native speech events.
   */
  const report = (code: 'UNAVAILABLE' | 'FAILED') => {
    lastError = code;
    if (!reporting) {
      reporting = true;
      try {
        options.onError?.(code);
      } catch {
        /* Host diagnostic callbacks must not replace the primary operation outcome. */
      } finally {
        reporting = false;
      }
    }
    notify();
  };
  /** Remove utterance listeners and relinquish only this controller current lease.
   * @returns {void} Removes only this owner listeners/attributes/lease; foreign speech is never cancelled.
   */
  const release = () => {
    if (utterance) {
      utterance.removeEventListener('end', onEnd);
      utterance.removeEventListener('error', onError);
    }
    utterance = undefined;
    if (synth && leases.get(synth) === owner) {
      leases.delete(synth);
    }
  };
  /** Owned terminal listener releasing the completed utterance before notifying observers.
   * @returns {void} Releases the completed owned utterance and updates observers.
   */
  const onEnd = () => {
    release();
    notify();
  };
  /** Owned terminal listener releasing failed work and exposing only FAILED.
   * @returns {void} Releases failed owned work and exposes only the fixed FAILED outcome.
   */
  const onError = () => {
    release();
    report('FAILED');
  };
  /** Require an unused trusted in-dispatch click in the owning realm and active user activation.
   * @param {Event} event - Borrowed native event; no fabricated trusted user action is created here.
   * @returns {boolean} Whether this is a fresh trusted in-dispatch click in the owning browser realm.
   */
  const gesture = (event: Event) => {
    if (
      !(event instanceof browser.Event) ||
      !event.isTrusted ||
      event.type !== 'click' ||
      event.eventPhase === 0 ||
      consumed.has(event) ||
      browser.navigator.userActivation?.isActive === false
    ) {
      return false;
    }
    consumed.add(event);
    return true;
  };
  /** Cancel only this granted lease; foreign/unmanaged engine activity is never cancelled.
   * @returns {void} Cancels only the current owned speech lease and normalizes its empty paused queue.
   */
  const stop = () => {
    if (stopping || !utterance || !synth || leases.get(synth) !== owner) {
      return;
    }
    stopping = true;
    utterance.removeEventListener('end', onEnd);
    utterance.removeEventListener('error', onError);
    try {
      synth.cancel();
      if (synth.paused && !synth.speaking && !synth.pending) {
        synth.resume();
      }
    } catch {
      report('FAILED');
    } finally {
      release();
      stopping = false;
      notify();
    }
  };
  if (capable) {
    synth!.addEventListener('voiceschanged', notify);
  }
  return {
    /** Read fixed capability/persistence status without exposing text or native errors.
     * @returns {SpeechStatus} Current fixed status; no private text/native error events are returned.
     */
    getStatus() {
      assertLive();
      return status();
    },
    /** Register a bounded owner-local observer and return its exact unsubscribe callback.
     * @param {() => void} listener - Borrowed synchronous observer; unsubscribe removes only this registration.
     * @returns {() => void} Exact unsubscribe handle; callers own eventual invocation.
     */
    subscribe(listener) {
      assertLive();
      if (typeof listener !== 'function' || listeners.size >= 32) {
        throw new TypeError('Invalid or excessive speech observers');
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Speak approved bounded plain text only after a fresh trusted native click and lease acquisition.
     * @param {string} text - Host-approved plain text within the configured budget; never read automatically from the page.
     * @param {Event} event - Borrowed trusted action/native event; stored/synthetic events cannot start speech.
     * @returns {SpeechOutcome} Fixed start outcome: started, denied, busy, unavailable or error; no automatic replay occurs.
     */
    speak(text, event) {
      assertLive();
      /** First currently available local approved voice; no remote/default fallback is selected. */
      const voice = voices()[0];
      if (!voice) {
        report('UNAVAILABLE');
        return 'unavailable';
      }
      if (!gesture(event)) {
        return 'denied';
      }
      if (
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > max ||
        /[<>]/.test(text)
      ) {
        return 'denied';
      }
      if (
        utterance ||
        leases.has(synth!) ||
        synth!.speaking ||
        synth!.pending ||
        synth!.paused
      ) {
        return 'busy';
      }
      try {
        utterance = new browser.SpeechSynthesisUtterance(text);
        utterance.voice = voice;
        utterance.addEventListener('end', onEnd);
        utterance.addEventListener('error', onError);
        leases.set(synth!, owner);
        synth!.speak(utterance);
        lastError = undefined;
        notify();
        return 'started';
      } catch {
        release();
        report('FAILED');
        return 'error';
      }
    },
    /** Pause only this controller currently owned utterance.
     * @returns {void} No value; pauses only this current lease, otherwise leaving the native engine untouched.
     */
    pause() {
      assertLive();
      if (!utterance || leases.get(synth!) !== owner || synth!.paused) {
        return;
      }
      try {
        synth!.pause();
        notify();
      } catch {
        report('FAILED');
      }
    },
    /** Resume only owned work after a fresh trusted native click.
     * @param {Event} event - Borrowed trusted action/native event; stored/synthetic events cannot start speech.
     * @returns {SpeechOutcome} Resumed after a valid owned gesture, otherwise denied, unavailable or error.
     */
    resume(event) {
      assertLive();
      if (!utterance || leases.get(synth!) !== owner) {
        return voices().length ? 'denied' : 'unavailable';
      }
      if (!gesture(event)) {
        return 'denied';
      }
      try {
        synth!.resume();
        notify();
        return 'resumed';
      } catch {
        report('FAILED');
        return 'error';
      }
    },
    /** Stop only this lease; never cancel foreign/unmanaged speech.
     * @returns {void} No value; stops only this owned lease and never cancels foreign engine work.
     */
    stop() {
      assertLive();
      stop();
    },
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; removes voice/utterance listeners and cancels only this owner active lease.
     */
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (capable) {
        synth!.removeEventListener('voiceschanged', notify);
      }
      stop();
      release();
      listeners.clear();
    },
  };
}
