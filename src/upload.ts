/**
 * Upload engine — the URL-based XHR pipeline, the function-based transport
 * wrapper, batch bookkeeping, and upload kickoff. Cancellation and retry
 * live in `upload-control.ts`.
 */
import { DEFAULT_FIELD_NAME, DEFAULT_SUCCESS_DURATION, DEFAULT_UPLOAD_METHOD } from './constants'
import {
  clearSuccessTimer,
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
 * Advance the batch counter and pick the next state when the batch finishes.
 * Shared between URL-based and function-based upload finishers.
 */
export function advanceBatch(el: HTMLElement, instance: DropzoneInstance, errored: boolean): void {
  const batch = instance.uploadBatch
  if (!batch) return
  batch.done += 1
  if (errored) batch.errors += 1
  if (batch.done >= batch.total) {
    instance.uploadBatch = null
    if (batch.errors > 0) {
      setState(el, instance, 'error')
    } else {
      setState(el, instance, 'success')
      const duration = instance.opts.successDuration ?? DEFAULT_SUCCESS_DURATION
      clearSuccessTimer(instance)
      instance.successTimer = setTimeout(() => {
        instance.successTimer = null
        if (el.getAttribute('data-dropzone') === 'success') setState(el, instance, 'idle')
      }, duration)
    }
  }
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
  const xhr = new XMLHttpRequest()
  const method = config.method ?? DEFAULT_UPLOAD_METHOD
  const url = resolveVal(config.url, primary) as string

  xhr.open(method, url)
  if (config.withCredentials) xhr.withCredentials = true
  if (typeof config.timeout === 'number') xhr.timeout = config.timeout

  const headers = resolveVal(config.headers, primary) as Record<string, string> | undefined
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
      advanceBatch(el, instance, false)
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
      advanceBatch(el, instance, true)
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
    advanceBatch(el, instance, true)
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
    advanceBatch(el, instance, true)
  }

  xhr.onabort = () => {
    // Aborts come from cancel() or unmount. The caller has already cleared
    // `record.xhr` (and removed the records) before calling abort, so
    // `stillOwns()` is false. We still want to emit so the consumer can
    // update its UI, but the batch counter is intentionally NOT advanced —
    // cancel() and unmount own the post-cancel state transition.
    emitError(instance, files, { message: 'Upload aborted', aborted: true })
  }

  xhr.send(buildFormData(files, config))
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
    advanceBatch(el, instance, false)
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
    advanceBatch(el, instance, true)
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

  // New upload batch invalidates any pending success → idle clear and clears
  // a sticky error from the prior batch (so the user can see we've moved on).
  clearSuccessTimer(instance)

  for (const r of records) {
    r.status = 'uploading'
    r.xhr = null
    r.controller = null
    r.progressPercent = 0
    r.settled = false
  }
  // Take a snapshot for the CSS vars — kept independent from `uploadBatch`
  // (URL batched mode collapses to 1 XHR group but we still want files-pending
  // to reflect the file count).
  instance.progressBatch = records.slice()
  writeUploadVars(el, instance)

  if (typeof config === 'function') {
    instance.uploadBatch = { total: records.length, done: 0, errors: 0 }
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
  instance.uploadBatch = { total: groups.length, done: 0, errors: 0 }
  setState(el, instance, 'uploading')
  for (const group of groups) {
    for (const r of group) r.group = group
  }
  syncApiArrays(instance)

  for (const group of groups) {
    const xhr = sendUpload(el, instance, group, config)
    for (const r of group) r.xhr = xhr
  }
}

/** Create or reuse `pending` records for `files` and immediately start uploads. */
export function startUploads(el: HTMLElement, instance: DropzoneInstance, accepted: File[]): void {
  if (!instance.opts.upload || accepted.length === 0) return
  const records: FileRecord[] = accepted.map((file) => {
    const existing = instance.records.get(file)
    if (existing) {
      existing.status = 'pending'
      existing.xhr = null
      existing.controller = null
      existing.abortAnnounced = false
      existing.progressPercent = 0
      existing.settled = false
      return existing
    }
    const rec: FileRecord = {
      file,
      status: 'pending',
      xhr: null,
      controller: null,
      group: [],
      abortAnnounced: false,
      progressPercent: 0,
      settled: false,
    }
    instance.records.set(file, rec)
    return rec
  })
  startUploadsForRecords(el, instance, records)
}
