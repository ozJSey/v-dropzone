/**
 * Per-element state — the instance shape, the WeakMap store, and every
 * reflection of that state onto the outside world: the `data-dropzone`
 * attribute, the `--dropzone-*` CSS variables, and the reactive api arrays.
 */
import type {
  DropzoneApi,
  DropzoneApiRef,
  DropzoneOptions,
  DropzoneState,
} from './types'

export type Listeners = {
  dragenter: (e: DragEvent) => void
  dragover: (e: DragEvent) => void
  dragleave: (e: DragEvent) => void
  drop: (e: DragEvent) => void
}

/** Per-file lifecycle status — the file is removed from tracking on success or cancel. */
type FileStatus = 'pending' | 'uploading' | 'failed'

/**
 * Per-file record. Tracks status + whichever cancellation primitive applies
 * to the active upload mode (XHR for URL-based, AbortController for
 * function-based). `group` is the set of sibling records that share the
 * same XHR — in URL-based batched mode all records in a batch reference each
 * other so cancel/retry on one cascades to the whole group; in per-file URL
 * mode and in function-based mode, group is always `[this]`.
 */
export interface FileRecord {
  file: File
  status: FileStatus
  xhr: XMLHttpRequest | null
  controller: AbortController | null
  group: FileRecord[]
  /**
   * True once `onError(aborted)` has been emitted for this record. Set by
   * `abortAllUploads()` when unmounting synchronously emits — guards against
   * a duplicate emission from `sendUploadFn`'s deferred settle path.
   */
  abortAnnounced: boolean
  /**
   * Last-known upload percent for this file (0–100, integer). Drives the
   * `--dropzone-progress` CSS variable. Set to `100` on success; on failure
   * the last reported percent is preserved so consumers can render
   * "Failed at 75%" UIs.
   */
  progressPercent: number
  /** True once the upload has fully ended (success, error, or timeout). Drives `--dropzone-files-pending`. */
  settled: boolean
}

export interface DropzoneInstance {
  opts: DropzoneOptions
  /** enter/leave counter — increments on dragenter, decrements on dragleave; the only signal that survives child-traversal phantom leaves. */
  dragDepth: number
  /** Pending auto-clear timer ID for the `rejected` → `idle` transition. */
  rejectTimer: ReturnType<typeof setTimeout> | null
  /** Pending auto-clear timer ID for the `success` → `idle` transition. */
  successTimer: ReturnType<typeof setTimeout> | null
  listeners: Listeners
  /** Visually-hidden `<input type="file">`. Appended at attach unless `clickToPick: false`, and on demand by `api.open()`. */
  pickerInput: HTMLInputElement | null
  /** Host-element click listener that opens the picker. Present unless `clickToPick: false` — its presence is what makes the input a tab stop. */
  pickerHostClick: ((event: MouseEvent) => void) | null
  /** `change` listener bound on the hidden picker input. */
  pickerChange: (() => void) | null
  /**
   * True while `anchor.ts` is the reason the host carries an inline
   * `position`. The picker input is absolutely positioned at the host's
   * top-left, which only means the *zone's* top-left if the host is the
   * input's containing block; on a `static` host it would otherwise resolve
   * against the initial containing block and Tab would scroll the page away
   * from the zone. Tracked so teardown reverts only a value the directive
   * wrote — a host that arrived positioned is never touched, and never
   * un-positioned.
   */
  pickerHostPositioned: boolean
  /** Paste listener if `paste: true`; bound on host or document depending on the active `pasteOn` value. */
  pasteListener: ((event: ClipboardEvent) => void) | null
  /** The exact target the paste listener was added to — remembered so teardown always removes from where it attached, even after `pasteOn` changes mid-lifecycle. */
  pasteTarget: HTMLElement | Document | null
  /**
   * **The** store of what this zone is doing. Keyed by `File` reference, it
   * drives `api.pending`/`uploading`/`failed`, it is what cancel/retry act on,
   * and — since 0.1.1 — it is the only thing the state machine counts. Records
   * are added when files arrive (drop/paste/pick/`api.upload`) and removed on
   * success, on cancel, on `dismissError()`, and by the next batch of arriving
   * files (the documented "a new drop reseeds the machine").
   *
   * Nothing else may hold a parallel tally of the same facts. A per-batch
   * counter used to live here alongside it and the two disagreed the moment a
   * second drop landed during an in-flight upload: the counter was overwritten,
   * the first drop's completions settled the *second* drop's total, and the
   * zone reported `success` with two files still on the wire — then swallowed
   * their failure, because the counter it would have been reported through was
   * already gone. `hasInflight` / `hasFailed` ask this map instead.
   */
  records: Map<File, FileRecord>
  /**
   * The reactive `DropzoneApi` object surfaced through `opts.ref`. Constructed
   * lazily on first attach and reused across reactive `opts` updates so the
   * consumer's `ref` keeps pointing at the same object — Vue computeds /
   * watchers don't re-fire on every directive `updated` hook.
   */
  api: DropzoneApi | null
  /** The most recently bound ref target, remembered so we can clear it on unmount or when the consumer swaps refs in `updated`. */
  ref: DropzoneApiRef | null
  /**
   * The state the directive last decided on, and the only place that decision
   * is remembered. `data-dropzone` on the consumer's host and `api.state` are
   * both *projections* written by `setState`; neither is ever read back to
   * find out what the zone is doing. (They were, in 0.1.0 — four transitions
   * branched on `el.getAttribute('data-dropzone')`, which made the consumer's
   * own DOM node load-bearing memory that anything on the page could rewrite.)
   */
  state: DropzoneState
  /**
   * Snapshot of the records the `--dropzone-progress` /
   * `--dropzone-files-pending` CSS variables currently describe. Distinct from
   * `records` because (a) URL batched mode has 1 XHR but N files (we want
   * files-pending=N), and (b) the snapshot outlives a successful record, which
   * is deleted from `records` on success, so the vars can hold 100% through the
   * `success`/`error` window.
   *
   * A new batch *merges* into it rather than replacing it: any record from an
   * earlier drop that has not settled yet is still on the wire and still has to
   * be counted, or the bar resets to 0 while files are uploading.
   */
  progressBatch: FileRecord[] | null
}

