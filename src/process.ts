/**
 * The shared post-files pipeline — drop, click-to-pick, paste, and
 * `api.upload(files)` all funnel through `processFiles`: validate → state →
 * `on` / `onReject` → upload (or queue under `autoUpload: false`).
 */
import { DEFAULT_REJECT_DURATION } from './constants'
import {
  clearRejectTimer,
  nonDragRestState,
  setState,
  syncApiArrays,
  type DropzoneInstance,
} from './state'
import { startUploads } from './upload'
import { validate } from './validate'

/**
 * Shared post-files pipeline used by drop, the click-to-pick `change` handler,
 * paste, and `api.upload(files)`. Runs validation, drives `data-dropzone` state,
 * fires `on` / `onReject`. When `autoUpload: false` and an `upload` is configured,
 * accepted files are tracked as `pending` records instead of being uploaded.
 *
 * `forceUpload` is the one exception, and only `api.upload(files)` passes it:
 * `autoUpload: false` suppresses the *automatic* dispatch that follows a drop,
 * a paste or a pick, but an explicit imperative call is the consumer saying
 * "upload these now" — the whole point of holding a queue back. Without it
 * `api.upload(file)` re-queues an already-queued file and does nothing
 * observable, which is not what `upload(file?)` documents.
 */
export function processFiles(
  el: HTMLElement,
  instance: DropzoneInstance,
  files: File[],
  { forceUpload = false }: { forceUpload?: boolean } = {},
): void {
  clearRejectTimer(instance)

  if (files.length === 0) {
    setState(el, instance, 'idle')
    return
  }

  const { accepted, rejected, reasons } = validate(files, instance.opts)

  if (rejected.length > 0) {
    setState(el, instance, 'rejected')
    instance.opts.onReject?.({ files: rejected, reasons })
    const duration = instance.opts.rejectDuration ?? DEFAULT_REJECT_DURATION
    instance.rejectTimer = setTimeout(() => {
      instance.rejectTimer = null
      if (el.getAttribute('data-dropzone') === 'rejected') setState(el, instance, 'idle')
    }, duration)
  } else if (!instance.opts.upload || accepted.length === 0) {
    setState(el, instance, 'idle')
  }

  if (accepted.length > 0) instance.opts.on?.(accepted)

  if (accepted.length > 0 && instance.opts.upload) {
    if (instance.opts.autoUpload === false && !forceUpload) {
      // Queue as pending; the consumer triggers upload via api.upload().
      for (const file of accepted) {
        const existing = instance.records.get(file)
        if (existing) {
          existing.status = 'pending'
          existing.xhr = null
          existing.controller = null
          existing.abortAnnounced = false
          existing.progressPercent = 0
          existing.settled = false
        } else {
          instance.records.set(file, {
            file,
            status: 'pending',
            xhr: null,
            controller: null,
            group: [],
            abortAnnounced: false,
            progressPercent: 0,
            settled: false,
          })
        }
      }
      syncApiArrays(instance)
      // Queued, not uploading — so the zone is at rest, and it has to say so.
      // `dragenter` set it to `active` on the way in and only `dragleave`
      // clears that; a drop never does. Without this line the zone stays
      // `active` forever after a queued drop and `api.state` reports a state
      // that is false — on the README's own recipe 8. A *pick* through the
      // same options ends `idle` (nothing made it `active` first), which is
      // exactly why the suite could not see it.
      //
      // `nonDragRestState`, not the literal `'idle'`: an upload started
      // earlier may still be in flight, and a sticky `error` outlives its
      // batch. A rejection in the same batch keeps its own state until its
      // timer clears it — the rule the non-upload branch above already sets.
      if (rejected.length === 0) setState(el, instance, nonDragRestState(instance))
    } else {
      startUploads(el, instance, accepted)
    }
  }
}
