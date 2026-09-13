# PROGRESS — v-dropzone

Append-only run log. Newest entries at top.

---

## 2026-08-23 — Run 21: browser verification of the playground tab — four defects a green test suite could not see

**Picked task:** "check the playground v-dropzone section with smoke tests — are we good?"

**Short answer: the gates were all green and the tab was still broken.** `npm test` (257/257),
`pnpm smoke`, `pnpm smoke:dist` and `pnpm typecheck` all passed, and `dist/` was fresh. Two of the
twelve cards were nevertheless completely dead, and the library had two real bugs. Every one of
these was invisible to the existing checks — this is the `CLAUDE.md` "smoke passing is not the same
as the demo being correct" rule collecting again.

**Library defects found and fixed:**

1. **A drop with no filesystem backing delivered zero files** (`src/files.ts`). `gatherDropEntries`
   returned `[]` — not `null` — whenever *any* item exposed `webkitGetAsEntry`, which is every item
   in Chromium. When the call then answers `null` (no filesystem behind the item), `drag.ts` took
   the folder walk with an empty entry list and delivered nothing, while `dataTransfer.files` sat
   there fully populated. Hits synthetic `DataTransfer`s (how Playwright/Cypress drive a dropzone —
   so every consumer's own drop test would have failed), drags out of virtual folders, and
   mail-client attachments. Now falls back when the walk comes up empty. Reproduced in headless
   Chrome first, then pinned by three tests. The old suite could not catch it: jsdom's
   `DataTransferItem` has no `webkitGetAsEntry` at all, so it always took the fallback path.

2. **`api.upload(file)` re-queued instead of uploading** (`src/process.ts`, `src/api.ts`).
   `processFiles` gated the explicit imperative call behind `autoUpload`, so under
   `autoUpload: false` — the only mode where you would ever call it — `upload(file)` re-marked an
   already-pending record as pending and did nothing. README:311 documented the opposite, and the
   existing test's *title* said "still uploads immediately when explicit" while its assertion
   pinned `expect(upload).not.toHaveBeenCalled()`. `autoUpload` now gates only the automatic
   dispatch after a drop / paste / pick; an explicit call always uploads. Validation still applies.

3. **A drag that never dropped silently cleared a sticky `error`** (`src/state.ts`).
   `nonDragRestState` only restored `'uploading'`, so after a failed batch (`advanceBatch` nulls
   `uploadBatch` before setting `error`) a bare dragenter → dragleave fell through to `idle`. That
   contradicted the function's own docblock and three README claims. It now reads the outstanding
   failed records.

**Playground defects found and fixed:**

4. **Demos 7 and 8 were entirely dead.** Both wrote `v-dropzone="{ ref: dz, … }"` **inside the
   template**, and Vue unwraps refs in template expressions — the directive received
   `ref: dz.value`, i.e. `undefined` at mount, so the api never bound. Every button was a no-op or
   permanently `:disabled`, and the state/pending/uploading/failed readout printed `—` forever.
   Nothing threw, so smoke was green. The options objects moved into `<script setup>`. **The README
   taught the same broken pattern** in recipes 7 and 8 and in the `DropzoneApi` intro — all three
   fixed, plus a call-out and a caveat row, because this is the single most likely way a consumer
   gets it wrong.
5. Demo 2 blanked its own rejection message on a partial rejection — the exact case it advertises.
   `onReject` fires before `on`, and `on` cleared the line the first one had just written. Adopted
   demo 12's microtask `startDrop()` grouping.
6. Demo 6's abort branch was unreachable (the instructed "switch tabs" gesture destroys the log
   that would show it) and it never bound the `onProgress` option. Now has a `ref`, a Cancel
   button, a slow enough transport to click it, and an `[aborted]` marker in the log.
7. Demo 9 could not reach `error` or `rejected` — it hardcoded an always-succeeding endpoint with
   no validation rule, so the failure semantics in its own prose, and its own error CSS, were dead.
   Now has an endpoint select and a `maxSize` control.
8. Demo 10 polled `dz.state` every 80ms instead of watching it, so its own duration inputs could
   drop states from the trail. Now a `watch`.
