# TASKS — v-dropzone

> Read [`../instructions/CONVENTIONS.md`](../instructions/CONVENTIONS.md) and [`../instructions/v-dropzone.md`](../instructions/v-dropzone.md) first.

Prioritized backlog. Top of list = next run picks this up. ONE task per run, fully shipped.

## P0 — Bootstrap

- [x] **Scaffold package** — DONE 2026-05-15 (Run 1). `package.json` + `tsconfig.json` + `vitest.config.ts` + `LICENSE` (MIT) + `.gitignore` + `README.md` + `playground.html` + `vDropzone.ts` (typed directive) + `vDropzone.test.ts`. Layout mirrors `v-trap-focus`. Build emits `dist/vDropzone.min.js` (1.59 KB) + `dist/vDropzone.d.ts` (1.77 KB).

## P0 — Drag-drop core

- [x] **4-event wiring + enter/leave counter + `data-dropzone` state attribute** — DONE 2026-05-15 (Run 1). `dragenter` increments / `dragleave` decrements; counter > 0 → `data-dropzone="active"`; `dragover` calls `preventDefault` (the canonical drop-zone bug — without it `drop` never fires). 13 tests pin: cursor across children does NOT flip to `idle`; `drop` resets counter to 0; `drop` with empty file list does NOT invoke handler; `preventDefault` on all four events; per-element state via `WeakMap` so two dropzones on the same page do not interfere; bare handler binding works (`v-dropzone="onFiles"`); options-object binding (`v-dropzone="{ on, … }"`) works; `unmounted` removes listeners and clears the state attribute. 13/13 tests pass.

## P0 — Next up

- [x] **`accept` filter + `multiple`/`maxSize`/`maxCount` validation + `rejected` state** — DONE 2026-05-15. 55/55 tests pass. `accept` supports MIME wildcards (`image/*`), exact MIME (`image/png`), comma-separated lists, and extensions (`.pdf,.docx`). Case-insensitive. MIME parameters stripped (`text/plain;charset=utf-8` → `text/plain`). Per-file model for `accept`/`maxSize`; drop-level for `multiple: false`/`maxCount`. Cumulative `reasons` in canonical order `['type','size','count']`. `data-dropzone="rejected"` auto-clears after `rejectDuration` ms; new drag cancels pending clear; new drop resets timer. Edge cases pinned: empty/whitespace accept, empty `file.type` vs wildcard, `maxSize: 0`, `Number.MAX_SAFE_INTEGER`, null `dataTransfer`.

- [x] **Click-to-pick** — DONE 2026-05-15 (Run 3). 18 new tests; 82/82 total green. `clickToPick: true` creates a hidden `<input type="file">` (display: none, out of tab order) inside the host; host click → `input.click()`. `accept` + `multiple` mirrored on the input (also re-validated on `change`). Interactive-descendant guard via `closest('button, a, input, select, textarea, label, [contenteditable]:not([contenteditable="false"])')` — clicks on buttons/anchors/inputs/etc. preserve their semantics; nested icons inside a button also skipped. `input.value` reset before each open so same file picks twice in a row. Reactive: toggling `clickToPick` attaches/detaches the input; option changes resync attrs. `enabled: false` short-circuits. Shared `processFiles` pipeline between drop and pick — same `data-dropzone="rejected"` lifecycle. ESM bundle 3.95 KB.

- [x] **Paste-from-clipboard** — DONE 2026-05-15 (Run 4 — implemented but not previously logged). `paste: true` attaches a `paste` listener on the host (or `document` when `pasteOn: 'document'`). Reads `event.clipboardData.items`, filters `kind === 'file'`. `preventDefault` only when at least one file is consumed (text-only pastes pass through). Listener target swaps cleanly across reactive `pasteOn` changes. 31 new tests across basic wiring (8) + validation pipeline (6) + `pasteOn` scope (5) + lifecycle (4) + reactive option toggles (8). 113/113 total green; ESM ~3.95 KB unchanged from prior run.

## P0 — Upload pipeline

