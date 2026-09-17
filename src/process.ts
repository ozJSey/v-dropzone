/**
 * The shared post-files pipeline — drop, click-to-pick, paste, and
 * `api.upload(files)` all funnel through `processFiles`: validate → state →
 * `on` / `onReject` → upload (or queue under `autoUpload: false`).
 */
import { DEFAULT_REJECT_DURATION } from './constants'
import {
  clearRejectTimer,
  ensureRecord,
  nonDragRestState,
  pruneFailedRecords,
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
    // `nonDragRestState`, never the literal `'idle'`. A drop is fired for a
    // dragged text selection, a link, an image dragged off another page and an
    // empty folder; a pick fires `change` with zero files when the dialog is
    // dismissed. None of those say anything about work already in flight, and
    // `'idle'` claimed they did: it reported a live upload as finished, and
    // `setState('idle')` also drops `progressBatch`, after which every later
    // `writeUploadVars` finds no snapshot and clears the CSS variables again —
    // so the progress bar went to zero mid-upload and never came back. A
    // sticky `error` was wiped by the same line.
    setState(el, instance, nonDragRestState(instance))
    return
  }

  const { accepted, rejected, reasons } = validate(files, instance.opts)

  if (rejected.length > 0) {
    setState(el, instance, 'rejected')
    instance.opts.onReject?.({ files: rejected, reasons })
    const duration = instance.opts.rejectDuration ?? DEFAULT_REJECT_DURATION
    instance.rejectTimer = setTimeout(() => {
      instance.rejectTimer = null
      // Only clear the state this timer put up, and hand back to whatever the
      // zone actually is now — an upload the rejected drop interrupted is
      // still running, and forcing `idle` here reported it as finished.
      if (instance.state === 'rejected') setState(el, instance, nonDragRestState(instance))
    }, duration)
  } else if (!instance.opts.upload || accepted.length === 0) {
    // Same rule, same reason: this drop starts no request, so the zone returns
    // to whatever it actually is rather than to a hardcoded `'idle'`. It only
    // differs from `'idle'` with records still in the map, which needs `upload`
    // to have been removed reactively while a request was on the wire — with
    // no `upload` ever configured no record exists and this resolves to
    // `'idle'`, exactly as before.
    setState(el, instance, nonDragRestState(instance))
  }

  if (accepted.length > 0) instance.opts.on?.(accepted)

  if (accepted.length > 0 && instance.opts.upload) {
    // New files reseed the machine, which is what the README has always
    // promised of a sticky `error` ("cleared on the next drop"). Until 0.1.1
    // nothing did it: the failed records stayed in the map, `api.failed` grew
    // for the life of the page, and a later dragenter/dragleave read them back
    // and repainted the zone red after the user had already re-uploaded.
    // Retry does not come through here, so a retry of one file still leaves
    // another file's failure standing.
    pruneFailedRecords(instance)

    if (instance.opts.autoUpload === false && !forceUpload) {
      // Queue as pending; the consumer triggers upload via api.upload().
      for (const file of accepted) ensureRecord(instance, file)
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