9. Demo 3 asserted `accept`/`multiple` stay in sync with the options but bound static literals.
10. Demo 4 claimed the paste path shares the rejection lifecycle and the upload dispatch, and wired
    neither.
11. Demo 7 covered only the no-arg `cancel()` / `retry()`; the per-file forms had no card anywhere.
12. Demo 5 had no card for `method: 'PUT' | 'PATCH'` or the function forms of `url` /
    `formDataExtras`, and its per-file progress bars were actively misleading under `batched: true`.
13. Manifest carried a stale test count and called demo 11 "two zones" when it renders three.

**Docs:** README gained a plugin/`DIRECTIVE_NAME` install section (the Quick start taught manual
registration only), a "Batched mode" subsection (the per-file fan-out was entirely undocumented),
an honest `enabled` row (it is a full teardown, not a listener detach), the null-entry folder
fallback, and two caveats. Bundle size re-measured: 13.9 KB / 4.7 KB gz.

**New permanent guard:** `playground/scripts/interactions.mjs` — a zero-dependency CDP driver
(Node 22's built-in `WebSocket`, matching `smoke.mjs`'s no-dependency rule rather than adding
Playwright). One spec per library under `scripts/interactions/`; each check gets a freshly loaded
page. `v-dropzone`'s spec is **51 checks over all 12 cards**, green against source and dist. Demo
12's folder walk runs against a real directory via `Input.dispatchDragEvent` — a synthetic
`DataTransfer` cannot carry filesystem-backed entries, which is exactly why bug 1 existed.
This closes the playground backlog's "Interaction coverage" item.

**Gates:** 264/264 vitest · `pnpm smoke` · `pnpm smoke:dist` · `pnpm typecheck` ·
`pnpm interactions` 51/51 · `pnpm interactions:dist` 51/51 · `dist/` rebuilt.

**Left open, deliberately** (both need an API decision, both logged in `TASKS.md`):
`UploadProgressEvent` / `UploadResult` are exported and README-documented but unreachable by
construction — wire them in or delete them before the first publish, since removing an exported
type later is breaking. And `cancel(file)` is a no-op on a *pending* record, so a queued file
cannot be removed from `api.pending` — decide whether that is a gap or the contract.

---

## 2026-05-16 — Run 9: DX completion (recipes + DropzoneApi reference + paste/programmatic playground demos + bundle-size measure) + reconciliation

**Picked task:** Top of `TASKS.md` after the prior run's CSS-vars + state-lifecycle work. Detected that test count drift (240, not 217) and the existence of `writeUploadVars` / `clearUploadVars` (vDropzone.ts:506–526) + the success/error state-lifecycle wiring (`advanceBatch` at lines 589–608 + `clearSuccessTimer` / `clearRejectTimer`) meant a prior CRON tick had quietly closed both items without updating TASKS/PROGRESS. Reconciled both, then advanced.

**Reconciliation log:**
- 240/240 tests green vs. 217 in the stale TASKS table.
- CSS variables for upload (`--dropzone-progress`, `--dropzone-files-pending`) confirmed in source at vDropzone.ts:506–526; pinned by 19 URL-path tests + 4 function-path tests + 1 autoUpload-interaction test in vDropzone.test.ts:4047–4396. Marked DONE.
- State lifecycle: success auto-clear via `successTimer` at vDropzone.ts:599–606 with `successDuration` config; error sticky (no timer); drag-during-upload via `nonDragRestState(instance)` at vDropzone.ts:534–537 + the dragleave handler. Default-duration test + sticky-error test + drop-during-success test in vDropzone.test.ts:4398–4455. Marked DONE.

