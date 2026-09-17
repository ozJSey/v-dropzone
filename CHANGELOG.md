# Changelog

All notable changes to `@ozjsey/v-dropzone`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every entry below was confirmed by a test in `vDropzone.test.ts` that fails without the change,
and the state-machine entries were additionally driven in a real Chrome through the playground's
`v-dropzone` tab.

## [0.1.2] — 2026-09-17

### Fixed

- **A drop carrying no files reported a live upload as finished, killed its progress bar for
  good, and wiped a sticky `error`.** `drop` fires for anything draggable, not just files — a
  text selection, a link, an image dragged off another page, an empty folder — and `change`
  fires with zero files when the file dialog is dismissed. All of them reached the pipeline with
  an empty file list, and that branch wrote the literal `'idle'`.

  With one file uploading, `data-dropzone` went `uploading` → `idle` and `api.state` went with
  it, while `api.uploading` still listed the file: the two disagreed, which is the one thing the
  0.1.1 store rewrite existed to make impossible. The progress bar did not merely reset —
  `'idle'` also discards `instance.progressBatch`, and `writeUploadVars` clears the CSS variables
  whenever there is no snapshot to describe, so every later progress event re-cleared them and
  `--dropzone-progress` never came back for the rest of that upload. A sticky `error` the
  consumer had not dismissed was cleared by the same line, with the failed records left in
  `api.failed` behind it.

  A drop that starts no request now hands the zone back to what it actually is
  (`nonDragRestState`) rather than asserting `idle` — the same rule the reject timer and the
  `autoUpload: false` queue path already followed. An idle zone still ends idle.

### Documentation

- **`cancel()` does not clear a failure, and the README said three times that it did.** The
  `error` state row, the `api.failed` row and the "error is sticky" note all listed
  `cancel(file)` / `cancel()` among the levers that clear a failed file. It has never done that
  in any published version: `cancel` aborts what is in flight and discards what is queued, and a
  failed record is neither — `cancel(file)` on one returns without touching it, and no-arg
  `cancel()` deliberately preserves failed records so they stay retryable. Anyone who wired a
  per-row "dismiss" button to `cancel(file)` got a silent no-op. The three claims are corrected
  and the `cancel(file?)` api row now says outright that a failed file is not cancellable;
  `retry(file)` and `dismissError()` are the levers. Behaviour is unchanged — `dismissError()`
  remains all-or-nothing, so there is still no per-file dismissal.

## [0.1.1] — 2026-09-14

### Fixed

- **A second drop during an in-flight upload made the zone report `success` with files still on
  the wire, and then silently swallowed their failure.** Drop two files, drop two more before the
  first two answer, and let the first two succeed: `data-dropzone` went to `success`,
  `--dropzone-progress` reset to `0`, and when one of the still-open uploads then returned a 500
  the zone stayed `success` **forever** — `onError` fired, but nothing in the state ever said the
  upload had failed. A user was told their upload worked when it had not.

  The cause was a single mutable per-batch counter that each new drop overwrote, so the first
  drop's completions were counted against the second drop's total and the counter that would have
  carried the eventual failure had already been discarded. The counter is gone. "Is anything still
  uploading?" and "did anything fail?" are now derived from the tracked file records, which is the
  only thing that knows, so overlapping drops settle as one outstanding population: the zone stays
  `uploading` until every file has answered, and any failure among them wins.

- **A drag that never dropped could resurrect an error the zone had already moved past.** Failed
  records were never removed by a later drop, so after one failure and one successful re-upload a
  bare `dragenter` / `dragleave` read the stale record back and repainted the zone `error`.
  `api.failed` likewise accumulated every file that had ever failed, so a "Retry failed (N)"
  button counted files the user had already re-uploaded successfully. New accepted files now prune
  failed records, which is what the README has always said a new drop does. `retry()` does not
  prune — retrying one failed file still leaves another file's failure standing.

- **A throwing `url` / `headers` / `formDataExtras` function escaped as an uncaught exception and
  wedged the zone at `uploading`.** A token-refresh callback that throws — the README's own recipe
  3 and playground demo 05 both use the function form of `headers` for exactly that — left the
  zone spinning forever with no `onError`, the file stuck in `api.uploading`, and the *remaining*
  files of the same drop never sent. The throw is now reported as an ordinary upload failure:
  `onError(file, { message })`, the file lands in `api.failed` where `retry()` can reach it, the
  state settles to `error`, and the other files in the drop still go out.

