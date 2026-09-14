/**
 * Upload engine — the URL-based XHR pipeline, the function-based transport
 * wrapper, batch bookkeeping, and upload kickoff. Cancellation and retry
 * live in `upload-control.ts`.
 */
import { DEFAULT_FIELD_NAME, DEFAULT_SUCCESS_DURATION, DEFAULT_UPLOAD_METHOD } from './constants'
import {
  clearSuccessTimer,
  ensureRecord,
  hasFailed,
  hasInflight,
  setState,
  syncApiArrays,
  writeUploadVars,
  type DropzoneInstance,
  type FileRecord,
} from './state'
import type { UploadConfig, UploadError, UploadFn, UploadValueOrFn } from './types'

function resolveVal<T>(v: UploadValueOrFn<T> | undefined, file: File): T | undefined {
  if (v === undefined) return undefined
  return typeof v === 'function' ? (v as (f: File) => T)(file) : v
}

/**
 * Decide what to render in `onUploaded`.
 *
 * Default policy: if `Content-Type` contains `application/json` we attempt
 * `JSON.parse`. When no content-type header is sent we still try `JSON.parse`
 * — APIs that omit the header but still return JSON are common enough to be
 * worth supporting transparently. Malformed JSON falls back to the raw
 * `responseText` rather than throwing — surfacing the body unmodified is
 * more useful to the consumer than crashing the upload flow.
 */
function defaultParseResponse(xhr: XMLHttpRequest): unknown {
  const text = xhr.responseText ?? ''
  const ct = xhr.getResponseHeader?.('content-type') ?? ''
  const looksLikeJson = /application\/json/i.test(ct) || ct === ''
  if (!looksLikeJson || text === '') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function buildFormData(files: File[], config: UploadConfig): FormData {
  const fd = new FormData()
  const field = config.fieldName ?? DEFAULT_FIELD_NAME
  for (const f of files) fd.append(field, f)
  const extras = resolveVal(config.formDataExtras, files[0])
  if (extras) {
    for (const [k, v] of Object.entries(extras)) fd.append(k, v)
  }
  return fd
}

function applyHeaders(xhr: XMLHttpRequest, headers: Record<string, string> | undefined): void {
  if (!headers) return
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') continue
    xhr.setRequestHeader(name, value)
  }
}

/**
 * One file (or one batched group) just finished. Decide whether the zone as a
 * whole is finished, and with what.
 *
 * Every finisher calls this after it has written the outcome into the records
 * it owns — success deletes them, failure marks them `failed` — so the two
 * questions this asks are answered by the same map the api arrays are built
 * from. There is deliberately no counter: a counter has to be scoped to a
 * batch, and "which batch" is exactly the thing that stops being well-defined
 * the moment a second drop lands during an in-flight upload.
 */
export function settleUpload(el: HTMLElement, instance: DropzoneInstance): void {
  // Something else is still on the wire — including anything a later drop
  // started. Not finished, whatever this particular request did.
  if (hasInflight(instance)) return
  if (hasFailed(instance)) {
    setState(el, instance, 'error')
    return
  }
  setState(el, instance, 'success')
  const duration = instance.opts.successDuration ?? DEFAULT_SUCCESS_DURATION
  clearSuccessTimer(instance)
  instance.successTimer = setTimeout(() => {
    instance.successTimer = null
    if (instance.state === 'success') setState(el, instance, 'idle')
  }, duration)
}

function emitUploaded(instance: DropzoneInstance, files: File[], response: unknown): void {
  if (!instance.opts.onUploaded) return
  for (const f of files) instance.opts.onUploaded(f, response)
}

function emitError(instance: DropzoneInstance, files: File[], error: UploadError): void {
  if (!instance.opts.onError) return
  for (const f of files) instance.opts.onError(f, error)
}

/**
 * Build + send a single XHR for `records`. Per-file mode passes a single-element
 * array; batched mode passes the whole batch. Records are mutated in place to
 * track the XHR and the group; cancel/retry follow `record.xhr` to abort the
 * right request.
 *
 * The `stillOwns()` guard catches the cancel-then-network-event race: if cancel
 * cleared `record.xhr` (and called `xhr.abort()`) but the browser still fires
 * `onload` / `onerror` (because the response was already in transit), the guard
 * short-circuits so we don't double-emit or corrupt the batch counter.
 */