**What I shipped this run (genuinely new):**
- README recipe 7: **Programmatic open / cancel / retry / dismiss via `ref`** — full template + `<script setup>` + `DropzoneApi` import. The directive's biggest hidden feature, now discoverable.
- README recipe 8: **Queue files, then upload on demand (`autoUpload: false`)** — list of `dz.pending` + button bound to `dz.upload()`.
- README new section: **Programmatic API (`DropzoneApi`)** — reference table for every member (state / pending / uploading / failed + open / upload / cancel / retry / dismissError) with semantics (e.g. cancel(file) for batched URL aborts the whole group; api object identity is stable across reactive opts updates).
- README new options: `autoUpload` + `ref` rows added to the Options table.
- README new section: **Bundle size** — 12.7 KB raw ESM + 4.3 KB gz, with the surface enumerated.
- `playground.html` new card 4: **Paste-from-clipboard anywhere on the page** — `paste: true, pasteOn: 'document', accept: 'image/*'` + image preview rendered via `URL.createObjectURL` (revoke on next paste).
- `playground.html` new card 5: **Programmatic API + autoUpload:false queue** — drop / browse files into a queue, then Upload / Cancel / Retry / Dismiss buttons. File list shows queued / uploading / failed status driven entirely by `apiRef.value.{pending,uploading,failed}`.
- `playground.html` CSS additions: `.controls`, `.file-list`, `.pasted-img`. Pure CSS — no JS state mirror.

**What's next:** P1 has 2 items left in package TASKS.md — `app.use()` plugin export (mirror v-teleport-to) and first-publish prep (1.0.0 + tarball smoke). Root TASKS top is now `v-trap-focus` audit (next package on the audit chain).

**Tests added/passing:** 0 added; 240/240 still green. README + playground are non-test artifacts; the existing test suite already covers the underlying behaviours.

**Validation:**
- `npx vitest run` → 240/240 green.
- `npm run build` → ESM **12.73 KB** + DTS **11.88 KB**.
- `wc -c dist/vDropzone.min.js` → 13036 bytes (12.7 KB).
- `gzip -9 -c dist/vDropzone.min.js | wc -c` → 4349 bytes (4.3 KB).
- `npm pack --dry-run` → 5-file tarball, 16.8 kB packed. README, LICENSE, dist/.d.ts, dist/.min.js, package.json. No source / test / playground / node_modules leakage.
- ESM smoke (`node --input-type=module -e "import('./dist/vDropzone.min.js')"`) → exports `default` + `vDropzone`; mounted/updated/unmounted are all functions.
- `dist/vDropzone.d.ts` exports every public type by name (DropzoneApi, DropzoneApiRef, DropzoneBinding, DropzoneHandler, DropzoneOptions, DropzonePasteScope, DropzoneRejectEvent, DropzoneRejectReason, DropzoneState, UploadConfig, UploadError, UploadFn, UploadMethod, UploadProgressEvent, UploadResult, UploadValueOrFn, vDropzone).

---

## 2026-05-16 — Run 8 backfill (reconciliation only — DropzoneApi + autoUpload)

**Reconciliation:** A prior CRON tick landed the full `DropzoneApi` programmatic surface (`open` / `upload` / `cancel` / `retry` / `dismissError`, reactive `state` / `pending` / `uploading` / `failed`) plus the `autoUpload` option, including 39 new tests (178 → 217 total), but did not append a PROGRESS entry or update TASKS.md. Today's CRON tick detected the drift, ran the suite to confirm 217/217 green, and reconciled both `TASKS.md` (root + package) so future runs pick up the correct next task.

**What the prior run shipped (reconstructed from source + test surface):**
- `DropzoneApi` interface + `DropzoneApiRef` exported from `vDropzone.ts`.
- Lazy `createApi(el, instance)` in `vDropzone.ts` returns a `reactive(...)` api keeping the same identity across reactive `opts` updates. `syncApi` handles first-time bind, swap-to-new-target, and detach-when-omitted.
- `attach()` initializes `records: Map<File, FileRecord>` and `uploadBatch: null` on the instance. `detach()` calls `abortAllUploads()` + `detachRef()`.
- `FileRecord` carries `{ file, status: 'pending'|'uploading'|'failed', xhr, controller, group, abortAnnounced }`. Records are added on drop/paste/pick when `upload` is configured.
- `api.open()` opens a hidden picker on demand (created via `ensurePickerInput` — same code path as `clickToPick`).
- `api.upload(files?)`: no-arg runs `pending` records through `startUploadsForRecords`; with-arg routes through `processFiles` so validation + `on()` + upload all fire.
- `api.cancel(file?)`: no-arg cancels every in-flight upload + settles the batch counter; with-arg cancels just that file's group (URL batched aborts whole batch).
- `api.retry(file?)`: no-arg retries every failed group as a single combined batch; with-arg retries the file's group.
- `api.dismissError()`: drops `failed` records from tracking and transitions `error` → `nonDragRestState` (idle or uploading).
- `autoUpload?: boolean` option (default `true`). When `false`, accepted files are tracked as `pending` records instead of immediately starting uploads; consumer triggers via `api.upload()`.

