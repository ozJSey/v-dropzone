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
   * Per-file tracking, keyed by File reference. Drives `api.pending`/`uploading`/`failed`
   * and is the source of truth for cancel/retry. Records are added when files
   * arrive (drop/paste/pick/`api.upload`) and removed on success or cancel.
   * Failed records stay until `retry` succeeds, `cancel`, `dismissError`, or
   * the next drop clears the sticky error.
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
   * Per-batch counters used to drive the post-upload state transition.
   * `total` is fixed at the start of a batch; `done` increments on each
   * load/error/timeout/abort; `errors` counts non-2xx + network + timeout
   * outcomes. When `done === total`, decide between `success` and `error`.
   */
  uploadBatch: { total: number; done: number; errors: number } | null
  /**
   * Snapshot of records that drive the current `--dropzone-progress` /
   * `--dropzone-files-pending` CSS variables. Independent from `uploadBatch`
   * because (a) URL batched mode has 1 group but N files (we want files-pending=N),
   * and (b) the snapshot survives after the batch settles so the vars persist
   * through the `success`/`error` window. Cleared on transition to `'idle'`
   * (success auto-clear, cancel) and on unmount.
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

export function setState(el: HTMLElement, instance: DropzoneInstance, state: DropzoneState): void {
  el.setAttribute('data-dropzone', state)
  if (instance.api) instance.api.state = state
  // Vars are cleared whenever the host returns to idle — by any path (cancel,
  // success auto-clear, dragleave with no upload, rejected auto-clear). Keeps
  // the cleanup centralized and avoids drift between call sites.
  if (state === 'idle' && instance.progressBatch) {
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
  if (instance.uploadBatch && instance.uploadBatch.done < instance.uploadBatch.total) return 'uploading'
  // A sticky error outlives its batch — `advanceBatch` nulls `uploadBatch`
  // before setting `error`, so the failed records are the only thing left to
  // read it off. Without this a dragenter/dragleave that never drops would
  // quietly clear an error the consumer has not dismissed.
  for (const record of instance.records.values()) {
    if (record.status === 'failed') return 'error'
  }
  return 'idle'
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