function sendUpload(
  el: HTMLElement,
  instance: DropzoneInstance,
  records: FileRecord[],
  config: UploadConfig,
): XMLHttpRequest {
  const files = records.map((r) => r.file)
  const primary = files[0]
  const method = config.method ?? DEFAULT_UPLOAD_METHOD

  // Everything the consumer supplies is resolved before the request object
  // exists, so a throwing `url` / `headers` / `formDataExtras` leaves no
  // half-built XHR behind — the caller catches it and fails the group.
  const url = resolveVal(config.url, primary) as string
  const headers = resolveVal(config.headers, primary) as Record<string, string> | undefined
  const body = buildFormData(files, config)

  const xhr = new XMLHttpRequest()
  xhr.open(method, url)
  if (config.withCredentials) xhr.withCredentials = true
  if (typeof config.timeout === 'number') xhr.timeout = config.timeout
  applyHeaders(xhr, headers)

  const stillOwns = (): boolean => records.length > 0 && records[0].xhr === xhr

  // Always attach progress — the listener drives both the optional `onProgress`
  // callback AND the `--dropzone-progress` CSS variable, so it must be wired
  // regardless of whether the consumer subscribed to the callback.
  xhr.upload.addEventListener('progress', (event: ProgressEvent) => {
    if (!stillOwns()) return
    if (!event.lengthComputable || event.total <= 0) return
    const raw = (event.loaded / event.total) * 100
    const percent = Math.max(0, Math.min(100, Math.round(raw)))
    for (const r of records) r.progressPercent = percent
    writeUploadVars(el, instance)
    if (instance.opts.onProgress) {
      for (const f of files) instance.opts.onProgress(f, percent)
    }
  })

  xhr.onload = () => {
    if (!stillOwns()) return
    const status = (xhr as XMLHttpRequest & { status: number }).status
    if (status >= 200 && status < 300) {
      const parse = config.parseResponse ?? defaultParseResponse
      const response = parse(xhr)
      emitUploaded(instance, files, response)
      for (const r of records) {
        r.xhr = null
        r.progressPercent = 100
        r.settled = true
        instance.records.delete(r.file)
      }
      writeUploadVars(el, instance)
      syncApiArrays(instance)
      settleUpload(el, instance)
    } else {
      const message = `Upload failed: HTTP ${status}`
      emitError(instance, files, { message, status })
      for (const r of records) {
        r.xhr = null
        r.status = 'failed'
        r.settled = true
      }
      writeUploadVars(el, instance)
      syncApiArrays(instance)
      settleUpload(el, instance)
    }
  }

  xhr.onerror = () => {
    if (!stillOwns()) return
    emitError(instance, files, { message: 'Network error' })
    for (const r of records) {
      r.xhr = null
      r.status = 'failed'
      r.settled = true
    }
    writeUploadVars(el, instance)
    syncApiArrays(instance)
    settleUpload(el, instance)
  }

  xhr.ontimeout = () => {
    if (!stillOwns()) return
    emitError(instance, files, { message: 'Upload timeout', timedOut: true })
    for (const r of records) {
      r.xhr = null
      r.status = 'failed'
      r.settled = true
    }
    writeUploadVars(el, instance)
    syncApiArrays(instance)
    settleUpload(el, instance)
  }

  xhr.onabort = () => {
    // Aborts come from cancel() or unmount. The caller has already cleared
    // `record.xhr` (and removed the records) before calling abort, so
    // `stillOwns()` is false. We still want to emit so the consumer can
    // update its UI, but the batch counter is intentionally NOT advanced —
    // cancel() and unmount own the post-cancel state transition.
    emitError(instance, files, { message: 'Upload aborted', aborted: true })
  }

  xhr.send(body)
  return xhr
}

/**
 * Run a function-based upload for a single file. Wires an `AbortController`
 * the directive controls (fired on unmount, `api.cancel()`, or `api.retry()`).
 *
 * Abort race: when the controller is aborted, the consumer's transport may
 * either reject with an abort-like error OR resolve normally (if it ignored
 * the signal). We check `controller.signal.aborted` after settling and
 * suppress the state-machine advancement in that case — `cancel()` and
 * unmount own state.
 */
async function sendUploadFn(
  el: HTMLElement,
  instance: DropzoneInstance,
  record: FileRecord,
  fn: UploadFn,
): Promise<void> {
  const file = record.file
  const controller = record.controller!

  const reportProgress = (percent: number): void => {
    if (controller.signal.aborted) return
    const safe = Number.isFinite(percent) ? percent : 0
    const clamped = Math.max(0, Math.min(100, Math.round(safe)))
    record.progressPercent = clamped
    writeUploadVars(el, instance)
    if (instance.opts.onProgress) instance.opts.onProgress(file, clamped)
  }

  try {
    const response = await fn(file, controller.signal, reportProgress)
    if (controller.signal.aborted) {
      // Cancelled mid-flight, but the consumer's transport ignored the signal
      // and resolved anyway. Emit `onError(aborted)` so the consumer sees a
      // uniform cancel notification regardless of transport cooperation. The
      // state machine was settled by `cancel()` / unmount; we don't touch it.
      // `abortAnnounced` is set by `abortAllUploads` (unmount path) to avoid
      // a duplicate emission — `cancel()` removes the record from tracking
      // but doesn't pre-announce, so the announce happens here for cancel.
      if (!record.abortAnnounced) {
        record.abortAnnounced = true
        instance.opts.onError?.(file, { message: 'Upload aborted', aborted: true })
      }
      return
    }
    instance.opts.onUploaded?.(file, response)
    record.progressPercent = 100
    record.settled = true
    writeUploadVars(el, instance)
    instance.records.delete(file)
    record.controller = null
    syncApiArrays(instance)
    settleUpload(el, instance)
  } catch (err) {
    if (controller.signal.aborted) {
      if (!record.abortAnnounced) {
        record.abortAnnounced = true
        instance.opts.onError?.(file, { message: 'Upload aborted', aborted: true })
      }
      return
    }
    const message = err instanceof Error && err.message ? err.message : 'Upload failed'
    instance.opts.onError?.(file, { message })
    record.controller = null
    record.status = 'failed'
    record.settled = true
    writeUploadVars(el, instance)
    syncApiArrays(instance)
    settleUpload(el, instance)
  }
}

