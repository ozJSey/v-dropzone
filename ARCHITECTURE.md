# Architecture

`vDropzone.ts` is the build entry; it re-exports `src/index.ts`. Each module has one purpose;
dependencies point strictly downward — no cycles.

```
vDropzone.ts               entry — re-exports src/index
└── src/
    ├── index.ts           public surface: vDropzone, DropzonePlugin, DIRECTIVE_NAME, types
    ├── plugin.ts          DropzonePlugin + DIRECTIVE_NAME
    ├── directive.ts       binding resolution, attach/detach, the `updated` option diff
    ├── drag.ts            the four drag listeners: depth counter, folder-aware drop
    ├── api.ts             the reactive DropzoneApi + ref attach/detach lifecycle
    ├── paste.ts           clipboard listener on host or document (pasteOn)
    ├── picker.ts          visually-hidden <input type=file>, its a11y state, the stray-click
    │                      guards, and `wantsClickToPick` — the click-to-pick default
    ├── anchor.ts          the picker input's containing block: the one place the directive
    │                      writes layout to the host, and the guard that reverts it
    ├── process.ts         THE pipeline: validate → state → on/onReject → upload/queue
    ├── upload-control.ts  cancel (group / all / hard-abort) + retry
    ├── upload.ts          XHR pipeline, function transport, upload kickoff + settle
    ├── state.ts           instance shape, WeakMap store, and every reflection:
    │                      data-dropzone, --dropzone-* CSS vars, reactive api arrays
    ├── validate.ts        accept matching + per-file vs drop-level rules
    ├── files.ts           DragEvent/ClipboardEvent → File[], folder walking
    ├── constants.ts       defaults, the interactive-descendant selector, the clip recipe
    └── types.ts           all public types
```

The invariants the layout encodes:

- **`process.ts` is the one pipeline.** Drop (`drag.ts`), pick (`picker.ts`), paste (`paste.ts`)
  and `api.upload(files)` all call `processFiles` — validation and state transitions can never
  diverge between input paths. It is also the one place that prunes failed records, because
  "reseed on the next drop" is a property of *files arriving*, not of an upload starting: retry
  and `api.upload()` reach `startUploadsForRecords` directly, and retrying one failed file must
  not discard another's record. The single deliberate divergence is `processFiles`' `forceUpload`
  flag, which only `api.upload(files)` passes: `autoUpload: false` holds back the *automatic*
  dispatch that follows a drop, a paste or a pick, but an explicit imperative call must still
  upload. Validation is not skippable — `forceUpload` bypasses the queue, never the gate.

  **And no path through it writes the literal `'idle'`.** Every "this call starts no request"
  exit goes through `nonDragRestState(instance)`, because arriving files say nothing about work
  already in flight. Three of the four exits learned that the hard way and the fourth shipped:
  `drop` fires for a dragged text selection, a link and an empty folder, and `change` fires with
  zero files when the dialog is dismissed, so the empty-list branch ran constantly — and its
  `'idle'` reported a live upload as finished, made `api.state` disagree with `api.uploading`,
  and dropped `progressBatch`, after which `writeUploadVars` re-cleared the CSS variables on
  every later progress event and the bar never came back (0.1.2). A hardcoded rest state in this
  module is always the bug.
- **One resolver per defaulted option, in the module that owns the feature.** `clickToPick`
  defaults to *on*, so "omitted" and `true` must resolve identically everywhere. `picker.ts`
  exports `wantsClickToPick(opts)` and `directive.ts` calls it in both places that need it —
  `attach` and the `updated` diff. Re-deriving the default at either site (`!!opts.clickToPick`)
  makes them disagree, and the disagreement is silent in both directions: `{ clickToPick: false }`
  → `{}` never wires the zone up, `{ clickToPick: true }` → `{}` tears a working zone down. That
  bug shipped once; the resolver is what stops it recurring. The same idiom (`!== false`) is why
  `multiple`, `enabled` and `autoUpload` are read through a single expression each.
