/**
 * The imperative `DropzoneApi` — the reactive object surfaced through the
 * `ref` option: open / upload / cancel / retry / dismissError plus the
 * reactive state and file arrays, and the ref attach/detach lifecycle.
 */
import { reactive } from 'vue'
import { ensurePickerInput } from './picker'
import { processFiles } from './process'
import {
  nonDragRestState,
  setState,
  syncApiArrays,
  type DropzoneInstance,
  type FileRecord,
} from './state'
import type { DropzoneApi, DropzoneApiRef } from './types'
import { startUploadsForRecords } from './upload'
import {
  cancelAllInflight,
  cancelRecordGroup,
  retryAllFailed,
  retryRecord,
  settleAfterCancel,
} from './upload-control'

/**
 * Build the reactive `DropzoneApi` for an instance. Methods close over
 * `el` + `instance`, so each api object is bound to exactly one host element.
 */
function createApi(el: HTMLElement, instance: DropzoneInstance): DropzoneApi {
  const api = reactive<DropzoneApi>({
    state: 'idle',
    pending: [] as readonly File[],
    uploading: [] as readonly File[],
    failed: [] as readonly File[],

    open() {
      const input = ensurePickerInput(el, instance)
      input.value = ''
      input.click()
    },

    upload(files?: File | File[]) {
      // No arg: run pending records through the upload pipeline.
      if (files === undefined) {
        const pendingRecords: FileRecord[] = []
        for (const r of instance.records.values()) {
          if (r.status === 'pending') pendingRecords.push(r)
        }
        if (pendingRecords.length === 0) return
        if (!instance.opts.upload) return
        startUploadsForRecords(el, instance, pendingRecords)
        return
      }
      // With arg: validate and fire on() like a drop, then upload — explicitly,
      // so `autoUpload: false` does not swallow the call it exists to enable.
      const list = Array.isArray(files) ? files : [files]
      processFiles(el, instance, list, { forceUpload: true })
    },

    cancel(file?: File) {
      if (file === undefined) {
        cancelAllInflight(el, instance)
        return
      }
      const record = instance.records.get(file)
      if (!record) return
      const outcome = cancelRecordGroup(instance, record)
      syncApiArrays(instance)
      // Discarding a queued file changes nothing about what is on the wire, so
      // it must not move the state — a sticky error stays, a live upload keeps
      // reporting itself as live.
      if (outcome === 'uploading') settleAfterCancel(el, instance)
    },

    retry(file?: File) {
      if (file === undefined) {
        retryAllFailed(el, instance)
        return
      }
      const record = instance.records.get(file)
      if (!record) return
      retryRecord(el, instance, record)
    },

    dismissError() {
      // Drop failed records, keep uploading ones intact. Pending stays too.
      for (const [file, r] of Array.from(instance.records.entries())) {
        if (r.status === 'failed') instance.records.delete(file)
      }
      syncApiArrays(instance)
      // Transition state.
      if (instance.state === 'error') {
        setState(el, instance, nonDragRestState(instance))
      }
    },
  })
  return api
}

function attachRef(instance: DropzoneInstance, ref: DropzoneApiRef | null | undefined): void {
  if (!ref) return
  instance.ref = ref
  ref.value = instance.api
}

export function detachRef(instance: DropzoneInstance): void {
  if (instance.ref) {
    instance.ref.value = undefined
    instance.ref = null
  }
}

/**
 * Ensure `instance.api` exists (lazy) and sync the consumer-supplied ref to
 * point at it. Idempotent across `updated` calls. When the consumer swaps
 * `opts.ref` to a new object, the old ref is cleared first.
 */
export function syncApi(el: HTMLElement, instance: DropzoneInstance): void {
  const desired = instance.opts.ref
  // If no ref is requested, but we have one bound, detach.
  if (!desired) {
    detachRef(instance)
    return
  }
  // Need an api object — build lazily.
  if (!instance.api) {
    instance.api = createApi(el, instance)
    // Reflect current state into the brand-new api — from the instance, not
    // from the attribute the instance wrote.
    instance.api.state = instance.state
    syncApiArrays(instance)
  }
  // Same ref already bound? No-op.
  if (instance.ref === desired) return
  // Different ref (or first time) — clear old, bind new.
  detachRef(instance)
  attachRef(instance, desired)
}
