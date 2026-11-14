/** Native browser playback. No DOM access or telemetry is started at module import. */
export type PlaybackError =
  | 'UNSUPPORTED_SOURCE'
  | 'SOURCE_EXPIRED'
  | 'PLAY_DENIED'
  | 'MEDIA_ERROR'
  | 'CAPTION_ERROR'
  | 'CAPABILITY_UNAVAILABLE';
export interface PlaybackVariant {
  /** Stable registered variant identifier, never a signed URL or principal. */
  id: string;
  /** Explicit audio/video MIME plus optional codec metadata; does not prove playback support. */
  contentType: string;
  /** Registered borrowed URL or Blob; no arbitrary HTML/source execution. */
  source:
    | {
        /** Borrowed allowed-origin HTTP(S) source; host CSP/egress controls native redirects. */
        url: string;
        /** Optional known source expiry in epoch milliseconds; expired variants cannot be selected. */
        expiresAt?: number;
      }
    | {
        /** Borrowed Blob; controller owns only the object URL it creates. */
        blob: Blob;
      };
  /** Optional explicit video decoding configuration for native capability probing. */
  video?: {
    /** Declared video width in pixels. */
    width: number;
    /** Declared video height in pixels. */
    height: number;
    /** Declared bits per second for native probing. */
    bitrate: number;
    /** Declared video frames per second. */
    framerate: number;
    /** Explicit audio/video MIME plus optional codec metadata; does not prove playback support. */
    contentType?: string;
  };
  /** Optional explicit audio decoding configuration for native capability probing. */
  audio?: {
    /** Declared audio channel configuration. */
    channels: string;
    /** Declared bits per second for native probing. */
    bitrate: number;
    /** Declared audio samples per second. */
    samplerate: number;
    /** Explicit audio/video MIME plus optional codec metadata; does not prove playback support. */
    contentType?: string;
  };
}
export interface PlaybackSupport {
  /** Stable registered variant identifier, never a signed URL or principal. */
  id: string;
  /** Native canPlayType result; empty means unsupported. */
  canPlay: '' | 'maybe' | 'probably';
  /** Current native capability result, not an all-browser codec guarantee. */
  supported: boolean;
  /** Optional native smooth-decoding estimate. */
  smooth?: boolean;
  /** Optional native power-efficiency estimate. */
  powerEfficient?: boolean;
  /** Optional indication that richer probing failed; basic canPlayType remains separately reported. */
  probeFailed?: boolean;
}
export interface PlaybackSnapshot {
  /** Explicit controller playback state. */
  state:
    | 'idle'
    | 'ready'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'error'
    | 'destroyed';
  /** Optional registered source ID; private URL never enters snapshots. */
  variantId?: string;
  /** Optional fixed public error without native causes. */
  error?: PlaybackError;
  /** Finite current playback time in seconds, or zero if unknown. */
  time: number;
  /** Finite native duration in seconds, or null when unknown. */
  duration: number | null;
  /** Native volume in the inclusive zero-to-one range. */
  volume: number;
  /** Current native mute state. */
  muted: boolean;
  /** Current bounded authored caption/subtitle choices. */
  captions: {
    /** Native text-track index, not an invented label. */
    index: number;
    /** Authored inert accessible label, not derived from arbitrary page content. */
    label: string;
    /** Authored track language metadata. */
    language: string;
    /** Whether this native text track is currently showing. */
    showing: boolean;
  }[];
}
export interface PlaybackOptions {
  /** One to 32 explicitly registered unique variants; no remote discovery. */
  variants: readonly PlaybackVariant[];
  /** Exact initial source origins, maximum 32; default same-document origin. */
  allowedOrigins?: readonly string[];
  /** Optional borrowed native decodingInfo provider; no forced cancellation guarantee. */
  capabilities?: Pick<MediaCapabilities, 'decodingInfo'>;
  /** Optional fixed-label diagnostic observer; no signed URLs or private native errors. */
  onEvent?: (
    event: Readonly<{
      /** Fixed source/error event label. */
      type: 'source' | 'error';
      /** Optional registered source ID; private URL never enters snapshots. */
      variantId?: string;
      /** Optional fixed public playback error. */
      code?: PlaybackError;
    }>
  ) => void;
}
/** Per-element exclusive source ownership without a process-global list of user media. */
const owners = new WeakSet<HTMLMediaElement>();
/** Validate explicit audio/video MIME and optional restricted codec metadata; this does not guarantee native decoding.
 * @param {string} value - Declared registered type, maximum 256 characters.
 * @returns {void} Returns after syntax validation or throws before source selection.
 */
function contentType(value: string) {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !/^(?:audio|video)\/[A-Za-z0-9.+-]+(?:; codecs="[A-Za-z0-9., _-]{1,160}")?$/.test(
      value
    )
  ) {
    throw new TypeError('Explicit media MIME/codec type required');
  }
}
/** Validate a finite playback control value inside its native range.
 * @param {number} value - Requested control value.
 * @param {number} min - Inclusive permitted minimum.
 * @param {number} max - Inclusive permitted maximum.
 * @returns {number} Validated value; no clamping hides invalid caller input.
 */
