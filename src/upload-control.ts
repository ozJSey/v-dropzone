/**
 * Upload control — cancellation (single group, all in-flight, hard abort on
 * unmount) and retry. Group semantics: in URL-batched mode one XHR backs
 * every record in the group, so control operations cascade group-wide.
 */
import { setState, syncApiArrays, type DropzoneInstance, type FileRecord } from './state'
import type { DropzoneState } from './types'
import { startUploadsForRecords } from './upload'

/**
 * Cancel a single record (or its whole batch group for URL batched mode).
 * Records are removed from tracking — cancelled files do NOT land in `failed`.
 * Returns true if anything was actually cancelled (status was 'uploading').
 */
export function cancelRecordGroup(instance: DropzoneInstance, anchor: FileRecord): boolean {
  if (anchor.status !== 'uploading') return false

  const group = anchor.group.length > 0 ? anchor.group : [anchor]
  const xhr = anchor.xhr

  for (const r of group) {
    r.xhr = null
    if (r.controller) {
      try {
        r.controller.abort()
      } catch {
        /* polyfill quirks */
      }
      r.controller = null
    }
    instance.records.delete(r.file)
  }
  if (xhr) {
    try {
      xhr.abort()
    } catch {
      /* completed XHR may throw in some envs */
    }
  }
  return true
}

/**
 * Cancel everything currently `uploading`. Removes records from tracking;
 * cancelled files do NOT land in `failed`. `failed` records are preserved
 * (consumer may still want to retry / dismiss).
 */
export function cancelAllInflight(el: HTMLElement, instance: DropzoneInstance): void {
  // Collect first — the loop mutates instance.records.
  const anchors: FileRecord[] = []
  const seenXhrs = new Set<XMLHttpRequest>()
  for (const r of instance.records.values()) {
    if (r.status !== 'uploading') continue
    // For URL batched mode, the same XHR backs every record in a group —
    // only cancel through the first anchor to avoid double-counting.
    if (r.xhr) {
      if (seenXhrs.has(r.xhr)) continue
      seenXhrs.add(r.xhr)
    }
    anchors.push(r)
  }

  let cancelled = 0
  for (const a of anchors) {
    if (cancelRecordGroup(instance, a)) cancelled += 1
  }

  // Settle the state machine.
  if (cancelled > 0) {
    const batch = instance.uploadBatch
    if (batch) {
      batch.done += cancelled
      if (batch.done >= batch.total) {
        instance.uploadBatch = null
        // No success — cancellation is not success.
        // If anything failed before, errors > 0 → leave as 'error'. Else 'idle'.
        const targetState: DropzoneState = batch.errors > 0 ? 'error' : 'idle'
        setState(el, instance, targetState)
      }
    } else {
      // No batch (already settled previously). State stays whatever it was.
    }
  }
  syncApiArrays(instance)
}

/**
 * Hard cleanup: abort every XHR / AbortController, clear every record.
 * Used by `detach()` on unmount and by `dismissError()` after error.
 *
 * For XHR uploads, `xhr.abort()` triggers the `onabort` handler which emits
 * `onError(aborted)` for the consumer. For function-based uploads, the
 * consumer's transport may never settle (e.g. a pending fetch that ignores
 * the signal), so we synchronously emit `onError(aborted)` for any
 * `uploading` function-based record before clearing it — this guarantees the
 * consumer sees a uniform abort notification regardless of upload mode.
 */
export function abortAllUploads(instance: DropzoneInstance): void {
  const seenXhrs = new Set<XMLHttpRequest>()
  const pendingAbortNotifications: File[] = []
  for (const r of instance.records.values()) {
    if (r.xhr && !seenXhrs.has(r.xhr)) {
      try {
        r.xhr.abort()
      } catch {
        /* completed XHR may throw in some envs */
      }
      seenXhrs.add(r.xhr)
    }
    if (r.controller) {
      // Function-based upload — emit synchronously since the consumer's
      // promise may never settle (the consumer may not honor the signal).
      // The `abortAnnounced` flag guards `sendUploadFn` from emitting again
      // if the consumer's promise does eventually resolve/reject.
      if (r.status === 'uploading' && !r.abortAnnounced) {
        pendingAbortNotifications.push(r.file)
        r.abortAnnounced = true
      }
      try {
        r.controller.abort()
      } catch {
        /* never throws in spec; defensive */
      }
    }
    r.xhr = null
    r.controller = null
  }
  for (const file of pendingAbortNotifications) {
    instance.opts.onError?.(file, { message: 'Upload aborted', aborted: true })
  }
  instance.records.clear()
  instance.uploadBatch = null
  syncApiArrays(instance)
}

/**
 * Re-start an upload for a single failed record or its group (URL-batched mode).
 * Returns true if anything was queued.
 */
export function retryRecord(el: HTMLElement, instance: DropzoneInstance, anchor: FileRecord): boolean {
  if (anchor.status !== 'failed') return false
  const group = anchor.group.length > 0 ? anchor.group : [anchor]
  // Only retry whole groups (URL batched). Reset and start.
  for (const r of group) {
    r.status = 'pending'
    r.xhr = null
    r.controller = null
  }
  // Use the group's records directly — they're already in `instance.records`.
  startUploadsForRecords(el, instance, group)
  return true
}

export function retryAllFailed(el: HTMLElement, instance: DropzoneInstance): void {
  const seenGroups = new Set<FileRecord>()
  const anchors: FileRecord[] = []
  for (const r of instance.records.values()) {
    if (r.status !== 'failed') continue
    const groupKey = r.group.length > 0 ? r.group[0] : r
    if (seenGroups.has(groupKey)) continue
    seenGroups.add(groupKey)
    anchors.push(r)
  }
  if (anchors.length === 0) return

  // Reset and gather every record in every group, then start one combined batch.
  const allRecords: FileRecord[] = []
  for (const a of anchors) {
    const group = a.group.length > 0 ? a.group : [a]
    for (const r of group) {
      r.status = 'pending'
      r.xhr = null
      r.controller = null
      allRecords.push(r)
    }
  }
  startUploadsForRecords(el, instance, allRecords)
}