**Tests added (39 new):**
- 6 ref-lifecycle (populate on mount, plain `{value}` target, clear on unmount, same api across reactive updates, swap to new ref clears old, ref appearing after mount populates).
- 6 `open()` (works without clickToPick, with clickToPick, second open clears input.value, picked files run validation, app.unmount clears the input, validation-rejection updates state).
- 4 `upload(file|files[])` drop-like (single file, file array, validation rejection, autoUpload:false override).
- 4 `autoUpload:false` + `upload()` trigger.
- 4 cancel function-based (single, all, batch state settles to idle when no errors / to error when others failed, signal.aborted observable to consumer).
- 5 cancel URL-based + URL-batched.
- 4 retry function-based + URL batched.
- 2 dismissError (drops `failed`, transitions away from `'error'`).
- 3 reactive state (drives Vue computeds across drag / drop / cancel paths).
- 1 unmount cleanup (api.value cleared, pending records dropped, no stray listeners).

**Validation today (no new code):** `npx vitest run` → 217/217 green. No source delta this run.

**What's next:** TASKS.md next unchecked P0 item — **CSS variables during upload** (`--dropzone-progress`, `--dropzone-files-pending`). After that: README copy-paste recipes + bundle-size re-measure.

---

## 2026-05-15 — Run 3: click-to-pick (+ reconciled validation bookkeeping)

**Picked task:** Top of `TASKS.md` after the validation milestone — `clickToPick: true` opens a hidden `<input type="file">` on host click; same validation pipeline as drop.

**Run-1.5 reconciliation:** A previous CRON tick landed full validation (42 new tests; `accept` MIME wildcard / extension / mixed / case-insensitive / MIME-param strip; `multiple`/`maxSize`/`maxCount`; cumulative `reasons` in canonical `['type','size','count']` order; `data-dropzone="rejected"` with auto-clear; sticky-timer cleanup on unmount) but did not update TASKS/PROGRESS. Reconciled both files first, then proceeded.

**Design decisions:**
- **Shared `processFiles(el, instance, files)` between drop and pick.** Same `validate()`, same `data-dropzone="rejected"` lifecycle, same `clearRejectTimer` semantics. Drop now collapses to `extractFiles → processFiles`. The intent is invariant: "drop and pick are the same path after we have a `File[]`".
- **Hidden input lives inside the host element with `display: none`.** Keeps cleanup automatic (host unmount removes it), keeps it out of layout AND out of tab order. Picker activation is fully mediated by the host's click handler, so the input never needs to be focusable.
- **Interactive-descendant guard via `closest(INTERACTIVE_SELECTOR)`.** Selector: `'button, a, input, select, textarea, label, [contenteditable]:not([contenteditable="false"])'`. Walks ancestors so an icon inside a button is also skipped. The host element is matched but excluded (`interactive !== el`), so the host can still trigger the picker even if it's a `<label>` etc. Same check naturally swallows the synthetic click bubbling from our own hidden `<input>` — its `closest('input')` returns itself, !== el, skip; no recursion guard needed.
- **`input.value = ''` reset before each `.click()`.** Mirrors react-dropzone's pattern. Without it, picking the same file twice in a row would not refire `change`. Reset also on each `change` for the next round.
- **`syncPickerAttrs` is called on initial setup, on every `updated` while picker is on, and the picker is detached on `clickToPick: true → false`.** Reactive surface mirrors `accept` and `multiple` to the OS dialog. The OS filter is a hint — directive still re-validates on `change` because drag-from-finder bypasses `accept` on some platforms.
- **No keyboard activation.** Tab-to-host + Enter/Space to open is deliberately punted: the directive doesn't assume the host is focusable, and a consumer who wants this can add `tabindex="0"` + a `@keydown.enter.space="dropzoneEl.click()"` themselves. Adding it here would force a `role="button"` semantic on every dropzone, which is wrong for many designs.