function numeric(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError('Invalid playback value');
  }
  return value;
}
/** Take source ownership of an empty native media element without autoplay. Only registered variants can be selected; destroy releases listeners, owned URLs, expiry timers and compare-restorable caption modes.
 * @param {HTMLMediaElement} media - Borrowed empty same-realm HTMLMediaElement; authored labels and native controls remain host responsibilities.
 * @param {PlaybackOptions} options - Registered sources, exact initial origin policy and optional borrowed capability probe.
 * @returns {object} Headless controller; destroy does not force-cancel native capability promises or close borrowed elements.
 */
export function createMediaPlayback(
  media: HTMLMediaElement,
  options: PlaybackOptions
) {
  /** Borrowed element document realm; used instead of assuming browser globals exist. */
  const win = media?.ownerDocument?.defaultView;
  if (
    !win ||
    typeof win.HTMLMediaElement !== 'function' ||
    !(media instanceof win.HTMLMediaElement) ||
    typeof media.canPlayType !== 'function'
  ) {
    throw new TypeError('DOM HTMLMediaElement required');
  }
  if (
    media.autoplay ||
    media.hasAttribute('autoplay') ||
    media.srcObject ||
    media.currentSrc ||
    owners.has(media) ||
    media.hasAttribute('src') ||
    media.querySelector('source')
  ) {
    throw new Error('An empty, unowned media element is required');
  }
  if (
    !options ||
    !Array.isArray(options.variants) ||
    !options.variants.length ||
    options.variants.length > 32
  ) {
    throw new TypeError('Register 1–32 playback variants');
  }
  if (
    (options.onEvent !== undefined && typeof options.onEvent !== 'function') ||
    (options.capabilities !== undefined &&
      typeof options.capabilities?.decodingInfo !== 'function')
  ) {
    throw new TypeError('Invalid playback callbacks');
  }
  /** Validated exact initial source-origin allowlist, not native redirect enforcement. */
  const origins =
    options.allowedOrigins ??
    (win.location.origin === 'null' ? [] : [win.location.origin]);
  if (
    !Array.isArray(origins) ||
    origins.length > 32 ||
    origins.some((origin) => {
      try {
        return new URL(origin).origin !== origin;
      } catch {
        return true;
      }
    })
  ) {
    throw new TypeError('Invalid playback origin policy');
  }
  /** Unique registered variant IDs preventing ambiguous explicit selection. */
  const ids = new Set<string>();
  /** Copied validated variant metadata; borrowed native bytes/URLs retain host ownership. */
  const variants = options.variants.map((variant) => {
    if (
      !variant ||
      typeof variant.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(variant.id) ||
      ids.has(variant.id)
    ) {
      throw new TypeError('Invalid/duplicate playback variant');
    }
    ids.add(variant.id);
    contentType(variant.contentType);
    /** Per-variant configuration copy so later caller mutation cannot change selection policy. */
    const copy: PlaybackVariant = {
      ...variant,
      source: { ...variant.source },
      ...(variant.video ? { video: { ...variant.video } } : {}),
      ...(variant.audio ? { audio: { ...variant.audio } } : {}),
    };
    /** Declared source-shape keys checked against URL/Blob-specific allowlists. */
    const sourceKeys = Object.keys(copy.source);
    if (
      sourceKeys.some(
        (key) =>
          !('url' in copy.source ? ['url', 'expiresAt'] : ['blob']).includes(
            key
          )
      )
    ) {
      throw new TypeError('Invalid source fields');
    }

    if ('url' in copy.source) {
      /** Native canPlayType result or validated declared source URL within its own operation. */
      const raw = copy.source.url;
      if (
        typeof raw !== 'string' ||
        raw.length > 8192 ||
        // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
        /[\x00-\x20\x7f\\]/.test(raw)
      ) {
        throw new TypeError('Invalid media URL');
      }
      let url: URL;
      try {
        url = new URL(raw, win.location.href);
      } catch {
        throw new TypeError('Invalid media URL');
      }
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        !origins.includes(url.origin)
      ) {
        throw new TypeError('Media origin denied');
      }
      copy.source.url = url.href;
      if (
        copy.source.expiresAt !== undefined &&
        (!Number.isSafeInteger(copy.source.expiresAt) ||
          copy.source.expiresAt < 0)
      ) {
        throw new TypeError('Invalid source expiry');
      }
    } else if (
      !('blob' in copy.source) ||
      !(copy.source.blob instanceof win.Blob)
    ) {
      throw new TypeError('Registered URL or Blob required');
    }
    if (copy.video) {
      /** Validated declared native decoding MIME for the current registered variant. */
      const type = copy.video.contentType ?? copy.contentType;
      contentType(type);
      if (!type.startsWith('video/')) {
        throw new TypeError('Video capability MIME required');
      }
      numeric(copy.video.width, 1, 16384);
      numeric(copy.video.height, 1, 16384);
      numeric(copy.video.bitrate, 1, 1000000000);
      numeric(copy.video.framerate, 0.1, 240);
    }
    if (copy.audio) {
      /** Validated declared native decoding MIME for the current registered variant. */
      const type = copy.audio.contentType ?? copy.contentType;
      contentType(type);
      if (!type.startsWith('audio/')) {
        throw new TypeError('Audio capability MIME required');
      }
      if (!/^[1-9][0-9]?$/.test(copy.audio.channels)) {
        throw new TypeError('Invalid audio channels');
      }
      numeric(copy.audio.bitrate, 1, 10000000);
      numeric(copy.audio.samplerate, 8000, 384000);
    }
    return copy;
  });
  /** Borrowed optional native capability probe; no network provider is created. */
  const capabilities = options.capabilities ?? win.navigator.mediaCapabilities;
  let destroyed = false,
    generation = 0,
    state: PlaybackSnapshot['state'] = 'idle',
    error: PlaybackError | undefined,
    current: string | undefined,
    lastSrc: string | undefined,
    ownedUrl: string | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  /** Bounded observer set, cleared on destroy; callbacks do not own playback. */
  const subscribers = new Set<(snapshot: PlaybackSnapshot) => void>();
  /** Exact owned native listener tuples retained for setup/teardown. */
  const listeners: {
    /** Borrowed event target paired with an exact cleanup callback. */
    target: EventTarget;
    /** Fixed native event name. */
    name: string;
    /** Owned callback removed at teardown. */
    fn: EventListener;
    /** Original native capture flag required for exact removal. */
    capture: boolean;
  }[] = [];
  if (media.textTracks.length > 32) {
    throw new RangeError('Caption track limit');
  }
  let probing = 0;
  /** Original and last-owned caption modes for compare-and-restore semantics. */
  const trackModes = new Map<
    TextTrack,
    {
      /** Native track mode before this controller first changed it. */
      before: TextTrackMode;
      /** Most recent helper-assigned track mode; restore only if it still matches. */
      last: TextTrackMode;
    }
  >();
  owners.add(media);
  /** Reject public mutations after controller destruction.
   * @returns {void} Throws once destroyed, before touching native state.
   */
  const ensure = () => {
    if (destroyed) {
      throw new Error('Playback controller destroyed');
    }
  };
  /** Read at most 32 current caption/subtitle tracks, preserving their native indexes and authored labels.
   * @returns {object[]} Fresh current native track/index pairs; the host owns track URLs.
   */
  function tracks() {
    return Array.from(
      { length: Math.min(media.textTracks.length, 32) },
      (_, index) => media.textTracks[index]
    )
      .map((track, index) => ({ track, index }))
      .filter(
        (entry): entry is { track: TextTrack; index: number } =>
          entry.track !== undefined &&
          ['captions', 'subtitles'].includes(entry.track.kind)
      );
  }
  /** Project bounded native state without source URLs or platform error objects.
   * @returns {PlaybackSnapshot} Fresh state with authored caption labels/languages; unknown duration stays null.
   */
  function snapshot(): PlaybackSnapshot {
    return {
      state,
      ...(current ? { variantId: current } : {}),
      ...(error ? { error } : {}),
      time: Number.isFinite(media.currentTime) ? media.currentTime : 0,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      volume: media.volume,
      muted: media.muted,
      captions: tracks().map(({ track, index }) => ({
        index,
        label: track.label.slice(0, 256),
        language: track.language.slice(0, 64),
        showing: track.mode === 'showing',
      })),
    };
  }
  /** Notify current observers with separate cloned snapshots; observer failures never take playback ownership.
   * @returns {void} Does nothing after destroy and never emits URLs.
   */
  function emit() {
    if (destroyed) {
      return;
    }
    /** Sanitized state projection without source URLs or platform error objects. */
    const view = snapshot();
    // Iterate only the bounded registered records or owned cleanup handles for this operation.
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(structuredClone(view));
      } catch {
        /* UI observers do not own playback. */
      }
    }
  }
  /** Emit fixed redacted source/error metadata only, isolating observer failure.
   * @param {'source' | 'error'} type - Fixed event type.
   * @param {PlaybackError} code - Optional fixed public playback error.
   * @returns {void} No private URL, signed token or platform cause is included.
   */
  function notify(type: 'source' | 'error', code?: PlaybackError) {
    try {
      options.onEvent?.(
        Object.freeze({
          type,
          ...(current ? { variantId: current } : {}),
          ...(code ? { code } : {}),
        })
      );
    } catch {
      /* No URL or platform error is emitted. */
    }
  }
  /** Set a fixed error and pause only the still-owned source before notifying observers.
   * @param {PlaybackError} code - Fixed public error discriminator.
   * @returns {void} Updates controller state without changing a source replaced by the host.
   */
  function failure(code: PlaybackError) {
    error = code;
    state = 'error';
    if (
      current &&
      lastSrc !== undefined &&
      media.getAttribute('src') === lastSrc
    ) {
      media.pause();
    }
    notify('error', code);
    emit();
  }
  /** Register a native listener and retain its exact removal tuple for teardown.
   * @param {EventTarget} target - Borrowed native event target.
   * @param {string} name - Fixed native event name.
   * @param {EventListener} fn - Owned callback removed at destroy.
   * @param {boolean} capture - Native capture setting, default false.
   * @returns {void} Retains listener ownership until controller teardown.
   */
  function listen(
    target: EventTarget,
    name: string,
    fn: EventListener,
    capture = false
  ) {
    target.addEventListener(name, fn, capture);
    listeners.push({ target, name, fn, capture });
  }
  /** Clear expiry, detach only the still-owned source, then revoke any owned Blob URL.
   * @returns {void} Leaves a host-replaced src untouched and never revokes borrowed URLs.
   */
  function detach() {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = undefined;
    if (lastSrc !== undefined && media.getAttribute('src') === lastSrc) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    if (ownedUrl !== undefined) {
      win!.URL.revokeObjectURL(ownedUrl);
    }
    ownedUrl = undefined;
    lastSrc = undefined;
  }
  /** Owned native state listener; platform errors are mapped to fixed public codes.
   * @param {Event} event - Native media or captured caption event.
   * @returns {void} Updates only the current live controller state.
   */
  const changed: EventListener = (event) => {
    if (destroyed) {
      return;
    }
    if (event.type === 'error') {
      failure(
        (event.target as Element)?.tagName === 'TRACK'
          ? 'CAPTION_ERROR'
          : 'MEDIA_ERROR'
      );
      return;
    }
    if (!error) {
      if (event.type === 'play') {
        state = 'playing';
      } else if (event.type === 'pause') {
        state = 'paused';
      } else if (event.type === 'ended') {
        state = 'ended';
      }
    }
    emit();
  };
  // Iterate only the bounded registered records or owned cleanup handles for this operation.
  for (const name of [
    'timeupdate',
    'durationchange',
    'loadedmetadata',
    'play',
    'pause',
    'ended',
    'volumechange',
  ]) {
    listen(media, name, changed);
  }
  listen(media, 'error', changed, true);
  if (typeof media.textTracks.addEventListener === 'function') {
    // Iterate only the bounded registered records or owned cleanup handles for this operation.
    for (const name of ['change', 'addtrack', 'removetrack']) {
      listen(media.textTracks, name, () => {
        if (media.textTracks.length > 32) {
          failure('CAPTION_ERROR');
        } else {
          emit();
        }
      });
    }
  }
  /** Probe only registered types with canPlayType and optional MediaCapabilities; cap four pending probes and retain capacity through settlement.
   * @param {AbortSignal} signal - Optional cooperative selection cancellation; native decodingInfo may not accept it.
   * @returns {Promise<PlaybackSupport[]>} Descriptive browser support, not universal codec/container certification.
   */
  async function probe(signal?: AbortSignal): Promise<PlaybackSupport[]> {
    ensure();
    if (probing >= 4) {
      throw new Error('Playback capability probe busy');
    }
    probing++;
    try {
      /** Operation-local registered-variant support records returned in deterministic order. */
      const results: PlaybackSupport[] = [];
      // Iterate only the bounded registered records or owned cleanup handles for this operation.
      for (const variant of variants) {
        if (signal?.aborted) {
          throw new Error('Playback selection cancelled');
        }
        /** Native canPlayType result or validated declared source URL within its own operation. */
        const raw = media.canPlayType(variant.contentType);
        /** Normalized restricted native support token, separate from optional richer probing. */
        const canPlay = (() => {
          if (raw === 'probably') {
            return 'probably';
          } else {
            if (raw === 'maybe') {
              return 'maybe';
            } else {
              return '';
            }
          }
        })();
        /** Mutable operation-local support record, never shared across probes. */
        const result: PlaybackSupport = {
          id: variant.id,
          canPlay,
          supported: !!canPlay,
        };
        if (
          canPlay &&
          capabilities &&
          typeof capabilities.decodingInfo === 'function' &&
          (variant.video || variant.audio)
        ) {
          try {
            /** Native decoding capabilities checked for required boolean result fields. */
            const info = await capabilities.decodingInfo({
              type: 'file',
              ...(variant.video
                ? {
                    video: {
                      ...variant.video,
                      contentType:
                        variant.video.contentType ?? variant.contentType,
                    },
                  }
                : {}),
              ...(variant.audio
                ? {
                    audio: {
                      ...variant.audio,
                      contentType:
                        variant.audio.contentType ?? variant.contentType,
                    },
                  }
                : {}),
            });
            if (
              typeof info.supported !== 'boolean' ||
              typeof info.smooth !== 'boolean' ||
              typeof info.powerEfficient !== 'boolean'
            ) {
              throw new Error();
            }
            result.supported = info.supported;
            result.smooth = info.smooth;
            result.powerEfficient = info.powerEfficient;
          } catch {
            result.probeFailed = true;
          }
        }
        results.push(result);
      }
      if (signal?.aborted) {
        throw new Error('Playback selection cancelled');
      }
      return results;
    } finally {
      probing--;
    }
  }
  return {
    media,
    getSnapshot: snapshot,
    probe,
    /** Register one of at most 64 observers and immediately publish current state; remove a callback whose first invocation fails.
     * @param {function} callback - Observer of sanitized snapshots, never signed source URLs.
     * @returns {function} Idempotent unsubscribe; retaining it does not transfer controller ownership.
     */
    subscribe(callback: (snapshot: PlaybackSnapshot) => void) {
      ensure();
      if (typeof callback !== 'function' || subscribers.size >= 64) {
        throw new TypeError('Invalid/excess playback observer');
      }
      subscribers.add(callback);
      try {
        callback(snapshot());
      } catch (error) {
        subscribers.delete(callback);
        throw error;
      }
      return () => {
        subscribers.delete(callback);
      };
    },
    /** Select an eligible registered variant after probing; generation fences prevent old async probes from committing. Selection never starts playback.
     * @param {string} id - Optional registered variant ID; default first supported unexpired variant.
     * @param {AbortSignal} signal - Optional selection cancellation; stale/destroyed work cannot commit a source.
     * @returns {Promise<boolean>} True after source selection, false for stale/unsupported/expired state; invalid IDs reject.
     */
    async select(id?: string, signal?: AbortSignal) {
      ensure();
      if (id !== undefined && !ids.has(id)) {
        throw new TypeError('Variant is not registered');
      }
      /** Selection/play generation fence; stale async work cannot commit current state. */
      const turn = ++generation;
      detach();
      current = undefined;
      error = undefined;
      state = 'idle';
      emit();
      /** Current registered-type support results; no unregistered source can be selected. */
      const supported = await probe(signal);
      if (destroyed || turn !== generation || signal?.aborted) {
        return false;
      }
      /** First eligible registered supported source matching the optional requested ID. */
      const variant = variants.find(
        (v) =>
          (id === undefined || v.id === id) &&
          supported.find((s) => s.id === v.id)?.supported &&
          (!('url' in v.source) ||
            v.source.expiresAt === undefined ||
            v.source.expiresAt > Date.now())
      );
      if (!variant) {
        failure(
          variants.some(
            (v) =>
              (id === undefined || v.id === id) &&
              'url' in v.source &&
              v.source.expiresAt !== undefined &&
              v.source.expiresAt <= Date.now()
          )
            ? 'SOURCE_EXPIRED'
            : 'UNSUPPORTED_SOURCE'
        );
        return false;
      }
      detach();
      if (destroyed || turn !== generation) {
        return false;
      }
      error = undefined;
      current = variant.id;
      if ('blob' in variant.source) {
        if (typeof win.URL.createObjectURL !== 'function') {
          failure('CAPABILITY_UNAVAILABLE');
          return false;
        }
        ownedUrl = win.URL.createObjectURL(variant.source.blob);
        lastSrc = ownedUrl;
      } else {
        lastSrc = variant.source.url;
      }
      media.setAttribute('src', lastSrc);
      media.load();
      state = 'ready';
      if ('url' in variant.source && variant.source.expiresAt !== undefined) {
        /** Known source expiry captured for this selection generation. */
        const expiresAt = variant.source.expiresAt;
        /** Owned generation-fenced expiry callback; long delays are bounded by native timer limits.
         * @returns {void} Reschedules until expiry, then detaches only the owned source.
         */
        const expire = () => {
          if (destroyed || turn !== generation) {
            return;
          }
          /** Milliseconds until the registered source expiry, recomputed when the timer fires. */
          const remaining = expiresAt - Date.now();
          if (remaining > 0) {
            timer = setTimeout(expire, Math.min(remaining, 2147483647));
            return;
          }
          detach();
          failure('SOURCE_EXPIRED');
        };
        timer = setTimeout(
          expire,
          Math.min(Math.max(0, expiresAt - Date.now()), 2147483647)
        );
      }
      notify('source');
      emit();
      return true;
    },
    /** Request native playback only for a selected usable source; browser gesture policy may still deny it.
     * @returns {Promise<boolean>} True on current-generation playback, false on denial/staleness; no automatic autoplay.
     */
    async play() {
      ensure();
      if (
        !current ||
        (error && error !== 'PLAY_DENIED' && error !== 'CAPTION_ERROR')
      ) {
        return false;
      }
      error = undefined;
      /** Selection/play generation fence; stale async work cannot commit current state. */
      const turn = generation;
      try {
        await media.play();
        if (destroyed || turn !== generation) {
          return false;
        }
        state = 'playing';
        emit();
        return true;
      } catch {
        if (!destroyed && turn === generation) {
          failure('PLAY_DENIED');
        }
        return false;
      }
    },
    /** Pause native playback and update sanitized state without discarding a current error.
     * @returns {void} Notifies observers after the native pause request.
     */
    pause() {
      ensure();
      media.pause();
      if (!error) {
        state = 'paused';
      }
      emit();
    },
    /** Seek only within finite duration and declared native seekable ranges; never manufacture a tab order.
     * @param {number} seconds - Finite nonnegative target time in seconds.
     * @returns {void} Updates native currentTime or throws for an unavailable position.
     */
    seek(seconds: number) {
      ensure();
      numeric(seconds, 0, Number.MAX_SAFE_INTEGER);
      if (!Number.isFinite(media.duration) || seconds > media.duration) {
        throw new RangeError('Media is not seekable at this position');
      }
      if (
        media.seekable.length &&
        !Array.from(
          { length: media.seekable.length },
          (_, i) =>
            seconds >= media.seekable.start(i) &&
            seconds <= media.seekable.end(i)
        ).some(Boolean)
      ) {
        throw new RangeError('Position outside seekable ranges');
      }
      media.currentTime = seconds;
      emit();
    },
    /** Set an explicit native volume without silently accepting out-of-range input.
     * @param {number} value - Finite volume from zero through one.
     * @returns {void} Updates volume and notifies observers.
     */
    volume(value: number) {
      ensure();
      media.volume = numeric(value, 0, 1);
      emit();
    },
    /** Set native mute with a real boolean.
     * @param {boolean} value - Explicit mute state.
     * @returns {void} Updates mute and notifies observers.
     */
    mute(value: boolean) {
      ensure();
      if (typeof value !== 'boolean') {
        throw new TypeError('Mute requires boolean');
      }
      media.muted = value;
      emit();
    },
    /** Select one current native caption track or disable them; record prior modes for compare-and-restore teardown.
     * @param {number | null} index - Current native caption index, or null to disable captions.
     * @returns {void} Updates caption modes without inventing labels or fetching track URLs itself.
     */
    captions(index: number | null) {
      ensure();
      if (media.textTracks.length > 32) {
        throw new RangeError('Caption track limit');
      }
      /** Current bounded native caption/subtitle tracks with authored indexes. */
      const available = tracks();
      if (
        index !== null &&
        (!Number.isSafeInteger(index) ||
          !available.some((v) => v.index === index))
      ) {
        throw new RangeError('Caption track not found');
      }
      // Iterate only the bounded registered records or owned cleanup handles for this operation.
      for (const { track, index: i } of available) {
        if (!trackModes.has(track)) {
          trackModes.set(track, { before: track.mode, last: track.mode });
        }
        /** Saved before/last native track modes for conditional restoration. */
        const entry = trackModes.get(track)!;
        track.mode = i === index ? 'showing' : 'disabled';
        entry.last = track.mode;
      }
      emit();
    },
    /** Release only owned listeners, prop leases, source/URL/timer or controls. Preserve host replacements and restore authored state only when the last helper value still matches.
     * @returns {void} Idempotent synchronous teardown; native async probes remain generation-fenced.
     */
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      generation++;
      // Iterate only the bounded registered records or owned cleanup handles for this operation.
      for (const { target, name, fn, capture } of listeners) {
        target.removeEventListener(name, fn, capture);
      }
      listeners.length = 0;
      detach();
      // Iterate only the bounded registered records or owned cleanup handles for this operation.
      for (const [track, entry] of trackModes) {
        if (track.mode === entry.last) {
          track.mode = entry.before;
        }
      }
      trackModes.clear();
      subscribers.clear();
      state = 'destroyed';
      owners.delete(media);
    },
  };
}
export type MediaPlayback = ReturnType<typeof createMediaPlayback>;
export interface PlaybackAccessibility {
  /** Apply an authored real label through host-provided accessibility validation and retain attribute restoration ownership.
   * @param {HTMLElement} element - Borrowed element receiving the explicit label.
   * @param {object} props - Authored label, never synthesized from arbitrary content.
   * @param {string} props.label - Real authored accessible name.
   * @returns {object} Owned destroy lease that preserves subsequent host attribute changes.
   */
  applyLabelledComponentProps(
    element: HTMLElement,
    props: {
      /** Authored inert accessible label, not derived from arbitrary page content. */
      label: string;
    }
  ): {
    /** Release only owned listeners, prop leases, source/URL/timer or controls. Preserve host replacements and restore authored state only when the last helper value still matches.
     * @returns {void} Idempotent synchronous teardown; native async probes remain generation-fenced.
     */
    destroy(): void;
  };
  /** Validate/apply explicit semantic ID relationships using host-provided accessibility helpers.
   * @param {HTMLElement} element - Borrowed target media element.
   * @param {object} props - Explicit description ID references.
   * @param {string} props.describedBy - Existing explicit description IDs.
   * @param {object} options - Optional label requirement policy.
   * @param {boolean} [options.requireLabel] - Require an existing authored name.
   * @returns {object} Owned destroy lease for compare-and-restore attributes.
   */
  applyComponentProps(
    element: HTMLElement,
    props: {
      /** Explicit authored status/description ID references validated by accessibility helpers. */
      describedBy: string;
    },
    options?: {
      /** Optional requirement that a real accessible label already exists. */
      requireLabel?: boolean;
    }
  ): {
    /** Release only owned listeners, prop leases, source/URL/timer or controls. Preserve host replacements and restore authored state only when the last helper value still matches.
     * @returns {void} Idempotent synchronous teardown; native async probes remain generation-fenced.
     */
    destroy(): void;
  };
}
let controlSequence = 0;
/** Mount optional native labelled controls using injected accessibility helpers. Destroy these controls before the borrowed headless controller; source/caption URLs remain host-owned.
 * @param {HTMLElement} host - Borrowed same-document host receiving one owned fieldset.
 * @param {MediaPlayback} playback - Borrowed headless controller; this UI never destroys it.
 * @param {object} options - Authored label, prop helpers and explicit native-control/focus policy.
 * @param {string} options.label - Real visible control-group name.
 * @param {PlaybackAccessibility} options.accessibility - Borrowed validated attribute helpers.
 * @param {boolean} [options.hideNativeControls] - Explicit native-controls suppression.
 * @param {function} [options.returnFocus] - Trusted logical fallback after UI removal.
 * @returns {object} Owned controls element, focus operation and idempotent destroy; no screen-reader certification is implied.
 */