export const stateMap = new WeakMap<HTMLElement, DropzoneInstance>()

export function clearRejectTimer(instance: DropzoneInstance): void {
  if (instance.rejectTimer !== null) {
    clearTimeout(instance.rejectTimer)
    instance.rejectTimer = null
  }
}

export function clearSuccessTimer(instance: DropzoneInstance): void {
  if (instance.successTimer !== null) {
    clearTimeout(instance.successTimer)
    instance.successTimer = null
  }
}

/** True while at least one tracked file is still on the wire. */
export function hasInflight(instance: DropzoneInstance): boolean {
  for (const r of instance.records.values()) {
    if (r.status === 'uploading') return true
  }
  return false
}

/** True while at least one tracked file has failed and not been retried/dismissed. */
export function hasFailed(instance: DropzoneInstance): boolean {
  for (const r of instance.records.values()) {
    if (r.status === 'failed') return true
  }
  return false
}

/** True while the progress snapshot still describes something that is uploading. */
function snapshotIsLive(instance: DropzoneInstance): boolean {
  const batch = instance.progressBatch
  if (!batch) return false
  for (const r of batch) {
    if (!r.settled) return true
  }
  return false
}

/**
 * Write a state. This is the only function that touches `data-dropzone`,
 * `api.state` or `instance.state`, and it writes all three from the same
 * argument — that is what keeps them from drifting.
 *
 * The attribute write is conditional. `setAttribute` queues a `MutationRecord`
 * even when the value is unchanged, and `processFiles` writes `'idle'` on every
 * empty pick and every non-upload drop; a consumer observing their own zone and
 * setting reactive state from the callback then has no fixed point (mutation →
 * state → render → `updated` → mutation) and the tab stops yielding. Reading
 * the attribute here is a write-suppression check, never a source of the value.
 */
export function setState(el: HTMLElement, instance: DropzoneInstance, state: DropzoneState): void {
  instance.state = state
  if (el.getAttribute('data-dropzone') !== state) el.setAttribute('data-dropzone', state)
  if (instance.api) instance.api.state = state
  // The progress snapshot describes an upload. Drop it — and the vars with it —
  // as soon as the zone stops showing one: `idle` by any path (cancel, success
  // auto-clear, dragleave with no upload), and `rejected` when the snapshot has
  // nothing left in flight. A `rejected` drop uploads nothing, so leaving
  // `--dropzone-progress: 100` from the previous batch behind renders a full
  // progress bar for work that never happened (DZ-4). A rejection that lands
  // *during* a live upload keeps the vars — they still describe real requests.
  const spent = state === 'idle' || (state === 'rejected' && !snapshotIsLive(instance))
  if (spent && instance.progressBatch) {
    instance.progressBatch = null
    clearUploadVars(el)
  }
}

