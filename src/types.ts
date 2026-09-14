/**
 * Public types — binding forms, validation, upload config, the imperative
 * DropzoneApi, and the top-level options.
 *
 * Leaf module: imports nothing.
 */
/** What the consumer hands the directive: either a bare handler or an options object. */
export type DropzoneBinding = DropzoneHandler | DropzoneOptions

/** Callback the consumer provides to receive validated, dropped files. */
export type DropzoneHandler = (files: File[]) => void | Promise<void>

/** Reasons a drop / paste can be rejected during validation. */
export type DropzoneRejectReason = 'type' | 'size' | 'count'

/** Payload of the rejection callback. `reasons` is cumulative (a single drop may fail multiple rules). */
export type DropzoneRejectEvent = {
  files: File[]
  reasons: DropzoneRejectReason[]
}

/** Current state attribute value reflected on `data-dropzone`. */
export type DropzoneState = 'idle' | 'active' | 'rejected' | 'uploading' | 'success' | 'error'

/** Where the `paste` listener attaches when `paste: true`. Default `'host'`. */
export type DropzonePasteScope = 'host' | 'document'

/**
 * Either a value, or a function of the file being uploaded. Lets consumers
 * compute a value per-file at upload time (e.g. fresh JWT in `headers`, or
 * a `url` that interpolates `file.name`).
 *
 * Batched uploads call the function once with the first file in the batch.
 */
export type UploadValueOrFn<T> = T | ((file: File) => T)

/** HTTP methods the directive will accept for upload. PUT/PATCH are common with S3 / preflighted CORS APIs. */
export type UploadMethod = 'POST' | 'PUT' | 'PATCH'

/**
 * Function-based upload. Lets consumers plug custom transports (S3 presigned
 * URLs, GraphQL multipart, axios, fetch + ReadableStream, gRPC, …). The
 * directive calls the function once per accepted file, awaits the promise,
 * surfaces the resolved value to `onUploaded` or rethrown errors to `onError`,
 * and drives the same `uploading` → `success` / `error` state machine as the
 * URL-based pipeline.
 *
 * - `signal` is fired on host unmount and via `api.cancel()`. Cooperative
 *   consumers should pass it to `fetch` / `axios.create({ signal })`.
 * - `onProgress` is optional — call it from 0..100 (clamped + rounded by the
 *   directive) to drive the directive-level `opts.onProgress(file, percent)`
 *   callback. Transports without a progress channel can simply omit calls.
 *
 * Generic on the resolved response so JSON-parsing consumers get a typed
 * `onUploaded(file, response: T)`.
 */
export type UploadFn<TResponse = unknown> = (
  file: File,
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
) => Promise<TResponse>

/**
 * URL-based upload configuration. The directive owns the XHR + FormData
 * pipeline; the consumer never instantiates a request.
 */
export type UploadConfig = {
  /** Endpoint URL. Pass a function of `file` to compute per-file URLs (e.g. S3 presigned variants). */
  url: UploadValueOrFn<string>
  /** HTTP method (default `'POST'`). */
  method?: UploadMethod
  /** Request headers. Pass a function of `file` for dynamic values (e.g. fresh JWT each call). `Content-Type` is set by the browser for FormData; don't override it. */
  headers?: UploadValueOrFn<Record<string, string>>
  /** Form-field name the file appears under (default `'file'`). */
  fieldName?: string
  /** Extra FormData fields appended alongside the file. Pass a function of `file` for dynamic values. */
  formDataExtras?: UploadValueOrFn<Record<string, string | Blob>>
  /** Combine all dropped files into a single XHR (default `false` → one XHR per file). */
  batched?: boolean
  /** Pass through to `XMLHttpRequest.withCredentials`. Use for cookie-auth cross-origin uploads. */
  withCredentials?: boolean
  /** XHR timeout in ms (`0` disables — default). */
  timeout?: number
  /**
   * Parse a successful XHR response into the value passed to `onUploaded`.
   *
   * Default: response is parsed as JSON when the response has `Content-Type: application/json`
   * (or when no content-type is sent but the body parses as JSON). Otherwise the raw
   * `responseText` is returned. Malformed JSON falls back to the raw string.
   */
  parseResponse?: (xhr: XMLHttpRequest) => unknown
}

/** Discriminated error fed to `onError`. `aborted` flags cancellation paths separately from network/server errors. */
export type UploadError = {
  message: string
  /** HTTP status (only present for non-2xx server responses). */
  status?: number
  /** True when the upload was cancelled — by `api.cancel()` or host unmount. */
  aborted?: boolean
  /** True when the XHR timed out. */
  timedOut?: boolean
}

