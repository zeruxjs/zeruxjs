# Private media

Stream bounded uploads and private downloads without treating the store as a public file server.


## Storage choices

The legacy local media store uses random IDs, disk files and metadata. For multi-host storage use the files-backed integration and a shared authorized backend. Neither option supplies application login or tenant permission automatically.

```ts
import { createMediaStore, uploadMediaRequest, createMediaResponse } from '@zeruxjs/media';
const media = createMediaStore('/srv/private/media', 20 * 1024 * 1024);
// Authenticate and authorize the caller before these operations.
const record = await uploadMediaRequest(media, request, {
  name: 'report.pdf', maxBytes: 8 * 1024 * 1024
});
const response = await createMediaResponse(media, record.id, { request });
```

## Upload contract

The helper streams raw request bytes; it does not parse multipart/form-data. It checks maximum bytes and declared length. The application owns MIME validation, compression policy, malware scanning, quotas and permission to create the destination object.

## Downloads and integrity

HTTP helpers support HEAD, ETags, conditional requests and single/suffix ranges, with private no-store defaults. Full download verifies SHA-256; streamed partial reads verify size but do not compute a complete digest before emitting data. Restrict inline rendering to trusted inert types.

## Capabilities and listing

Signed media tokens are short-lived capabilities with an application signing key, not user authentication. For client-facing files-backed metadata use statAuthorized/listAuthorized. Partition tenant listings by bucket/key prefix when complete authorized pagination matters. Schedule expiration cleanup and keep storage outside public directories.

## Install and select the integration

```sh
npm install @zeruxjs/media@0.0.4
```

There is no automatic `media` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Choose the legacy private disk store or the files-backed service deliberately. The disk store uses random IDs, bounded raw uploads and integrity metadata; a files-backed service integrates named object storage and authorization. Authenticate before handling raw request bytes. The upload helper is not a multipart parser.

## TypeScript: inputs, results and ownership

```ts
import { createMediaStore } from '@zeruxjs/media';

type Inputs = Parameters<typeof createMediaStore>;
type Result = Awaited<ReturnType<typeof createMediaStore>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createMediaStore>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Default responses are private/no-store. Do not force arbitrary HTML or executable content inline. A signed token is a capability with its own lifetime, not a login. Expired-file cleanup needs an owned schedule, and local directories do not provide shared storage across hosts. Use authorized metadata/list APIs for client responses; older trusted server methods do not perform caller authorization.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### MediaRequestUploadOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `name` | `string` | Yes |
| `maxBytes` | `number` | Yes |
| `expiresInMs` | `number` | Yes |

### MediaResponseOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `request` | `Request` | Yes |
| `downloadName` | `string` | Yes |
| `inline` | `boolean` | Yes |
| `cacheControl` | `string` | Yes |

### MediaFilesOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `storage` | `string` | Yes |
| `bucket` | `string` | No |
| `prefix` | `string` | Yes |
| `maxUploadBytes` | `number` | Yes |
| `visibility` | `'private'\|'public'` | Yes |
| `authorize` | `(request: Request, address: FileAddress, action: 'read'\|'write'\|'delete', info?: FileInfo) => boolean\|Promise<boolean>` | Yes |

### UploadOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `name` | `string` | No |
| `contentType` | `string` | No |
| `expiresInMs` | `number` | Yes |
| `maxBytes` | `number` | Yes |

### ListOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `includeExpired` | `boolean` | Yes |
| `limit` | `number` | Yes |
| `offset` | `number` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/media@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./assets": {
      "types": "./dist/assets.d.ts",
      "default": "./dist/assets.js"
    },
    "./resumable": {
      "types": "./dist/resumable.d.ts",
      "default": "./dist/resumable.js"
    },
    "./browser": {
      "types": "./dist/browser.d.mts",
      "import": "./dist/browser.mjs",
      "default": "./dist/browser.mjs"
    },
    "./playback": {
      "types": "./dist/playback.d.mts",
      "import": "./dist/playback.mjs",
      "default": "./dist/playback.mjs"
    },
    "./transcode": {
      "types": "./dist/transcode.d.ts",
      "default": "./dist/transcode.js"
    },
    "./dist/*": "./dist/*",
    "./package.json": "./package.json"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/files": "0.0.4"
  },
  "peerDependencies": {
    "@zeruxjs/asset-manager": "0.0.4"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/media

Private, disk-backed binary media storage. Random UUID filenames, bounded uploads, SHA-256 metadata, expiration, signed access tokens and streaming are maintained by the store. This package is **not** a public static-file server; authentication and access-policy checks belong to the application.

```ts
import { createMediaStore, uploadMediaRequest, createMediaResponse } from '@zeruxjs/media';