- **`releasePickerHost` could delete a `position` the consumer wrote.** The directive sets
  `position: relative` on a static host so the picker input's offsets resolve against the zone,
  and reverts it on teardown. It tracked only that it had written a position at some point, not
  that the write was still standing — so a consumer who positioned the host afterwards (an object
  `:style` binding, a conditional class, a sticky header) lost their value the next time
  `clickToPick: false` or `enabled: false` toggled, with nothing in the console. Teardown now
  reverts only the exact value the directive wrote.

- **`--dropzone-progress` / `--dropzone-files-pending` no longer survive into a `rejected` drop.**
  After a settled batch the vars stayed at `100` / `0` for the full `rejectDuration`, so a
  consumer with a `[data-dropzone="rejected"] .bar` rule saw a full progress bar for a drop that
  uploaded nothing. They are cleared on entering `rejected` — unless files from an earlier batch
  are still in flight, in which case they keep describing those live requests. (Ticket DZ-4.)

- **A rejected drop landing during a live upload no longer reports the upload as finished.** The
  `rejected` auto-clear forced the zone to `idle`; it now hands back to whatever the zone actually
  is, so an upload the rejection interrupted is still reported as `uploading`.

- **The progress CSS variables describe every file in flight, not only the newest drop.** A second
  drop replaced the progress snapshot outright, so the bar reset to `0` and
  `--dropzone-files-pending` under-reported while earlier files were still uploading. New batches
  now merge into the snapshot.

### Added

- **`api.cancel(file)` removes a *queued* file.** Under `autoUpload: false` a file sitting in
  `api.pending` could not be removed through any public api: `cancel(f)` was a silent no-op,
  `retry(f)` requires `failed`, and `dismissError()` only drops `failed`. The obvious
  "remove from queue" button next to each pending file in the README's recipe 8 did nothing.
  `cancel(file)` now discards a pending record, and leaves the zone's state untouched while doing
  it. `cancel()` with no argument is unchanged — it aborts what is in flight and leaves the queue
  alone.

- `npm run typecheck` (`tsc --noEmit`), with `noUnusedLocals` / `noUnusedParameters` enabled. The
  package is meant to be copied into consumer projects, where those flags are the common default;
  a dead `stateMap` import in `api.ts` was invisible to `npm test` and `npm run build` alike.

### Changed

- `UploadProgressEvent` and `UploadResult` are marked `@deprecated`. Both are exported and were
  advertised in the README as usable public types, but nothing in the package produces or accepts
  either — `onProgress` is `(file, percent)` and no callback or return value is an `UploadResult`.
  They stay exported until the next major, since removing an exported type is a breaking change.

### Documentation

- `maxCount` is documented as what it is: **a cap per drop / paste / pick, not a running total.**
  README and `types.ts` both called it a "total file count cap"; two drops of `maxCount` files
  each have always both passed. The behaviour is unchanged in this patch — see the ticket
  `DZ-7-maxcount-is-not-a-total.md` for the semantic decision.
- The unconditional `stopPropagation()` on all four drag listeners is documented, including the
  consequence the README never mentioned: **nesting one `v-dropzone` inside another does not
  work**, and a page-level "drop anywhere" overlay goes quiet over a zone.
- The `error` state's clearing rules, the `failed` array's lifetime, and the CSS variables'
  behaviour across overlapping drops and rejections are all corrected.
- `ARCHITECTURE.md` gains the invariant this release exists to establish — one store
  (`instance.records`), one memory of the decision (`instance.state`), and everything on the
  consumer's host a projection of those — and drops the claim about `pickerHostPositioned` that
  the code did not honour.

## [0.1.0] — 2026-09-13

First publish to npm as `@ozjsey/v-dropzone`.

Vue 3 directive owning the drag-drop / paste / click-to-pick / upload pipeline in one binding:
the enter/leave depth counter that survives child-traversal phantom leaves, `accept` / `maxSize` /
`maxCount` / `multiple` validation with cumulative reasons, folder drops via `webkitGetAsEntry`,
paste-from-clipboard scoped to the host or the document, click-to-pick on by default with a
keyboard-reachable hidden input, URL (XHR, per-file or batched) and function-based upload
transports, cancel / retry / dismiss through a reactive `DropzoneApi`, the `data-dropzone` state
attribute, and the `--dropzone-progress` / `--dropzone-files-pending` CSS variables.

This release is retroactively described — there was no changelog at the time of publish.
The list above is sourced from `TASKS.md` and `PROGRESS.md`, both written as the features landed.