/**
 * Progress payload — `loaded`/`total` are bytes; `percent` is `0..100` (integer).
 *
 * @deprecated Nothing in the package produces or accepts this. `onProgress` is
 * `(file: File, percent: number) => void`, and the directive never sees byte
 * counts for the function-transport path, so it cannot supply `loaded`/`total`.
 * It is still exported only because removing an exported type from a published
 * package is a breaking change; it will go in the next major. Type your handler
 * from `DropzoneOptions['onProgress']`.
 */
export type UploadProgressEvent = {
  file: File
  loaded: number
  total: number
  percent: number
}

/**
 * Discriminated success/error result. Generic on response shape so JSON-parsing consumers get a typed `.response`.
 *
 * @deprecated No callback or return value in the package is an `UploadResult`;
 * outcomes are delivered through `onUploaded(file, response)` and
 * `onError(file, error)`. Exported only until the next major, for the same
 * reason as `UploadProgressEvent`.
 */
export type UploadResult<TResponse = unknown> =
  | { ok: true; file: File; response: TResponse }
  | { ok: false; file: File; error: UploadError }

/**
 * Imperative API exposed via the `ref` option. Lets the consumer drive the
 * directive from outside the template — open the picker, push files through
 * the pipeline, cancel / retry in-flight uploads, and observe the file state
 * reactively.
 *
 * The api object itself is a Vue `reactive`, so `state` and the file arrays
 * trigger Vue reactivity in templates / computeds / watchers.
 */
export interface DropzoneApi {
  /** Current `data-dropzone` state. Reactive — re-renders templates that read it. */
  state: DropzoneState
  /**
   * Files validated and waiting in the queue. Reactive.
   * Populated only when `autoUpload: false` — files held until `api.upload()` is called.
   */
  pending: readonly File[]
  /** Files currently uploading (URL XHR in flight or function-based promise pending). Reactive. */
  uploading: readonly File[]
  /** Files whose upload failed. Retryable via `api.retry()`. Reactive. */
  failed: readonly File[]
  /**
   * Open the native file picker programmatically. Works whether or not
   * `clickToPick` is enabled — a hidden input is created on demand.
   * Picked files flow through the same validation + on() + upload pipeline.
   */
  open(): void
  /**
   * Run files through the full pipeline (validation + on() + upload).
   * - No argument: starts upload for everything in `pending` (useful with `autoUpload: false`).
   * - File / File[]: treats the input like a drop — validates, fires `on()`, kicks off upload.
   */
  upload(files?: File | File[]): void
  /**
   * Cancel uploads in flight.
   * - No argument: aborts every in-flight upload (URL XHRs and function-based AbortControllers).
   * - File argument: cancels just that file. In batched URL mode the whole batch is cancelled
   *   (a single XHR carries all files — aborting it stops every file in the request).
   * Cancelled files are removed from tracking. They do NOT land in `failed`.
   *
   * A file that is only *queued* (`autoUpload: false`, still in `api.pending`)
   * has no request to abort — `cancel(file)` simply discards it, which is the
   * "remove from queue" lever a review-before-upload UI needs. `cancel()` with
   * no argument only touches uploads in flight and leaves the queue alone.
   */
  cancel(file?: File): void
  /**
   * Retry failed uploads.
   * - No argument: retries every failed file.
   * - File argument: retries just that file (in batched URL mode, retries its whole batch).
   * Retry re-runs the configured upload pipeline against the file(s).
   */
  retry(file?: File): void
  /**
   * Clear the sticky `error` state. Drops failed files from tracking; state
   * transitions to `idle` (or `uploading` if some files are still in flight).
   * After `dismissError()`, retry is no longer possible — call `retry()` first
   * if you want to give the user a chance.
   */
  dismissError(): void
}

/**
 * Ref-like target the directive will populate with its imperative API.
 * Pass `ref<DropzoneApi>()` from `setup()`. The directive sets `.value` to
 * the api object on mount and clears it (sets to `undefined`) on unmount.
 *
 * Typed as a writable `{ value }` so Vue's `Ref<DropzoneApi | undefined>`,
 * `shallowRef`, or even a plain object can be used as the target.
 */
export interface DropzoneApiRef {
  value: DropzoneApi | null | undefined
}