export function createMediaControls(
  host: HTMLElement,
  playback: MediaPlayback,
  options: {
    /** Authored inert accessible label, not derived from arbitrary page content. */
    label: string;
    /** Borrowed explicit prop helpers; this module does not bundle a UI framework. */
    accessibility: PlaybackAccessibility;
    /** Explicit opt-in to hide native controls; restore only unchanged helper state. */
    hideNativeControls?: boolean;
    /** Optional trusted logical focus fallback after control removal. */
    returnFocus?: () => HTMLElement | null;
  }
) {
  /** Borrowed media element owned for source state by the separate playback controller. */
  const media = playback.media;
  /** Borrowed same-document DOM owner used for native controls. */
  const document = host?.ownerDocument;
  if (
    !document?.defaultView ||
    media.ownerDocument !== document ||
    typeof options?.label !== 'string' ||
    !options.label.trim() ||
    options.label.length > 256 ||
    typeof options.accessibility?.applyLabelledComponentProps !== 'function' ||
    typeof options.accessibility.applyComponentProps !== 'function' ||
    (options.hideNativeControls !== undefined &&
      typeof options.hideNativeControls !== 'boolean') ||
    (options.returnFocus !== undefined &&
      typeof options.returnFocus !== 'function')
  ) {
    throw new TypeError(
      'DOM host, authored label and accessibility helpers required'
    );
  }
  /** Owned labelled fieldset removed on setup failure or destroy. */
  const group = document.createElement('fieldset');
  /** Owned visible authored group label assigned with textContent. */
  const legend = document.createElement('legend');
  legend.textContent = options.label;
  group.append(legend);
  /** Owned polite live status text; never private errors or HTML. */
  const status = document.createElement('output');
  // Allocate a document-unique status ID without replacing authored elements.
  do {
    status.id = 'media-player-status-' + ++controlSequence;
  } while (document.getElementById(status.id));
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  /** Owned native Play/Pause button with normal keyboard semantics. */
  const play = document.createElement('button');
  play.type = 'button';
  play.textContent = 'Play';
  group.append(play);
  /** Create one labelled native range control within the owned fieldset.
   * @param {string} label - Authored visible control label.
   * @param {string} min - Native minimum value string.
   * @param {string} max - Native maximum value string.
   * @param {string} step - Native stepping string.
   * @returns {HTMLInputElement} Owned input removed with its fieldset.
   */
  function range(label: string, min: string, max: string, step: string) {
    /** Owned visible native range label. */
    const field = document.createElement('label');
    field.append(document.createTextNode(label));
    /** Owned native range input, removed with its containing fieldset. */
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    field.append(input);
    group.append(field);
    return input;
  }
  /** Owned labelled current-position range. */
  const seek = range('Position in seconds', '0', '0', '0.1');
  /** Owned labelled native volume range. */
  const volume = range('Volume', '0', '1', '0.05');
  /** Owned visible native checkbox label. */
  const muteLabel = document.createElement('label');
  /** Owned native mute checkbox. */
  const mute = document.createElement('input');
  mute.type = 'checkbox';
  muteLabel.append(mute, document.createTextNode('Mute'));
  group.append(muteLabel);
  /** Owned visible native caption-selector label. */
  const captionLabel = document.createElement('label');
  /** Owned native select populated only with authored track labels/languages. */
  const captions = document.createElement('select');
  captionLabel.append(document.createTextNode('Captions'), captions);
  group.append(captionLabel, status);
  let destroyed = false,
    unsubscribe: () => void = () => {},
    captionKey = '';
  /** Exact native listener removal callbacks for setup rollback and destroy. */
  const removals: (() => void)[] = [];
  /** Owned injected accessibility attribute leases, destroyed in reverse order. */
  const props: {
    /** Release only owned listeners, prop leases, source/URL/timer or controls. Preserve host replacements and restore authored state only when the last helper value still matches.
     * @returns {void} Idempotent synchronous teardown; native async probes remain generation-fenced.
     */
    destroy(): void;
  }[] = [];
  /** Original authored media tabindex, restored only if helper state still matches. */
  const oldTab = media.getAttribute('tabindex');
  /** Original authored native controls attribute, restored without overriding host changes. */
  const oldControls = media.getAttribute('controls');
  /** Register one UI listener and retain an exact removal callback.
   * @param {EventTarget} target - Borrowed event target.
   * @param {string} name - Fixed DOM event name.
   * @param {EventListener} handler - Owned event callback.
   * @returns {void} Listener remains owned until setup rollback or destroy.
   */
  function event(target: EventTarget, name: string, handler: EventListener) {
    target.addEventListener(name, handler);
    removals.push(() => target.removeEventListener(name, handler));
  }
  /** Render an inert sanitized playback snapshot using native controls and textContent only.
   * @param {PlaybackSnapshot} view - Sanitized controller state; no source URL or arbitrary HTML.
   * @returns {void} Updates owned controls, authored caption choices and readable status.
   */
  function show(view: PlaybackSnapshot) {
    if (destroyed) {
      return;
    }
    play.textContent = view.state === 'playing' ? 'Pause' : 'Play';
    play.disabled =
      !view.variantId ||
      (!!view.error &&
        view.error !== 'PLAY_DENIED' &&
        view.error !== 'CAPTION_ERROR');
    seek.disabled = view.duration === null || !!view.error;
    seek.max = String(view.duration ?? 0);
    seek.value = String(view.time);
    volume.value = String(view.volume);
    mute.checked = view.muted;
    /** Caption-choice identity preventing needless select replacement during time updates. */
    const key = JSON.stringify(
      view.captions.map((t) => [t.index, t.label, t.language])
    );
    if (key !== captionKey) {
      captionKey = key;
      captions.replaceChildren();
      /** Owned explicit caption-off option. */
      const off = document.createElement('option');
      off.value = '';
      off.textContent = 'Off';
      captions.append(off);
      // Iterate only the bounded registered records or owned cleanup handles for this operation.
      for (const track of view.captions) {
        if (!track.label && !track.language) {
          continue;
        }
        /** Owned native caption option rendered with inert textContent. */
        const option = document.createElement('option');
        option.value = String(track.index);
        option.textContent = track.label || track.language;
        captions.append(option);
      }
    }
    captions.disabled = captions.options.length === 1;
    captions.value = String(view.captions.find((t) => t.showing)?.index ?? '');
    /** Fixed readable status or error message without private native details. */
    const message = (() => {
      if (view.error) {
        return {
          UNSUPPORTED_SOURCE: 'No supported registered source.',
          SOURCE_EXPIRED:
            'Source access expired. Request a new authorized source.',
          PLAY_DENIED: 'Playback could not start. Use Play to retry.',
          MEDIA_ERROR: 'Media could not be decoded or loaded.',
          CAPTION_ERROR: 'Captions could not be loaded.',
          CAPABILITY_UNAVAILABLE: 'Playback capability is unavailable.',
        }[view.error];
      } else {
        if (view.state === 'playing') {
          return 'Playing';
        } else {
          if (view.state === 'paused') {
            return 'Paused';
          } else {
            if (view.state === 'ended') {
              return 'Ended';
            } else {
              return '';
            }
          }
        }
      }
    })();
    if (status.textContent !== message) {
      status.textContent = message;
    }
  }
  /** Run a synchronous UI action and show a fixed unavailable message on failure.
   * @param {function} fn - Allowlisted controller action, never user-supplied executable source.
   * @returns {void} Does not expose private native exceptions in UI text.
   */
  function action(fn: () => void) {
    try {
      fn();
    } catch {
      status.textContent = 'This media control is currently unavailable.';
    }
  }
  try {
    host.append(group);
    props.push(
      options.accessibility.applyLabelledComponentProps(group, {
        label: options.label,
      })
    );
    props.push(
      options.accessibility.applyComponentProps(
        media,
        {
          describedBy: [media.getAttribute('aria-describedby'), status.id]
            .filter(Boolean)
            .join(' '),
        },
        { requireLabel: true }
      )
    );
    if (oldTab === null) {
      media.setAttribute('tabindex', '0');
    }
    if (options.hideNativeControls) {
      media.removeAttribute('controls');
    }
    event(play, 'click', () => {
      if (playback.getSnapshot().state === 'playing') {
        playback.pause();
      } else {
        void playback.play();
      }
    });
    event(seek, 'input', () => action(() => playback.seek(Number(seek.value))));
    event(volume, 'input', () =>
      action(() => playback.volume(Number(volume.value)))
    );
    event(mute, 'change', () => action(() => playback.mute(mute.checked)));
    event(captions, 'change', () =>
      action(() =>
        playback.captions(captions.value === '' ? null : Number(captions.value))
      )
    );
    event(media, 'keydown', (raw) => {
      /** Borrowed keyboard event; shortcuts apply only when media itself is the target. */
      const event = raw as KeyboardEvent;
      if (
        event.target !== media ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      /** Sanitized state projection without source URLs or platform error objects. */
      const view = playback.getSnapshot();
      if (event.key === ' ' || event.key === 'k') {
        event.preventDefault();
        if (view.state === 'playing') {
          playback.pause();
        } else {
          void playback.play();
        }
      } else if (
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) &&
        view.duration !== null
      ) {
        event.preventDefault();
        action(() =>
          playback.seek(
            (() => {
              if (event.key === 'Home') {
                return 0;
              } else {
                if (event.key === 'End') {
                  return view.duration!;
                } else {
                  return Math.max(
                    0,
                    Math.min(
                      view.duration!,
                      view.time + (event.key === 'ArrowRight' ? 5 : -5)
                    )
                  );
                }
              }
            })()
          )
        );
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        playback.volume(
          Math.max(
            0,
            Math.min(1, view.volume + (event.key === 'ArrowUp' ? 0.05 : -0.05))
          )
        );
      }
    });
    unsubscribe = playback.subscribe(show);
  } catch (error) {
    // Iterate only the bounded registered records or owned cleanup handles for this operation.
    for (const remove of removals) {
      remove();
    }
    unsubscribe();
    // Iterate only the bounded registered records or owned cleanup handles for this operation.
    for (const prop of props.reverse()) {
      prop.destroy();
    }
    if (oldTab === null && media.getAttribute('tabindex') === '0') {
      media.removeAttribute('tabindex');
    }
    if (
      options.hideNativeControls &&
      oldControls !== null &&
      !media.hasAttribute('controls')
    ) {
      media.setAttribute('controls', oldControls!);
    }
    group.remove();
    throw error;
  }
  return {
    element: group,
    /** Focus the real Play button while these controls remain mounted.
     * @returns {void} No positive tabindex or manufactured focus order is introduced.
     */
    focus() {
      if (!destroyed) {
        play.focus();
      }
    },
    /** Release only owned listeners, prop leases, source/URL/timer or controls. Preserve host replacements and restore authored state only when the last helper value still matches.
     * @returns {void} Idempotent synchronous teardown; native async probes remain generation-fenced.
     */
    destroy() {
      if (destroyed) {
        return;
      }
      /** Whether focus belonged to the controls before removing their owned DOM. */
      const hadFocus = group.contains(document.activeElement);
      destroyed = true;
      unsubscribe();
      // Iterate only the bounded registered records or owned cleanup handles for this operation.
      for (const remove of removals) {
        remove();
      }
      // Iterate only the bounded registered records or owned cleanup handles for this operation.
      for (const prop of props.reverse()) {
        prop.destroy();
      }
      if (oldTab === null && media.getAttribute('tabindex') === '0') {
        media.removeAttribute('tabindex');
      }
      if (
        options.hideNativeControls &&
        oldControls !== null &&
        !media.hasAttribute('controls')
      ) {
        media.setAttribute('controls', oldControls!);
      }
      group.remove();
      if (hadFocus) {
        let fallback: HTMLElement = media;
        try {
          fallback = options.returnFocus?.() ?? media;
        } catch {
          /* Focus callback failures must not strand playback ownership. */
        }
        if (fallback.isConnected) {
          fallback.focus();
        }
      }
    },
  };
}