**TDD pass:**
- Wrote 18 new tests covering: basic wiring (4), interactive-child guard (8 — button / a / input / textarea / select / label / contenteditable / icon-nested-in-button + synthetic-bubble), validation pipeline (5 — accept-fail / size-fail / count-fail / change-with-zero-files / valid-flow), hidden-input attribute mirror (5 — multiple default true / multiple false / accept set / accept unset / value-reset), reactive toggles (2 — false→true creates input / accept update syncs), disabled safety (1 — `enabled: false` short-circuits).
- 18/18 red on first run. Implemented `setupClickToPick`, `teardownClickToPick`, `syncPickerAttrs`, `processFiles`; wired into `attach` / `detach` / `updated`. 17/18 green next run; the one failure was a spy-collision artefact (testing `inputChild.click()` on a `<input type="checkbox">` tripped the prototype spy used for the picker). Fixed by dispatching the click event directly instead of going through `HTMLInputElement.prototype.click`.
- Final: **82/82 tests green.**

**Implementation:**
- `vDropzone.ts:42` — `clickToPick?: boolean` added to `DropzoneOptions`.
- `vDropzone.ts:163–183` — `DropzoneInstance.pickerInput / pickerHostClick / pickerChange` fields + `INTERACTIVE_SELECTOR` constant.
- `vDropzone.ts:194–223` — `processFiles` extracted from the old drop handler (single shared pipeline).
- `vDropzone.ts:225–289` — `syncPickerAttrs`, `setupClickToPick`, `teardownClickToPick`.
- `vDropzone.ts:331–337` — drop handler now `extractFiles → processFiles`.
- `vDropzone.ts:347` — initial picker setup on attach when `clickToPick: true`.
- `vDropzone.ts:387–395` — `updated` honors `clickToPick` toggle and syncs `accept` / `multiple` on the hidden input.

**Validation:**
- 82/82 vitest pass.
- `npm run build` emits `dist/vDropzone.min.js` (~3.95 KB) + `dist/vDropzone.d.ts` (2.02 KB). Bundle budget is 6 KB ESM — well under, with paste + upload still to add.
- `npm pack --dry-run` confirms 5-file tarball: LICENSE + README.md + dist/vDropzone.d.ts + dist/vDropzone.min.js + package.json. 6.5 kB packed. No source / test / playground / node_modules leakage.
- ESM smoke (`node --input-type=module -e "import('./dist/vDropzone.min.js')"`) confirms public surface: `default` + `vDropzone` exports both present; `mounted` / `updated` / `unmounted` are all functions.
- `dist/vDropzone.d.ts` re-checked — all public types exported (`DropzoneBinding`, `DropzoneHandler`, `DropzoneOptions` including `clickToPick`, `DropzoneRejectEvent`, `DropzoneRejectReason`, `DropzoneState`).

**Reachability:**
- Template: `<div v-dropzone="{ clickToPick: true, accept: 'image/*', on: handleFiles }" />`
- Playground: open `playground.html` after `npm run build` — second card demos click-to-pick with a `<button>` inside that intentionally does NOT open the picker.
- README: "Click anywhere to open the native file picker" recipe + updated options table + final "Behavior" bullet covering the interactive-child guard semantics.

**What's next:** TASKS.md next unchecked P0 item — **paste-from-clipboard** (`paste: true`, optionally `pasteOn: 'document'`). Builds on the same `processFiles` pipeline; need to handle `event.clipboardData.items` filtering for `kind === 'file'` and document the iOS Safari paste-outside-input limit.

---

## 2026-05-15 — Run 1: scaffold + drag-drop core (P0 first + second items done)

**Picked task:** Bootstrap + drag-drop core. Top of `TASKS.md`.