/** Top-level options accepted by the directive. */
export type DropzoneOptions = {
  /** Accept pattern: `image/*`, `image/png,image/jpeg`, `.pdf,.docx` (case-insensitive). */
  accept?: string
  /** Allow more than one file (default `true`). When `false`, a multi-file drop is rejected with reason `'count'`. */
  multiple?: boolean
  /** Per-file size cap in bytes. */
  maxSize?: number
  /**
   * File count cap **for a single drop / paste / pick**, not a running total.
   * Two drops of `maxCount` files each both pass; nothing consults what the
   * zone already holds. Exceeding it rejects the whole event with reason
   * `'count'`. A running cap over `api.pending` is the consumer's to enforce
   * today — see the README's `maxCount` note.
   */
  maxCount?: number
  /** Handler invoked with the validated `File[]` on drop / paste / pick. */
  on?: DropzoneHandler
  /** Invoked when validation rejects (with cumulative reasons). */
  onReject?: (event: DropzoneRejectEvent) => void
  /** Auto-clear time for `data-dropzone="rejected"` → `"idle"` (default `1500` ms). */
  rejectDuration?: number
  /**
   * Clicking the host (or any non-interactive descendant) opens the picker
   * `<input type="file">`. `accept` / `multiple` flow through to it.
   *
   * **Default `true`** — a dropzone you cannot click is a dropzone half the
   * users cannot use, and drag-and-drop has no keyboard story at all. Pass
   * `false` to opt out: the zone stays drag/paste-only, the picker input is
   * not created at mount, and `api.open()` still works (it builds the input
   * on demand and keeps it out of the tab order).
   *
   * Clicks on interactive descendants keep their own semantics — see
   * `clickIgnore` for anything the built-in list cannot see.
   */
  clickToPick?: boolean
  /**
   * Extra CSS selector for descendants whose clicks must NOT open the picker,
   * merged with the built-in interactive list (`button`, `a`, `input`,
   * `select`, `textarea`, `label`, `[contenteditable]`, `[tabindex]` other
   * than `-1`, `[role="button"]`, `summary`, `audio`/`video[controls]`).
   *
   * For custom clickables that list cannot see — a chip's remove affordance,
   * a preview thumbnail, a card that navigates on click:
   * `clickIgnore: '.file-chip, [data-remove]'`. A match anywhere up the
   * ancestor chain suppresses the pick, so nested icons are covered.
   *
   * Must be a valid CSS selector. Matching the host itself has no effect —
   * use `clickToPick: false` to turn the whole affordance off.
   */
  clickIgnore?: string
  /**
   * Accessible name for the picker `<input type="file">` — the control Tab
   * lands on and the one a screen reader announces. Defaults to
   * `'Choose files'`, or `'Choose file'` when `multiple: false`.
   *
   * The input is visually hidden (clipped, not `display: none`) so it stays
   * focusable: it is the only keyboard route into click-to-pick, since HTML5
   * drag-and-drop has none. Name it for the zone's job — `'Choose a CV'`,
   * `'Add receipts'` — when the surrounding text alone would leave it vague.
   */
  pickerLabel?: string
  /** Attach a `paste` listener so clipboard files (e.g. screenshots) flow through the same pipeline. Default `false`. */
  paste?: boolean
  /**
   * Where the paste listener attaches when `paste: true`.
   *  - `'host'` (default): only paste events on the host or its descendants are consumed.
   *    A plain `<div>` isn't focusable, so the user must focus a descendant first.
   *    iOS Safari does NOT fire `paste` for images outside `<input>` / `<textarea>` — pick
   *    `'document'` if you need to support iOS or paste-anywhere flows.
   *  - `'document'`: catch pastes anywhere on the page. Use this for "paste screenshot to upload" flows.
   */
  pasteOn?: DropzonePasteScope
  /**
   * Built-in upload pipeline. Pass either:
   *  - a `UploadConfig` object — directive owns XHR + FormData (`url`, `method`, `headers`, `fieldName`, `formDataExtras`, `batched`, …).
   *  - a `UploadFn` async function — `(file, signal, onProgress?) => Promise<T>`. Use for S3 presigned URLs, axios, fetch, GraphQL multipart, any custom transport.
   *
   * Either shape drives the same `uploading` → `success`/`error` state machine
   * and the same `onProgress` / `onUploaded` / `onError` callbacks. Style via
   * `[data-dropzone="uploading"]` etc.
   */
  upload?: UploadConfig | UploadFn
  /** Per-file progress callback, fired with the file and an integer percent (`0..100`). Only fires when the server supplies `Content-Length`. */
  onProgress?: (file: File, percent: number) => void
  /** Per-file success callback, fired with the file and the parsed response body. */
  onUploaded?: (file: File, response: unknown) => void
  /** Per-file error callback, fired with the file and a structured error (`status`, `aborted`, `timedOut`). */
  onError?: (file: File, error: UploadError) => void
  /** Auto-clear time for `data-dropzone="success"` → `"idle"` (default `1500` ms). `error` is sticky and never auto-clears. */
  successDuration?: number
  /** Activate the directive. Default `true`. */
  enabled?: boolean
  /**
   * Vue ref the directive populates with the imperative API on mount.
   * `api.value.open()`, `api.value.cancel()`, `api.value.state`, etc.
   * Cleared (`value = undefined`) on unmount. Swap-safe across reactive updates.
   */
  ref?: DropzoneApiRef
  /**
   * Auto-start uploads as soon as files are validated. Default `true`.
   * When `false`, accepted files queue into `api.pending` and the directive
   * waits for `api.upload()` to trigger the upload pipeline. Has no effect
   * when no `upload` is configured (files always flow through `on()` immediately).
   */
  autoUpload?: boolean
}