- **The host is the picker input's containing block, or the keyboard affordance is a trap.**
  The picker `<input type="file">` must be out of flow (in flow it is a flex/grid item and moves
  the consumer's content — measured at 170px on a `space-between` zone), and focusing it scrolls
  the page to wherever it is. Those two facts together mean the absolute offsets have to resolve
  against the *zone*, so `anchor.ts` sets `position: relative` on a host that has none, and only
  while the input is a tab stop. Shipping the offsets without the anchor is DZ-3: on a `static`
  host they resolve against the initial containing block, the input sits at document (0, viewport
  height) whatever page the zone is on, and a real Tab moved `scrollY` 5535 → 656 with the zone
  5722px below the fold. `anchor.ts` is deliberately the *only* module that writes layout to the
  host, and teardown reverts only a value the module can still see is its own: the
  `pickerHostPositioned` flag says it wrote a position at some point, and the current inline value
  says whether that write is still standing. The flag alone is not enough — a consumer who
  positions the host *after* the anchor went in (an object `:style`, a conditional class, a sticky
  header) owns the property from then on, and Vue will not restore their value if teardown deletes
  it (`patchStyle` skips when the binding is unchanged). The
  anchor is re-asserted on every `updated` and reads the host's *computed* position to decide,
  because the inline style it writes is shared territory: Vue patches a string `:style` binding
  with `el.style.cssText = next` and takes the anchor with it.
- **Every write into the consumer's host is idempotent.** `setState`, `syncPickerAttrs` and
  `applyPickerA11y` run on every `updated`, i.e. on every re-render of the component that owns
  the zone, and `setAttribute` queues a `MutationRecord` even when the value is unchanged. A
  consumer observing their own zone — which is exactly what a demo card that reads the
  directive's work back out of the DOM does — and writing reactive state from the callback then
  has no fixed point: mutation → state → render → `updated` → mutation. The loop is
  microtask-driven, so the tab never yields; it hung the playground's `13-click-opt-out.vue` on
  load and, with it, every interaction check on the whole tab. `setAttr` writes only on a real
  difference, which is what terminates it. `setState` does the same for `data-dropzone` — it used
  to write unconditionally, and `processFiles` writes `'idle'` on every empty pick and every
  non-upload drop. Reading an attribute to suppress an identical write is not the same as reading
  it to find out what the state is; the value always comes from the caller.
- **One store, and everything else is a projection of it.** This is the invariant the package
  most needed and least had. `instance.records` is the only place the facts live — what files
  exist, which are queued, in flight, or failed. Every question the state machine asks is asked of
  it (`hasInflight`, `hasFailed`, `nonDragRestState`), and `instance.state` is the single memory of
  the answer. `data-dropzone`, `api.state` and the api arrays are written *out* of those two and
  never read back in.

  Version 0.1.0 had three stores for one question and they disagreed. A per-batch counter
  (`uploadBatch`) that any new drop overwrote decided "is the upload finished?"; `records`, never
  pruned, decided "is there an error?"; and `el.getAttribute('data-dropzone')` — the consumer's own
  DOM node — was read back by four transitions as the machine's memory. Overlapping drops made all
  three disagree at once: the zone announced `success` with two files still uploading and then
  swallowed their failure, because the counter it would have been reported through had already
  been discarded. Both of the state bugs repaired in Run 20 were the same shape.

  The rule that prevents the next one: **a new fact about a file goes in the record, and any code
  that wants to know what the zone is doing derives it.** No module may keep a second tally.
  `progressBatch` is the single deliberate exception — it holds records already deleted from
  `records` so the CSS vars can show 100% through the `success` window — and it is a *snapshot for
  display*, never consulted for a transition. A new batch merges into it rather than replacing it.

- **`state.ts` owns every reflection.** Nothing else writes `data-dropzone`, the CSS variables, or
  the api arrays directly; modules mutate the instance and call the reflection helpers. That is
  what keeps the attribute, the vars, and the reactive arrays consistent with each other.

Copy-paste consumers: every file under `src/` plus the entry is self-contained TypeScript with no
dependencies beyond the `vue` peer — take the folder as-is.
