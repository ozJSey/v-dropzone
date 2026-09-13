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
    ├── upload.ts          XHR pipeline, function transport, batch bookkeeping
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
  diverge between input paths. The single deliberate divergence is `processFiles`' `forceUpload`
  flag, which only `api.upload(files)` passes: `autoUpload: false` holds back the *automatic*
  dispatch that follows a drop, a paste or a pick, but an explicit imperative call must still
  upload. Validation is not skippable — `forceUpload` bypasses the queue, never the gate.
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
  host, and `pickerHostPositioned` is what stops it reverting a value it did not write. The
  anchor is re-asserted on every `updated` and reads the host's *computed* position to decide,
  because the inline style it writes is shared territory: Vue patches a string `:style` binding
  with `el.style.cssText = next` and takes the anchor with it.
- **Every write into the consumer's host is idempotent.** `syncPickerAttrs` and
  `applyPickerA11y` run on every `updated`, i.e. on every re-render of the component that owns
  the zone, and `setAttribute` queues a `MutationRecord` even when the value is unchanged. A
  consumer observing their own zone — which is exactly what a demo card that reads the
  directive's work back out of the DOM does — and writing reactive state from the callback then
  has no fixed point: mutation → state → render → `updated` → mutation. The loop is
  microtask-driven, so the tab never yields; it hung the playground's `13-click-opt-out.vue` on
  load and, with it, every interaction check on the whole tab. `setAttr` writes only on a real
  difference, which is what terminates it.
- **`state.ts` owns every reflection.** Nothing else writes `data-dropzone`, the CSS variables, or
  the api arrays directly; modules mutate the instance and call the reflection helpers. That is
  what keeps the attribute, the vars, and the reactive arrays consistent with each other.

Copy-paste consumers: every file under `src/` plus the entry is self-contained TypeScript with no
dependencies beyond the `vue` peer — take the folder as-is.