const media = createMediaStore('/srv/private/media', 20 * 1024 * 1024);
// Authenticate and authorize this upload BEFORE passing its request to the store.
const record = await uploadMediaRequest(media, request, {name:'report.pdf',maxBytes: 8 * 1024 * 1024});
// Verify this user has permission to read record.id before creating the response.
const response = await createMediaResponse(media, record.id, {request});
```

`upload()`, `uploadStream()`, `download()` (SHA-256 integrity verified), `stream()` / `streamRange()`, `info()`, `exists()`, `remove()`, `list({limit,offset,includeExpired})`, and `cleanupExpired()` remain available.

`createMediaResponse()` supports GET and HEAD, conditional `If-None-Match` (304), byte-range and suffix-range downloads (206 or 416), `If-Range`, `ETag`, `Last-Modified`, `Accept-Ranges`, safe attachment filenames, and default `private, no-store`. Set `inline:true` **only** for application-trusted content. Streaming uses bounded reads from a file descriptor opened without following symlinks, and handles response cancellation. Partial/streamed downloads check size, but **do not compute the SHA-256 digest**; use `download()` if complete integrity verification is required before exposing bytes. A mutated media file can still change during streaming.

`uploadMediaRequest()` streams raw request bytes directly to the store with maximum-size and reported-length validation; it does not parse `multipart/form-data`. Reject compressed request bodies; decompress separately under a bounded policy if needed. Callers control MIME validation, malware scanning and user quotas.

`createSignedMediaToken()` / `verifySignedMediaToken()` create short-lived capabilities using an application-owned signing key (at least 16 bytes). These are not authentication. Store media outside web roots, keep access-control checks on download routes, protect the signing secret and schedule expired-file cleanup. A local directory is not shared storage for multiple hosts.

### HTTP safety

For the files-backed media service, use `statAuthorized(id, request)` and `listAuthorized(request, {limit,cursor})` when returning metadata to clients. Both call `authorize` per object, suppressing a backend continuation cursor when unauthorized objects were encountered. For complete paginated tenant listings, partition by bucket/key prefix; the older `stat`/branch/v0.0.4/`list` methods are server-trusted only. The request upload helper validates declared length during streaming, bounds source reads to 65536 chunks and cancels/releases its reader on failure; legacy media inline responses allow only inert MIME types and force potentially executable content to download.

## Optional asset catalog adapter

`@zeruxjs/media/assets` exports `createMediaAssetService({assets,identify,authorizeRequest,maxPending?})`. Inject an existing `createAssetStorage` result from `@zeruxjs/asset-manager/storage`; install the matching optional asset-manager peer when using this entry. Root disk/files services keep their existing APIs and do not import asset-manager. The host owns/ closes both borrowed services after media drains.

`identify(request)` supplies a verified tenant/principal; `authorizeRequest(request)` must explicitly permit each operation and apply origin/CSRF rules to cookie-authenticated writes. No forwarded header or signed URL is treated as identity. The underlying asset adapter independently authorizes each asset action. `upload(request,input)` takes the asset adapter's `{asset,size,sha256,contentType,previousVersionId?,expectedRevision?}` and a raw POST/PUT body. It enforces Content-Length/MIME/encoding and a 65536-chunk reader limit, and delegates byte/hash verification, create-only storage commit, readback and immutable catalog publication. Variant names/metadata register only with the successful asset record; no image conversion or independent variant-binary generation is implied. Separate variant binaries need their own authorized commits/references.

`register(request,input,address)` requires POST and borrows a precommitted tenant-scoped file through the asset adapter. `metadata(request,assetId)` returns authorized history with name/type/size/hash, version/asset IDs, retirement status and variant **names**. It omits binary addresses, metadata, URLs and signed variant URLs. `download(request,assetId,versionId)` requires history plus exact-version read permission and verifies complete bytes before returning an attachment response (or HEAD). This path uses the asset adapter's bounded buffering; use the existing files-backed streaming response for large files. `remove(request,versionId,{binary,expectedRevision?})` requires DELETE and preserves owned/borrowed/reference guards.

Failure handling is inherited deliberately: input/hash failure publishes no catalog record; a lost storage acknowledgement or revision conflict can leave a binary. The service never blindly deletes it. `previewRepair(request,page?)` and `repair(request,candidates)` expose the asset adapter's authorized, approval-gated repair (POST only) to **trusted administrative code**, not public metadata routes. They contain private storage addresses. Binary deletion still requires exclusive namespace ownership; there is no cross-resource transaction or conditional-delete guarantee. `close()` rejects new calls and drains actual settlement without closing the injected asset service/files. Default pending calls: four, maximum 64.

## Browser transfers

The ESM-only `@zeruxjs/media/browser` entry imports no Node/server modules. It performs no network, DOM or object-URL work on import. `createMediaTransfers` accepts a trusted `baseUrl`, optional injected Fetch and exact `allowedOrigins` (maximum 32). Without an allowlist only the current browser origin is permitted. Destinations stay within the configured origin/base path; redirects use `error`, and credentials stay `same-origin`. Cross-origin authorization/CORS, CSP and CSRF headers are host policy; inject Fetch to add an explicitly supplied CSRF token. Never build the allowlist from an untrusted download URL.

```ts
import {createMediaTransfers} from '@zeruxjs/media/browser';