/**
 * Compute + write the `--dropzone-progress` / `--dropzone-files-pending` CSS
 * variables from the current `progressBatch` snapshot. Idempotent.
 *
 * - `--dropzone-progress` is the rounded average percent across every file in
 *   the snapshot (settled files contribute 100% on success or their last-known
 *   percent on failure; unsettled files contribute whatever the transport has
 *   reported via `xhr.upload.progress` or the function-based `onProgress`).
 * - `--dropzone-files-pending` is the count of files in the snapshot that
 *   haven't settled yet — the consumer's "uploading N of M" UI.
 */
export function writeUploadVars(el: HTMLElement, instance: DropzoneInstance): void {
  const batch = instance.progressBatch
  if (!batch || batch.length === 0) {
    clearUploadVars(el)
    return
  }
  let totalPercent = 0
  let pending = 0
  for (const r of batch) {
    totalPercent += r.progressPercent
    if (!r.settled) pending += 1
  }
  const avg = Math.round(totalPercent / batch.length)
  el.style.setProperty('--dropzone-progress', String(avg))
  el.style.setProperty('--dropzone-files-pending', String(pending))
}

export function clearUploadVars(el: HTMLElement): void {
  el.style.removeProperty('--dropzone-progress')
  el.style.removeProperty('--dropzone-files-pending')
}

/**
 * When a drag interrupts an in-flight upload or a sticky `error` state, we
 * want the drag UI to still flip to `active` — but on dragleave we restore
 * the prior state instead of falling back to `idle`. This helper picks the
 * right state for "no drag in progress" given the current upload state.
 */
export function nonDragRestState(instance: DropzoneInstance): DropzoneState {
  // Both questions are asked of `records`, which is the only thing that knows.
  // Work still outstanding outranks a past failure: the zone is uploading.
  if (hasInflight(instance)) return 'uploading'
  // A sticky error outlives the requests that produced it, so the failed
  // records are what it is read off. Without this a dragenter/dragleave that
  // never drops would quietly clear an error the consumer has not dismissed.
  if (hasFailed(instance)) return 'error'
  return 'idle'
}

/**
 * Create the record for `file`, or reset the one already tracked back to a
 * clean `pending`. Every input path needs exactly this — a drop, a pick, a
 * paste, `api.upload(files)`, and the auto-upload kickoff — and `FileRecord`
 * has eight fields, so the literal lived in two modules and a ninth field would
 * have had to be remembered in both.
 */
export function ensureRecord(instance: DropzoneInstance, file: File): FileRecord {
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
  const record: FileRecord = {
    file,
    status: 'pending',
    xhr: null,
    controller: null,
    group: [],
    abortAnnounced: false,
    progressPercent: 0,
    settled: false,
  }
  instance.records.set(file, record)
  return record
}

/**
 * Drop every failed record. This is what makes the README's "the next drop
 * reseeds the state machine" true: without it a failure sat in `records`
 * forever, `api.failed` accumulated every file that ever failed, and the next
 * bare dragenter/dragleave repainted the zone red long after the user had
 * successfully re-uploaded (`nonDragRestState` reads the same map).
 *
 * Called only where *new* files enter the pipeline, never from retry — retrying
 * one failed file must not discard the record for another.
 */
export function pruneFailedRecords(instance: DropzoneInstance): void {
  for (const [file, record] of Array.from(instance.records.entries())) {
    if (record.status === 'failed') instance.records.delete(file)
  }
}

/**
 * Rebuild the `pending` / `uploading` / `failed` arrays on the reactive api
 * object from the current `records` map. Called whenever a record's status
 * changes (start, success, error, cancel, retry).
 *
 * Replaces array references instead of mutating in place so Vue's deep-reactivity
 * fires a single trigger per array per change, and computeds that hold references
 * to the previous array stay stable (no flicker during re-evaluation).
 */
export function syncApiArrays(instance: DropzoneInstance): void {
  if (!instance.api) return
  const pending: File[] = []
  const uploading: File[] = []
  const failed: File[] = []
  for (const r of instance.records.values()) {
    if (r.status === 'pending') pending.push(r.file)
    else if (r.status === 'uploading') uploading.push(r.file)
    else failed.push(r.file)
  }
  instance.api.pending = pending
  instance.api.uploading = uploading
  instance.api.failed = failed
}