/**
 * Kick off uploads for the given pending records and put the host into
 * `uploading` state. Records must already be in `instance.records` —
 * `startUploadsForRecords` mutates them into `uploading`.
 */
export function startUploadsForRecords(
  el: HTMLElement,
  instance: DropzoneInstance,
  records: FileRecord[],
): void {
  const config = instance.opts.upload
  if (!config || records.length === 0) return

  // A new batch invalidates any pending success → idle clear. It does NOT
  // clear a sticky error: pruning failed records belongs to the arrival of new
  // *files* (`processFiles`), because retry also lands here and retrying one
  // failed file must not discard the record for another.
  clearSuccessTimer(instance)

  for (const r of records) {
    r.status = 'uploading'
    r.xhr = null
    r.controller = null
    r.abortAnnounced = false
    r.progressPercent = 0
    r.settled = false
  }
  mergeProgressSnapshot(instance, records)
  writeUploadVars(el, instance)

  if (typeof config === 'function') {
    setState(el, instance, 'uploading')
    for (const r of records) {
      r.group = [r]
      r.controller = new AbortController()
    }
    syncApiArrays(instance)
    for (const r of records) {
      void sendUploadFn(el, instance, r, config)
    }
    return
  }

  const groups = config.batched ? [records] : records.map((r) => [r])
  setState(el, instance, 'uploading')
  for (const group of groups) {
    for (const r of group) r.group = group
  }
  syncApiArrays(instance)

  for (const group of groups) {
    // `url`, `headers` and `formDataExtras` may be consumer functions, and
    // `xhr.open`/`xhr.send` throw on their own (a malformed URL, a revoked
    // blob). A token-refresh callback that throws is the everyday case, and
    // before this the exception escaped all the way to the drop listener: the
    // zone stayed `uploading` forever, `onError` never fired, and the files
    // *after* this group in the same drop were never sent either.
    let xhr: XMLHttpRequest
    try {
      xhr = sendUpload(el, instance, group, config)
    } catch (err) {
      failRecords(el, instance, group, err)
      continue
    }
    for (const r of group) r.xhr = xhr
  }
}

/**
 * Fold `records` into the snapshot the CSS vars are computed from, keeping any
 * earlier record that has not settled yet.
 *
 * Replacing the snapshot outright is what made `--dropzone-progress` reset to 0
 * and `--dropzone-files-pending` under-report while an earlier drop was still
 * uploading: the bar described the newest drop and nothing else.
 */
function mergeProgressSnapshot(instance: DropzoneInstance, records: FileRecord[]): void {
  const previous = instance.progressBatch
  if (!previous) {
    instance.progressBatch = records.slice()
    return
  }
  const incoming = new Set(records)
  const carried = previous.filter((r) => !r.settled && !incoming.has(r))
  instance.progressBatch = [...carried, ...records]
}

/**
 * Turn a synchronous failure into a normal upload failure: the consumer hears
 * about it through `onError`, the files land in `api.failed` where retry can
 * reach them, and the state machine settles like any other error.
 */
function failRecords(
  el: HTMLElement,
  instance: DropzoneInstance,
  records: FileRecord[],
  err: unknown,
): void {
  const message = err instanceof Error && err.message ? err.message : 'Upload failed'
  emitError(instance, records.map((r) => r.file), { message })
  for (const r of records) {
    r.xhr = null
    r.controller = null
    r.status = 'failed'
    r.settled = true
  }
  writeUploadVars(el, instance)
  syncApiArrays(instance)
  settleUpload(el, instance)
}

/** Create or reuse `pending` records for `files` and immediately start uploads. */
export function startUploads(el: HTMLElement, instance: DropzoneInstance, accepted: File[]): void {
  if (!instance.opts.upload || accepted.length === 0) return
  const records = accepted.map((file) => ensureRecord(instance, file))
  startUploadsForRecords(el, instance, records)
}