export async function transferReport(
  sink: WritableStream<Uint8Array>, signal: AbortSignal,
  fetcher: typeof fetch = fetch
) {
  const transfers = createMediaTransfers({baseUrl: '/media/', fetch: fetcher});
  try {
    return await transfers.downloadTo('report', sink, {
      signal, maxBytes: 1024 * 1024 * 1024,
      onProgress: ({loaded,total}) => { void loaded; void total; }
    });
  } finally { await transfers.close(); }
}
```

`downloadTo(path,writable,{signal,maxBytes?,onProgress?})` forwards bounded chunks with WritableStream backpressure, validates a declared length and closes the sink. Failure/cancellation cancels the source and aborts/releases the sink. Default ceiling: 1 GiB, maximum 65536 chunks. Encoded responses reject because decoded Fetch bytes cannot reliably be compared to an encoded Content-Length. Missing length is allowed under the byte ceiling. Streamed bytes may reach the sink **before** a later length/hash problem; this mode does not calculate SHA-256.

`downloadAttachment(path,name,document?)` activates a temporary native anchor and removes it immediately; it does not Fetch/buffer the object or own the browser's subsequent navigation/download. The server must authorize and send Content-Disposition; the download attribute is a hint, particularly across origins. Use this from a user action. It is not a JavaScript transfer with cancellable progress.

`downloadBlob(path,{maxBytes,sha256?,signal?,onProgress?})` is explicitly buffered, requires a positive ceiling up to 64 MiB, and optionally checks a caller-provided SHA-256 with Web Crypto **after completion but before returning the Blob**. A response header alone is not a trusted expected digest. `objectUrl(blob)` then explicitly creates a `{url,revoke()}` lease; call `revoke()` when the consumer no longer needs it. At most 32 leases are retained; close revokes all, once. No automatic URL is created for downloads and no arbitrary timeout guesses when a viewer is finished. Blob MIME/HTML safety and rendering policy remain the host's responsibility.

`upload(path,blobOrStream,{size,contentType,signal?,onProgress?,method?})` streams a request with an exact size check and feature-detected `duplex:'half'`. It does not silently buffer/fallback on unsupported browsers. Progress counts bytes pulled by Fetch, **not server-acknowledged storage bytes**. Treat the returned response as the server's acknowledgement; its body remains caller-owned. The host must validate the body on the server too. Chrome request-stream restrictions, proxies, HTTP versions and other browsers need separate qualification. See the [Fetch standard](https://fetch.spec.whatwg.org/), [Chrome request-stream guidance](https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests), [File API URL ownership](https://www.w3.org/TR/FileAPI/) and [Web Crypto digest API](https://www.w3.org/TR/webcrypto/).

Up to four client operations run at once (maximum 64). `close()` rejects new work, signals active requests, revokes URLs and waits for actual settlement. A noncooperating injected transport cannot be force-cancelled. Progress callback exceptions propagate while releasing owned resources. No credentials, private bodies or URLs are sent to progress callbacks; there is no global transfer registry.

## Explicit resumable protocol

`@zeruxjs/media/resumable` supplies an inert `createMediaResumableHandler` over the files-owned `ResumableUploads` contract. Configure a fixed path prefix, verified `identify`, mandatory `authorizeRequest`, server-owned `destination`, explicit MIME allowlist and matching byte/part policies. Register `.handle(request)` in your own server; it starts no listener and configures no CORS or authentication provider. The destination callback must derive the bucket/key from verified tenant policy, never a client-supplied address. Native S3 prerequisites/create-only/checksum limits remain those of files. Defaults are 5 MiB parts, 1 GiB total and eight pending calls (maximum 64); configure parts at least 5 MiB for multi-part native S3 and keep part size/provider mappings stable across resume. Host request/SDK deadlines must be supplied through cooperative signals; pending slots persist until settlement.

The versioned `zerux-media-resumable-v1` protocol is intentionally narrow:

| Path relative to configured prefix | Method | Body/operation |
| --- | --- | --- |
| empty | POST | Bounded JSON `{name,size,sha256,contentType}`; initiate a tenant/principal-bound session |
| `/:id` | GET | Inspect status and accepted part numbers/sizes/hashes |
| `/:id/parts/:number` | PUT | Raw bytes, `application/octet-stream`, `X-Media-Part-Size`, `X-Media-Part-SHA256` |
| `/:id/complete` | POST | Bounded JSON `{parts:[1,2,...,N]}` |
| `/:id` | DELETE | Explicit session abort/part cleanup |

Public session responses contain opaque IDs, expiry, status, total length/hash, fixed part size and accepted hashes; they omit addresses, native IDs and ETags. JSON bodies are limited to 8192 bytes, unknown/prototype fields reject, and errors use fixed sanitized codes. Optional `onError(cause,{committed})` is trusted internal diagnostics, never a client payload/logging policy. File-layer tenant binding and authorization run on every operation. Finalization rechecks ordered parts and **whole-file SHA-256 before commit**; each part is verified before acceptance. The server computes no hash from an AbortController.

Browser methods `initiateSession`, `getSession`, `uploadSession`, `finalizeSession` and `abortSession` use only this protocol. `uploadSession(path,id,blob,{sha256,signal,onProgress?})` obtains the saved session, hashes bounded Blob slices with Web Crypto, checks already-accepted parts against the selected Blob, and sends only missing parts. The expected whole-file hash is supplied separately and verified by the server at finalization; the browser does not buffer/hash the entire file to invent that value. No transparent retry or automatic finalization is performed. Persist the ID/hash/file selection in application-owned state as appropriate.

Aborting a request stops that transfer attempt and leaves accepted parts resumable; it does **not** abort the server session. Use `abortSession` for deliberate abandonment. Wrong files/tenants, expiry and changed accepted parts reject. After a lost completion response, inspect `getSession` and reconcile rather than blindly repeat a side effect. The files journal's explicit approved cleanup handles abandoned sessions; media adds no competing cleanup scheduler or stale-lock breaking.

Optional `onCommitted(identity,id,info)` can register asset metadata **after** binary finalization. It must be durably idempotent per tenant/session and return `{assetId,versionId}`; duplicate finalize calls can invoke it again. The handler does not manufacture a durable deduplication store. Failures after binary commit return `METADATA_AFTER_COMMIT_FAILED` with `committed:true`; files-layer uncertain completion returns `committed:'unknown'`. Do not automatically retry an ambiguous mutation. Registering a resumable file through asset-manager borrows it; files/host remain binary owners, so explicitly define deletion/repair outside that borrowed reference. If no callback is configured, this protocol commits bytes only and makes no catalog claim.

Focused tests exercise actual disposable local stores, metadata denial/redaction, partial-body cancellation, hash mismatch, browser Web Streams/Blob/URL leases with injected transports, interrupted/resumed sessions, wrong tenants and failed postcommit metadata. These Node Web API fixtures are not live-browser or live S3/MinIO acceptance. Native attachment UI, CORS/proxy request streaming, durable callback deduplication and production orphan reconciliation remain host/live prerequisites.

## Playback controller and optional controls

The browser-only ESM `@zeruxjs/media/playback` entry exports `createMediaPlayback`, `createMediaControls` and their types. It is independent of the Node store and performs no DOM or media work on import. Construct a controller with an **empty**, non-autoplay audio/video element: no `src`, `<source>`, active `currentSrc` or `srcObject`. One controller owns it at a time. Existing authored `<track>` elements remain host-owned.

```ts
import {createMediaPlayback, createMediaControls} from '@zeruxjs/media/playback';
import type {PlaybackAccessibility} from '@zeruxjs/media/playback';