**Design decisions:**
- **Bare handler OR options object as binding value.** `v-dropzone="onFiles"` (bare) and `v-dropzone="{ on, accept, … }"` (full) both work. `resolveOptions` collapses the two shapes — bare function becomes `{ on: fn }`. Mirrors `v-trap-focus` which accepts `boolean | TrapFocusOptions`. Reduces the simplest call site to a single binding character.
- **Enter/leave counter is the contract.** `dragenter` increments, `dragleave` decrements, `drop` resets to 0. Without this counter, every `dragleave` from a child fires a phantom transition to `idle` while the cursor is still inside the host — the canonical drop-zone bug. Pinned in 13 tests; the cursor-crosses-children test fails any implementation that ignores the counter.
- **`dragover` always `preventDefault`s.** Without this, the browser navigates away when the user drops. Documented at the source line + pinned in the test suite.
- **Listeners close over `instance.opts` (mutable bag), not the binding value.** Vue calls `updated` with `binding.value`; we replace `instance.opts` so the same listeners read the new config on the next event. No need to detach+reattach on every `updated`. The `enabled` toggle is the only case that detaches.
- **`WeakMap<HTMLElement, DropzoneInstance>` keying.** Identical to `v-trap-focus` / `v-teleport-to`. Lets two `v-dropzone` instances on the same page operate independently; cleans up automatically when the host is GC'd; works inside `v-for` without per-iteration setup.
- **`data-dropzone="idle"` set on mount, removed on unmount.** Initial value is `'idle'` so consumer CSS hooks can rely on `[data-dropzone]` being present at all times after `mounted`. On `unmount` we remove the attribute (not set it to `'idle'`) so a `[data-dropzone]:not([data-dropzone="active"])` style doesn't accidentally style a now-unmanaged element.
- **No README / playground depend on built dist for the test suite** — tests import the source file directly. Playground imports `dist/vDropzone.min.js` (built before opening the playground), mirroring `v-teleport-to`'s approach.

**TDD pass:**
- Wrote `vDropzone.test.ts` with 13 tests covering the contracts above. Implemented `vDropzone.ts` against the failing tests.
- One pass — all 13 green on first run of `npm test`. The implementation closely tracks the v-trap-focus pattern, which is why it landed in one cycle.

**Implementation:**
- `vDropzone.ts:1–169` — public types + `resolveOptions` + `extractFiles` + per-element `DropzoneInstance` + `attach`/`detach` lifecycle + `vDropzone` directive (`mounted` / `updated` / `unmounted`).
- `vDropzone.test.ts:1–187` — test suite + jsdom DataTransfer/DragEvent shims (jsdom doesn't construct these natively).
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `LICENSE`, `.gitignore`, `playground.html`, `README.md` — scaffolding files. All mirror `v-trap-focus` exactly.

**Validation:**
- 13/13 vitest pass.
- `npm run build` emits `dist/vDropzone.min.js` (1.59 KB) + `dist/vDropzone.d.ts` (1.77 KB). Build clean, no warnings.
- `npm pack --dry-run` shows 4-file tarball: LICENSE + dist/vDropzone.d.ts + dist/vDropzone.min.js + package.json. 2.8 kB packed. No source/test/playground/node_modules leakage.
- ESM smoke (`node --input-type=module -e "import(./dist/vDropzone.min.js)"`) confirms public surface: `default` + `vDropzone` exports both present, `vDropzone.mounted` is a function.

**Reachability:**
- Source: `import { vDropzone } from '@ozjsey/v-dropzone'` → `app.directive('dropzone', vDropzone)`.
- Template: `<div v-dropzone="onFiles" />` (bare) or `<div v-dropzone="{ on, accept, ... }" />` (full).
- CSS hooks: `[data-dropzone="active"]` while dragging; `[data-dropzone="idle"]` otherwise.
- Playground: open `playground.html` after `npm run build`.

**What's next:**
TASKS.md P0 next unchecked item: `accept` filter + `multiple`/`maxSize`/`maxCount` validation + `'rejected'` state attribute with auto-clear. That builds directly on the counter + state machine landed this run.

---