- [x] **URL-based upload** — DONE 2026-05-15 (Run 5 — implemented; Run 6 reconciliation). `upload: { url, method?, headers?, fieldName?, formDataExtras?, batched?, withCredentials?, timeout?, parseResponse? }`. Builds `FormData`, uses `XMLHttpRequest` for progress events. Dynamic value-or-function for `url` / `headers` / `formDataExtras` (resolves per-file). `onProgress(file, percent)` (clamped 0–100 int, skipped when `!lengthComputable`), `onUploaded(file, response)` (response auto-JSON-parsed when `content-type` is JSON or empty), `onError(file, { message, status?, aborted?, timedOut? })`. Per-batch state machine: drop → `uploading`; all OK → `success` (auto-clear after `successDuration` ms); any failure → `error` (sticky). Drag during upload temporarily flips to `active` then restores `uploading`. ~50 tests cover wiring + per-file/batched + progress + success + error + state lifecycle + validation interaction + unmount-aborts. 155/155 total green.

- [x] **Function-based upload** — DONE 2026-05-16 (Run 7). `upload: async (file, signal, onProgress?) => Response | T` accepted via `UploadConfig | UploadFn` union on `DropzoneOptions.upload`. Per-file invocation (no `batched` for function shape — consumer groups internally if needed). `AbortController` per file fired on unmount; `signal.aborted` lets consumer cooperate. Optional 3rd-arg `onProgress(percent)` is clamped + rounded by the directive (handles `NaN`, `-10`, `150`, `33.6` → `0`, `100`, `34`, `0`). Thrown `Error` → `onError(file, { message: err.message })`; non-`Error` throws → `{ message: 'Upload failed' }`. Same `uploading` → `success` (auto-clear) / `error` (sticky) state machine as URL-based. `clickToPick` + `paste` both flow through the function-based upload. 23 new tests (155→178); ESM `8.30 KB` minified.

- [x] **`DropzoneApi` programmatic methods via `ref` option** — DONE (run 8, reconciled 2026-05-16). `open()`, `upload()`, `cancel()`, `retry()`, `dismissError()`, reactive `state` / `pending` / `uploading` / `failed`. Cancel function-based AbortController fires `signal.aborted`; cancel URL-XHR aborts and emits `aborted: true`. Retry resumes failed groups (URL batched mode retries the whole group). DropzoneApi is built lazily, kept stable across reactive opts updates, swap-safe across ref-target changes, and cleared on unmount. `autoUpload: false` queues files into `api.pending` until `api.upload()` is invoked. 39 new tests across 10 describes (178→217). Run-7.5 reconciliation: prior CRON tick landed both this and `autoUpload`; this entry now reflects reality.

- [x] **CSS variables during upload** — DONE 2026-05-16 (Run 9 reconciliation). `writeUploadVars(el, instance)` computes `--dropzone-progress` (rounded average of all files in the active batch) and `--dropzone-files-pending` (count of unsettled files). Wired through `xhr.upload.progress` for URL uploads and the `onProgress` callback for function-based uploads. Persists through `uploading` / `active` (drag-during-upload) / `success` / `error`; cleared on transition to `idle` (cancel, success auto-clear, dragleave-to-idle) and on unmount. Centralized via `setState()` (clears) + `writeUploadVars()` (sets) — no scattered DOM mutations. Failure semantics: erroring file contributes its last reported percent to the aggregate; `files-pending` decrements regardless of success or failure. Rejected drops do NOT touch the vars (no upload was attempted). 19 tests pin the URL path + 4 tests pin the function path + 1 test pins the `autoUpload:false` interaction (vDropzone.test.ts:4047–4396).

## P0 — State attribute lifecycle

- [x] **Full state lifecycle: idle ↔ active ↔ rejected ↔ uploading ↔ success/error with auto-clear timings** — DONE 2026-05-16 (Run 9 reconciliation). `successDuration: 1500` ms (configurable), `rejectDuration: 1500` ms (configurable). `error` is sticky until next drop / `api.dismissError()`. Drag-during-upload flips to `active` and `dragleave` restores `nonDragRestState(instance)` (which is `'uploading'` if a batch is still in flight, else `'idle'`). Timer cleanup: `clearSuccessTimer` / `clearRejectTimer` on new upload, on unmount, and as the timer's own self-clear. Default-duration tests + sticky-error tests + drop-during-success tests in `vDropzone.test.ts:4398–4455`.