export async function mountLesson(
  media: HTMLVideoElement, host: HTMLElement,
  accessibility: PlaybackAccessibility,
  authorizedSource: {url: string; expiresAt: number}
) {
  const player = createMediaPlayback(media, {variants: [{
    id: 'lesson', contentType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    source: authorizedSource
  }]});
  let controls: ReturnType<typeof createMediaControls> | undefined;
  try {
    controls = createMediaControls(host, player, {
      label: 'Lesson playback', accessibility, hideNativeControls: true,
      returnFocus: () => media
    });
    await player.select('lesson'); // Shows an error when unsupported; never autoplays.
    return () => { controls?.destroy(); player.destroy(); };
  } catch (error) { controls?.destroy(); player.destroy(); throw error; }
}
```

In a host bundle pass the actual `applyLabelledComponentProps` and `applyComponentProps` exports from `@zeruxjs/accessibility` as the `accessibility` object. No duplicate accessibility implementation or browser import of its CommonJS build is injected automatically. Start with authored markup such as `<video controls aria-label="Lesson playback"><track kind="captions" label="English" srclang="en" src="/media/lesson-captions"></video>` and a separate controls host. Native controls remain a no-JavaScript fallback; optional hiding is compare-and-restored on controls teardown. The host must provide correct captions, transcripts/audio description where needed, authorized caption URLs and appropriate CORS/CSP. These helpers do not certify the content or WCAG conformance.

Register 1–32 variants with stable nonsecret IDs, exact audio/video MIME/codec strings and either `{url,expiresAt?}` or `{blob}` sources. URL origins default to the document origin; approve other exact origins explicitly with `allowedOrigins` (maximum 32). Opaque origins permit owned Blobs but need explicit approval for HTTP(S). URLs reject credentials/control characters/fragments; this checks the **initial** URL only. Native media redirects/network behavior require host CSP `media-src`, server redirect and egress policy. A browser allowlist is not server authorization.

`probe(signal?)` reports `canPlayType` and, when audio/video dimensions/bitrate/sample metadata are supplied, native/injected `MediaCapabilities.decodingInfo`. A reported unsupported capability excludes that source. Missing/throwing capability probes retain the documented canPlayType fallback with `probeFailed`; neither `maybe` nor `probably` proves successful decoding. For paired audio/video capabilities supply each stream's own `contentType`; otherwise it defaults to the variant type and must match that stream's audio/video family. At most four probes remain pending per controller. `select(id?,signal?)` selects only registered supported, unexpired sources in registration order, fencing stale asynchronous selections. It stops/releases the previous source first and never starts playback. No error triggers automatic source URL refresh, codec installation or transcoding. MKV is a **container**; extension/container names cannot establish which encoded streams a browser supports. No universal MKV/MP4/WebM or DRM/live-stream support is promised. See [Media Capabilities](https://www.w3.org/TR/media-capabilities/) and [WAI media-player guidance](https://www.w3.org/WAI/media/av/player/).

`play()` observes the native promise, reports `PLAY_DENIED` safely and permits an explicit retry; `pause`, `seek`, `volume`, `mute` and `captions(index|null)` validate their values. Seeking needs finite duration and valid seekable ranges. Caption selection controls existing caption/subtitle tracks, up to 32, preserving their previous modes on disposal unless the host changed them. Unlabelled tracks are not given invented language names by the UI. `getSnapshot`/branch/v0.0.4/`subscribe` expose local time/duration, state, volume and caption labels; listeners are scoped and bounded to 64. Live/infinite-duration seeking and codec repair are unavailable.

Optional controls require an authored media label/label reference, validated through the injected helper, and use native buttons, labelled range inputs, a mute checkbox, caption select, live error status and the injected accessibility relationship validator. Normal Tab/Shift+Tab/Enter/Space and native slider/select arrow behavior are preserved. Only when the media element itself has focus do Space/K toggle play, Left/Right seek five seconds, Home/End seek bounds, and Up/Down adjust volume. There are no page-wide shortcuts or positive tabindex. `.focus()` is explicit; teardown restores authored controls/descriptions/tabindex and uses `returnFocus` when controls owned focus. Status uses fixed text via textContent, never native error messages or source URLs. Focus outlines and reduced-motion/forced-color behavior remain native/host stylesheet responsibilities; no global filter or animation is added.

Supply the server-issued `expiresAt` for short-lived authorized/signed URLs. Known expired sources reject before `src` assignment; expiry of a selected source stops/clears it and reports `SOURCE_EXPIRED`. Without supplied expiry, a native load failure is only `MEDIA_ERROR`—the controller cannot inspect an HTTP 401/403 or infer a signature lifetime. To renew, obtain a newly authorized descriptor and create a new controller; no credential renewal happens automatically. Tokens/URL queries never enter `onEvent`, which receives only source/error type, fixed code and registered variant ID. Do not use a token as a variant ID. The local snapshot is not a telemetry exporter.

Blob sources create controller-owned object URLs only on selection; replacements/destroy release them after detaching the native source. Do not separately create a transfer-helper object URL for the same Blob. `destroy()` removes native/track listeners, timers, subscriptions, restores owned track modes, detaches its source and revokes its own URLs once. It does not remove authored tracks or revoke caption URLs the host created. Destroy controls before their controller; do not share/mutate the native source behind an active controller. Playback itself performs no whole-file integrity check: use the verified Blob/download path with a trusted expected hash when bytes must be checked before playback. Native streaming otherwise exposes data as the decoder receives it.

## Isolated transcoding hook

The explicit Node entry `@zeruxjs/media/transcode` provides `createMediaTranscoder`, `mediaTranscodePresets` and isolated-executor types. No encoder, subprocess, shell command, temporary directory, URL fetch or codec library is bundled or started. The host must supply a **qualified** process/container executor; capability declarations are a contract, not proof of OS enforcement. A missing/nonisolated executor fails configuration. Do not connect an in-process decoder while claiming isolation.

Allowed preset IDs are fixed: `mp4-h264-aac`, `webm-vp9-opus` and `webm-opus`, with their exported MIME/codec/extension descriptors. Configure a subset also supported by the installed executor. Caller input is exactly `{preset,bytes,sha256}` plus a verified `{tenant,subject}` and optional signal; unknown fields (including paths/arguments) reject. The host authorizer runs before process acquisition. Input SHA-256 is verified before execution. There is no API for caller-supplied executable names, codec options, filenames, shell strings, network URLs or arbitrary output paths. A browser may request one of these presets only through a separately authenticated/tenant-authorized host endpoint with its own rate/cost policy; playback does not call it automatically. Offer the resulting variant only if that configured pipeline actually produced it and the client capability check accepts its type.

The executor must declare process/container isolation, disabled network, job-private filesystem, unprivileged execution and hard CPU/memory/file quotas. `create({preset,quotas})` allocates a private job and must roll back any partial acquisition before rejecting. Its `run(bytes,signal)` resolves only after encoding ends and the child is reaped, returning a completed staged-output iterator and actual CPU/peak-memory/file statistics. `terminate()` must stop/reap the child and settle run/output work; `dispose()` must close/remove **all** private input/output artifacts on success and failure. Do not mount application files/credentials or allow decoder sidecar/network reads. The host owns OS/container enforcement, trusted executable installation, preset/profile mapping, file permissions, codec licensing and worker qualification.

Every quota is explicit: `maxInputBytes`/branch/v0.0.4/`maxOutputBytes` up to 64 MiB, `maxCpuMs` up to 120000, `maxWallMs` up to 300000, `maxMemoryBytes` up to 2 GiB and `maxFiles` up to 16. One job runs by default (maximum four), with no hidden queue. The coordinator validates input/output sizes and reported resource usage, bounds output chunks, signals wall deadline/cancellation, calls terminate for unsuccessful work and awaits disposal exactly once. It returns fully collected `{preset,contentType,extension,bytes,sha256}` only after successful cleanup. A failure or oversized result exposes no partial returned output. Cleanup failures reject `TRANSCODE_CLEANUP_FAILED`; causes remain private, and diagnostics emit only configured preset plus fixed complete/failed/cancelled status.

Timers/signals cannot force-cancel arbitrary JavaScript. Slots and `close()` retain ownership until the executor actually settles and disposal finishes, even after a deadline. Hard CPU/memory/filesystem limits depend on the host's real isolator, not its reported statistics. Persist/register returned output through the existing files/asset commit APIs only after success. No automatic variant publication, source overwrite, memory fallback or replay is added.

Qualification: Node DOM-emulation/executor-contract fixtures cover expiry, blocked play, caption selection, unavailable capabilities, quotas/failures/cancellation and teardown. Isolated **Google Chrome 156 Linux** checks exercise actual `audio/wav` signed 16-bit PCM mono 8 kHz playback, WebVTT caption loading, native keyboard controls, focus restoration and listener/Blob URL cleanup. The clip is silence; audible output and assistive technologies were not qualified. No MKV, H.264/VP9/Opus encoding, other browser/OS, hardware decoding or production process/container executor was exercised. Configure a real isolated encoder and test each advertised preset before production use; synthetic executor success is not live transcoding acceptance.


## Implementation sources

- [packages/@zeruxjs/media/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/media/README.md)
- [packages/@zeruxjs/media/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/media/package.json)