## P1 — Polish

- [x] **README copy-paste recipes** — DONE 2026-05-16 (Run 9). 8 recipes (drop+display / drop+validation / drop+auto-upload-URL / drop+function-upload-S3 / paste-anywhere / click-to-pick / programmatic-API / autoUpload-queue). Plus `DropzoneApi` reference table + Bundle size section.

- [x] **Playground demo with all features** — DONE 2026-05-16 (Run 9). `playground.html` now has 5 cards: drag-drop / validation+click-to-pick / upload progress (CSS vars) / paste-from-clipboard / programmatic API + queue (Open/Upload/Cancel/Retry/Dismiss buttons backed by `apiRef`).

- [x] **Bundle-size budget** — DONE 2026-05-16 (Run 9). Measured: **12.7 KB** ESM minified, **4.3 KB** gzipped. Documented in README. Budget is informally bounded by the gzip number — 4.3 KB on the wire is in line with peer directive packages and well below typical drop-zone alternatives (react-dropzone is ~12 KB gz, plus its companion uploader libs).

- [x] **`app.use()` plugin export** — DONE (reconciled 2026-08-20, shipped in a prior tick). `src/plugin.ts` exports `DIRECTIVE_NAME = 'dropzone' as const` + `DropzonePlugin: Plugin`; re-exported from the `vDropzone.ts` barrel. Pinned by the `DropzonePlugin + DIRECTIVE_NAME` describe (install wiring, `app._context.directives`, idempotent re-install). The playground registers via `app.use(DropzonePlugin)` on boot.

- [x] **Browser verification of every playground card** — DONE 2026-08-23 (Run 21). `pnpm interactions`
  in the playground drives all 12 `v-dropzone` cards through CDP in a real Chrome — 51 checks, all
  green, source and dist. It found four defects a green `npm test` + `pnpm smoke` could not see;
  see PROGRESS. Demo 12's folder walk is now exercised against a real directory via
  `Input.dispatchDragEvent`, which is the only way to get filesystem-backed `webkitGetAsEntry`
  entries — jsdom cannot model this at all.

- [ ] **Decide the fate of `UploadProgressEvent` and `UploadResult`** — both are exported from
  `src/index.ts` and listed in the README's TypeScript section, but nothing in the package produces
  or consumes either: `onProgress` is `(file, percent)`, and no call returns an `UploadResult`.
  They are unreachable by construction, so no playground card can ever cover them. Either wire them
  into the public surface (an `UploadProgressEvent` argument shape, a batch-settled callback handing
  back `UploadResult[]`) or delete them from `types.ts` + `index.ts` + README. **Do this before the
  first publish** — removing an exported type afterwards is a breaking change.

- [ ] **Decide whether `cancel(file)` should drop a *pending* file** — today it is a no-op on a
  record that has not started uploading, so a queued file under `autoUpload: false` cannot be
  removed from `api.pending` at all. Either make `cancel(file)` discard a pending record (natural
  reading, and the missing half of the review-before-upload flow) or document the gap explicitly.
  Undocumented either way right now.

- [ ] **First publish prep** — version bump to `1.0.0`, README badge cleanup (npm version + bundle-size badges), publish dry-run, smoke-test from `npm pack`'d tarball in a fresh app.

## P2 — Future

- [ ] **Image preview helper** — `previews: true` reads each accepted image into `URL.createObjectURL`; auto-revoke on unmount.

- [ ] **Chunked uploads** — `chunkSize: bytes` + `Content-Range`; `resumable: true` for skip-already-uploaded-chunks.

- [ ] **`useDropzone(options)` composable** — punted until a real consumer use case appears (directive's element binding should cover 95%+).

## Gotchas

- `dragover` MUST `preventDefault()` or `drop` never fires (handled).
- iOS Safari doesn't fire `paste` for images outside `<input>` / `<textarea>` — document the limit when paste lands.
- XHR `progress` events don't fire for cross-origin without `Access-Control-Allow-Origin` — document when upload lands.
- The directive adds NO visual style — consumer styles via `[data-dropzone="..."]`.
