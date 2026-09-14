### [@ozjsey/v-dropzone](https://www.npmjs.com/package/@ozjsey/v-dropzone)

See in action: [npm portfolio playground](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone).

**Or go straight to the card for the thing you came for** — real files, a real dev server, and
every card editable in the browser:
[drop or click](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/drop-basic) ·
[validation](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/validation) ·
[upload with progress](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/url-upload) ·
[custom transport](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/fn-upload) ·
[paste a screenshot](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/paste) ·
[the `DropzoneApi`](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/api) ·
[folder drop](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/folder-drop)

Vue 3 directive owning the full drag-drop pipeline. Drop / paste / click-to-pick → validate → upload → state. One binding, zero wrapper components, full TypeScript.

> **Status:** `0.1.0` — drag-drop core + folder drops + validation + click-to-pick (**on by default**) + paste-from-clipboard + URL-based upload + function-based upload + programmatic `DropzoneApi` (via `ref`) + `autoUpload` + CSS progress variables. 330/330 vitest. See `TASKS.md` for the remaining polish items.

## Install

```bash
npm install @ozjsey/v-dropzone
```

## Quick start

```ts
// main.ts
import { createApp } from 'vue'
import { DropzonePlugin } from '@ozjsey/v-dropzone'
import App from './App.vue'

const app = createApp(App)
app.use(DropzonePlugin)   // registers `v-dropzone` app-wide
app.mount('#app')
```

Three equivalent install paths — pick whichever fits your setup:

```ts
import { DropzonePlugin, DIRECTIVE_NAME, vDropzone } from '@ozjsey/v-dropzone'

app.use(DropzonePlugin)                       // 1. plugin (recommended)
app.directive(DIRECTIVE_NAME, vDropzone)      // 2. manual, canonical name
app.directive('my-dropzone', vDropzone)       // 3. manual, your own name
```

`DIRECTIVE_NAME` is the string `'dropzone'` — exported so a test can assert the registration
(`app._context.directives[DIRECTIVE_NAME]`) without hard-coding it. `app.use(DropzonePlugin)` is
idempotent: Vue caches installed plugins per app, so a second call is a no-op.

Or register it on a single component instead of app-wide:

```vue
<script setup lang="ts">
import { vDropzone } from '@ozjsey/v-dropzone'   // `v`-prefixed, so the template picks it up as v-dropzone
</script>
```

```vue
<template>
  <div v-dropzone="onFiles" class="dz">
    Drop files here, or click to browse
  </div>
</template>

<script setup lang="ts">
function onFiles(files: File[]): void {
  console.log('got', files)
}
</script>

<style>
.dz                              { border: 2px dashed #aaa; padding: 2rem; border-radius: 8px; cursor: pointer; }
/* The picker input is clipped, so its own focus ring is invisible —
   the host renders focus on its behalf. Do not skip this rule. */
.dz:focus-within                 { outline: 2px solid #4f46e5; outline-offset: 2px; }
.dz[data-dropzone="active"]      { border-color: #4f46e5; background: #eef2ff; }
.dz[data-dropzone="rejected"]    { border-color: #dc2626; background: #fef2f2; }
.dz[data-dropzone="uploading"]   { border-color: #2563eb; background: #eff6ff; }
.dz[data-dropzone="success"]     { border-color: #16a34a; background: #f0fdf4; }
.dz[data-dropzone="error"]       { border-color: #dc2626; background: #fef2f2; }
</style>
```

That zone already does three things, with no options passed: files can be **dropped** on it,
**clicked** into it (the native picker opens), and reached with **Tab** + Enter. Click-to-pick is
on by default — pass `clickToPick: false` for a drag-only zone. See
[Accessibility](#accessibility) for the two CSS rules that make the click and keyboard
affordances visible.

**The one thing the directive writes to your host is `position: relative`**, and only when your
host has no `position` of its own. The keyboard route in is a real `<input type="file">` living
inside the zone, clipped to 1×1 and positioned at the zone's top-left; focusing it scrolls the page
to wherever it is, so it has to resolve against *your* zone rather than against the initial
containing block. Give the host any `position` yourself — `relative`, `absolute`, `fixed`,
`sticky` — and the directive stands down and never touches it, **as long as that `position` is
unconditional**. See [Caveats](#caveats) for what a media-query `position` does, and for the
one-line way to avoid it. The cost of the default is the usual one: a positioned host is a
containing block for your own absolutely positioned children.

## Why this exists

HTML drag-and-drop is famously awful:

- **4 events to wire** — `dragenter`, `dragover`, `dragleave`, `drop`. All four need `event.preventDefault()` (or the file opens in the browser tab).
- **`dragleave` fires on every child enter** — moving the cursor between children fires phantom leave events. Consumer must implement an enter/leave counter.
- **No native UI affordance for "drop active"** — consumer wires hover state manually.
- **No click or keyboard route** — a drag is the only way in, which excludes anyone who cannot perform one. Every dropzone therefore hand-rolls a hidden `<input type="file">`, a click listener, and (rarely, which is the problem) a way to reach it with a keyboard.
- **Manual MIME / size / count filtering** — every dropzone library re-implements this.
- **Paste-from-clipboard is separate** — `paste` event with `clipboardData.items` is a different API entirely.
- **No upload primitive** — consumers reach for `axios`, `fetch`, `xhr-onprogress` packages and re-implement progress / cancel / retry.

`v-dropzone` is the directive that owns the entire pipeline. Consumer writes CSS for `[data-dropzone="..."]`; everything else is config.

## Recipes

> Every zone below is also **click-to-pick and keyboard-reachable** — that is the default, and it
> is not repeated in each snippet. Add `clickToPick: false` for a drag/paste-only zone, and give
> the host `cursor: pointer` + a `:focus-within` outline so both affordances are visible
> ([Accessibility](#accessibility)).

> **Every recipe below is a card**, with the upload paths pointed at a real endpoint:
> [1 drop or click](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/drop-basic) ·
> [2 validation](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/validation) ·
> [3 upload to a URL](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/url-upload) ·
> [4 custom transport](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/fn-upload) ·
> [5 paste](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/paste) ·
> [6 click opt-out](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/click-opt-out) ·
> [7 the api](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/api) ·
> [8 queue, then upload](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/auto-upload-queue)

### 1. Drop or click, then display

```vue
<div v-dropzone="(files) => myFiles = files" />
```

One binding, three input routes: drop, click-to-pick, and Tab + Enter.

### 2. Drop + validation + display

```vue
<div v-dropzone="{
  accept: 'image/*,.pdf',
  maxSize: 5_000_000,
  maxCount: 5,
  on:       (files) => myFiles = files,
  onReject: ({ files, reasons }) => console.warn('rejected', reasons),
}" />
```

### 3. Drop + auto-upload to a URL

```vue
<template>
  <div v-dropzone="options" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropzoneOptions } from '@ozjsey/v-dropzone'

const token = ref('')
const myFiles = ref<{ file: File; response: unknown }[]>([])

const options = computed<DropzoneOptions>(() => ({
  upload: {
    url: '/api/upload',
    headers: () => ({ Authorization: `Bearer ${token.value}` }),
  },
  onProgress: (file, percent) => console.log(file.name, percent),
  onUploaded: (file, response) => myFiles.value.push({ file, response }),
  onError:    (file, error) => console.error(file.name, error.message),
}))
</script>
```

> **`token.value` only works because this object is in `<script setup>`.** Written inline in the
> template, `token` is already unwrapped, so `token.value` is `undefined` and every request goes out
> as `Authorization: Bearer undefined` — measured, against a server that echoes the header back. The
> upload *succeeds* against a mock; it is a 401 on the real one, and it looks like your auth wiring.
> See [Writing options inline](#writing-options-inline).

### 4. Drop + custom transport (S3 presigned URL via `fetch`)

```vue
<template>
  <div v-dropzone="options" />
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { DropzoneOptions } from '@ozjsey/v-dropzone'

const savedKeys = reactive<Record<string, string>>({})

async function getPresignedUrl(name: string) {
  const res = await fetch(`/api/presign?name=${encodeURIComponent(name)}`)
  return res.json() as Promise<{ url: string; key: string }>
}

const options = computed<DropzoneOptions>(() => ({
  upload: async (file, signal, onProgress) => {
    const presigned = await getPresignedUrl(file.name)
    const res = await fetch(presigned.url, { method: 'PUT', body: file, signal })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    onProgress?.(100)
    return { key: presigned.key }
  },
  onUploaded: (file, response) => (savedKeys[file.name] = (response as { key: string }).key),
  onError:    (file, error)   => console.error(file.name, error.message),
}))
</script>
```

> **`fetch` only works because this object is in `<script setup>`.** Inline in the template it
> compiles to `_ctx.fetch(…)` and throws `_ctx.fetch is not a function` on the first upload —
> `data-dropzone="error"`, zero uploads, in **any** Vue 3 SFC. See
> [Writing options inline](#writing-options-inline).

### 5. Paste-screenshot anywhere on the page

```vue
<div v-dropzone="{ paste: true, pasteOn: 'document', accept: 'image/*', on: handleImage }">
  Paste a screenshot anywhere — it lands here.
</div>
```

### 6. Opt out of click-to-pick, or narrow it

Clicking the zone opens the native file picker by default — this recipe is about turning that
off, or teaching it about your own clickables.

```vue
<!-- drag / paste only: no picker, no input in the DOM, no tab stop -->
<div v-dropzone="{ clickToPick: false, accept: 'image/*', on: handleFiles }">
  Drop files here
</div>
```

Clicks on interactive descendants already keep their own semantics and do **not** open the
picker: `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `[contenteditable]`,
anything with a `tabindex` other than `-1`, `[role="button"]`, `<summary>`, and
`<audio>` / `<video>` with `controls` — plus any descendant nested inside one of those.

For custom clickables that list cannot see, extend it per zone with `clickIgnore`:

```vue
<div v-dropzone="{ clickIgnore: '.file-chip, [data-remove]', on: handleFiles }">
  <span v-for="f in files" :key="f.name" class="file-chip">
    {{ f.name }} <i data-remove @click="remove(f)">×</i>
  </span>
  Drop more files, or click to browse
</div>
```

`clickIgnore` is merged into the same `closest()` lookup, so a match anywhere up the ancestor
chain suppresses the pick. Two other clicks are suppressed for you: the second click of a
**double-click** (it would otherwise open two pickers), and the click that ends a **text
selection** touching the zone (selecting the instructional copy should not summon a file dialog).

### 7. Programmatic open / cancel / retry / dismiss via `ref`

Pass a Vue `ref` and the directive populates it with a reactive `DropzoneApi`:

```vue
<template>
  <div v-dropzone="options">
    Drop files <em>or use the buttons below</em>
  </div>

  <button @click="dz?.open()">Browse…</button>
  <button v-if="dz?.uploading.length" @click="dz!.cancel()">Cancel all</button>
  <button v-if="dz?.failed.length"    @click="dz!.retry()">Retry failed</button>
  <button v-if="dz?.state === 'error'" @click="dz!.dismissError()">Dismiss</button>

  <p v-if="dz?.uploading.length">Uploading {{ dz.uploading.length }} of {{ dz.uploading.length + dz.pending.length }}…</p>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropzoneApi } from '@ozjsey/v-dropzone'

const dz = ref<DropzoneApi>()

// Build the options here, not inline in the template — see the note below.
const options = computed(() => ({ ref: dz, upload: { url: '/api/upload' } }))
</script>
```

> **`ref` must be passed from `<script setup>`, never from a template expression.**
> Vue unwraps refs inside template expressions, so `v-dropzone="{ ref: dz }"` hands the directive
> `dz.value` — `undefined` at mount — and the api never binds. Nothing throws: the buttons just
> stay dead. It is one instance of the general rule below.

Every method works from outside the zone — fire `dz.open()` from a global toolbar, a keyboard
shortcut, or any other event source. The reactive `state` / `pending` / `uploading` / `failed`
arrays drive the UI; consumer never reads from the DOM.

A "Browse…" button *inside* the zone needs no special handling: `<button>` is in the interactive
list, so its click never doubles as a pick. A button *outside* the zone calling `dz.open()` is
already the visible affordance for the picker — if that is your whole design, pass
`clickToPick: false` so the zone itself is drag-only and contributes no second tab stop.

### 8. Queue files, then upload on demand (`autoUpload: false`)

```vue
<template>
  <div v-dropzone="options">
    Drop files (they queue — nothing uploads yet)
  </div>

  <ul>
    <li v-for="f in dz?.pending ?? []" :key="f.name">
      {{ f.name }}
      <button @click="dz!.upload(f)">upload just this one</button>
    </li>
  </ul>
  <button :disabled="!dz?.pending.length" @click="dz!.upload()">Upload {{ dz?.pending.length }} file(s)</button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropzoneApi } from '@ozjsey/v-dropzone'

const dz = ref<DropzoneApi>()
const options = computed(() => ({ ref: dz, autoUpload: false, upload: { url: '/api/upload' } }))
</script>
```

`autoUpload: false` flips drop / paste / pick into queue-only mode — accepted files land in `dz.pending` until `dz.upload()` is invoked. Useful for review-before-upload UIs, batched-with-a-form-submit flows, or per-file selection ("upload only the ones I checked").

Per-file vs all-or-nothing validation:

- `accept` and `maxSize` are **per-file**. Files passing the rules go to `on`; failing files go to `onReject` with cumulative reasons.
- `multiple: false` and `maxCount` are **drop-level**. If violated, the entire drop is rejected with reason `'count'`. Drop-level means *this event only* — neither rule looks at files the zone is already holding, so repeated drops can push `dz.pending` past `maxCount`.

## Writing options inline

An inline `v-dropzone="{ … }"` is a **template expression**, and a template expression is not
ordinary JavaScript. Two rules apply to everything you write inside one, options and callbacks
alike:

1. **A setup `ref` is already unwrapped, so `.value` is `undefined`.** `token.value` inside the
   template is `undefined`, not the token; `dz` is the api, not the ref that should receive it.
   (Plain reads and assignments of a `ref` *are* rewritten for you — `myFiles = files` and
   `myFiles.push(f)` work inline. It is `.value` that breaks, in both directions.)
2. **Only these globals resolve; anything else compiles to `_ctx.<name>` and is `undefined`:**
   `Infinity`, `undefined`, `NaN`, `isFinite`, `isNaN`, `parseFloat`, `parseInt`, `decodeURI`,
   `decodeURIComponent`, `encodeURI`, `encodeURIComponent`, `Math`, `Number`, `Date`, `Array`,
   `Object`, `Boolean`, `String`, `RegExp`, `Map`, `Set`, `JSON`, `Intl`, `BigInt`, `console`,
   `Error`, `Symbol`. So `fetch`, `FormData`, `localStorage`, `AbortController`, `URL`,
   `Headers`, `Blob`, `crypto` and `window` are **not** available — `fetch(…)` inline throws
   `_ctx.fetch is not a function`. (`console` and `Error` are on the list, which is why
   `console.error` and `throw new Error` are fine.)

Both failures are silent-ish and easy to blame on the wrong layer: rule 1 sends
`Authorization: Bearer undefined` and still gets a 2xx from a permissive server, and rule 2 surfaces
as an upload error rather than a template error.

**The fix for all of it is the same: build the options object in `<script setup>` and pass the
binding by name.** A `computed` keeps it reactive; a plain `const` is enough for a static one.

```vue
<div v-dropzone="options" />
```

Short, self-contained bindings stay fine inline — `v-dropzone="(files) => myFiles = files"`,
`v-dropzone="{ accept: 'image/*', on: handleFiles }"` — because they touch neither `.value` nor a
non-allowlisted global.

## Upload pipeline

Pass `upload` to drive the directive's built-in pipeline. Two shapes are accepted:

### URL-based (`upload: UploadConfig`)

The directive owns the `XMLHttpRequest` + `FormData` plumbing and surfaces progress events.

```ts
const upload = {
  url: '/api/upload',                  // string OR (file) => string for dynamic URLs (e.g. S3 presigned)
  method: 'POST',                       // 'POST' (default) | 'PUT' | 'PATCH'
  headers: { Authorization: '…' },     // object OR (file) => object for dynamic headers
  fieldName: 'file',                    // FormData field name (default 'file')
  formDataExtras: { folder: 'x' },     // extra FormData fields (object or function of file)
  batched: false,                       // false (default) → one XHR per file; true → all files in one XHR
  withCredentials: false,               // pass-through to xhr.withCredentials
  timeout: 0,                           // ms, 0 = no timeout (default)
  parseResponse: (xhr) => xhr.responseText, // override the default JSON-when-applicable parser
}
// …then bind it: <div v-dropzone="{ upload }">
```

**Defaults:**

- Response is auto-parsed as JSON when `Content-Type: application/json` is sent (or when no content-type header is present and the body parses as JSON). Malformed JSON falls back to the raw `responseText`.
- The directive does **not** set `Content-Type`. XHR + FormData generates the correct `multipart/form-data; boundary=…` automatically; consumer-supplied `Content-Type` is filtered out.

### Batched mode (`batched: true`)

One `XMLHttpRequest` carries the whole accepted group instead of one per file. The per-file surface
degrades in ways worth knowing before you tick it:

- **`url`, `headers` and `formDataExtras` resolve once**, against the *first* file in the batch. A
  function form that varies per file (a presigned URL, a per-file checksum header) is incompatible
  with `batched: true` — use the default one-request-per-file mode for those.
- **`onProgress`, `onUploaded` and `onError` still fire once per file**, but every call carries the
  *request-wide* payload: the same percent, the same parsed response, the same error. A per-file
  progress bar under `batched: true` is really N copies of one bar.
- **The group succeeds or fails together** — a non-2xx answer errors every file in it, and
  `cancel(file)` aborts the whole group (there is only one request to abort).

### Function-based (`upload: UploadFn`)

For S3 presigned URLs, axios, fetch + ReadableStream, GraphQL multipart, or any custom transport.

```ts
upload: async (file: File, signal: AbortSignal, onProgress?: (percent: number) => void) => {
  const res = await fetch('/api/upload', { method: 'POST', body: file, signal })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return await res.json() // surfaced to onUploaded(file, response)
}
```

**Contract:**

- One call per **accepted** file (rejected files don't run the function).
- The directive `signal` is fired on host unmount. Cooperative transports should pass it through.
- The optional 3rd-arg `onProgress(percent)` is wired to the directive's `opts.onProgress` callback. Call it from `0..100` (clamped + rounded by the directive). Transports without a progress channel can omit calls.
- Thrown errors (`Error` or any value) drive `data-dropzone="error"` and fire `onError(file, { message })`. Non-`Error` throws fall back to `{ message: 'Upload failed' }`.
- `batched` is URL-only — function-based always runs one call per file. A consumer who wants batching should group inside their function.

## State attribute

> [State lifecycle](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/state-machine) walks every transition below, including the sticky-error
> rule, with the attribute printed as it changes.

`data-dropzone` reflects the current state. Style with pure CSS, no JS state mirror needed:

| State | Trigger |
|---|---|
| `idle` | default |
| `active` | drag is over the zone (counter > 0) |
| `rejected` | last drop failed validation; auto-clears to `idle` after `rejectDuration` ms (default `1500`). Cancelled if a new drag starts |
| `uploading` | at least one upload is in flight (URL or function-based). Drag during upload temporarily flips to `active`; dragleave restores `uploading`. Drops overlap safely — dropping again while files are still on the wire keeps the zone `uploading` until **every** outstanding file has answered, not just the newest drop's |
| `success` | everything outstanding completed, with nothing failed. Auto-clears to `idle` after `successDuration` ms (default `1500`) |
| `error` | at least one tracked file failed. **Sticky** — never auto-clears. Cleared by `retry()`, `cancel(file)`, `dismissError()`, or by the next drop / paste / pick that brings in accepted files (which discards the failed records along with the state — see `failed` below) |

The state is decided from the files the zone is tracking, so it cannot disagree with `api.failed`:
while any file is in flight the zone is `uploading`, and while any tracked file has failed and has
not been retried or dismissed the zone is `error`.

## CSS variables during upload

> [CSS-only progress UI](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/css-progress) builds the bar from these two variables alone — no JS
> mirror — including what it does when a file fails at 70%.

The directive writes two CSS custom properties on the host element while an upload is in flight, so you can build a progress UI in pure CSS:

| Variable | Type | Meaning |
|---|---|---|
| `--dropzone-progress` | integer `0..100` | Rounded average percent across every file in the active batch |
| `--dropzone-files-pending` | integer | Number of files in the active batch that haven't settled yet (success / error / timeout) |

Both vars are **set** when uploads start, **persist** through `uploading` / `active` (drag-during-upload) / `success` / `error` states, and **clear** when the host returns to `idle` (cancel, success auto-clear, or unmount) — and on a `rejected` drop that arrives once the previous batch has finished, so a progress bar never shows 100% for a drop that uploaded nothing.

A second drop landing while the first is still uploading **adds** to the vars rather than replacing them: `--dropzone-files-pending` counts every file still outstanding across both drops and `--dropzone-progress` averages across all of them.

```vue
<div v-dropzone="{ upload: { url: '/api/upload' } }" class="dz">
  <div class="dz-bar" />
  <span class="dz-counter">Uploading <em /> file(s)…</span>
</div>

<style>
.dz                            { position: relative; padding: 2rem; border: 2px dashed #aaa; }
.dz-bar                        { display: none; height: 4px; background: #4f46e5;
                                 width: calc(var(--dropzone-progress, 0) * 1%); transition: width 120ms ease-out; }
.dz[data-dropzone="uploading"] .dz-bar,
.dz[data-dropzone="success"]   .dz-bar { display: block; }
.dz-counter em::before         { content: counter(pending); }
.dz[data-dropzone="uploading"] .dz-counter { counter-reset: pending var(--dropzone-files-pending); }
</style>
```

**Failure semantics:** an erroring file contributes its **last reported percent** to the aggregate (so the UI can render "Failed at 75%"). A file that errors before any progress event was reported contributes `0`. `files-pending` decrements regardless of success or failure, reaching `0` once the batch fully settles.

**Rejected drops** (validation failure) never *set* the vars — no upload was attempted. If a previous batch left values behind, a rejection clears them, unless files from that batch are still in flight (in which case the vars keep describing the live requests).

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `on` | `(files: File[]) => void \| Promise<void>` | — | Handler invoked with the validated files on drop / paste / pick |
| `onReject` | `(event: DropzoneRejectEvent) => void` | — | Invoked when validation rejects (with cumulative reasons in canonical order `['type','size','count']`) |
| `accept` | `string` | — | MIME pattern (`'image/*'`), exact MIME (`'image/png'`), extension (`'.pdf'`), or comma-separated mix. Case-insensitive |
| `multiple` | `boolean` | `true` | Set `false` to reject multi-file drops with reason `'count'`. Note: differs from `<input type="file">` where the default is `false` |
| `maxSize` | `number` | — | Per-file size cap (bytes) — files over this are rejected with reason `'size'` |
| `maxCount` | `number` | — | Count cap **per drop / paste / pick** — exceeding it rejects that whole event with reason `'count'`. It is not a running total: two drops of `maxCount` files each both pass, and nothing consults what the zone already holds. Cap the running total yourself off `api.pending` if you need one |
| `rejectDuration` | `number` | `1500` | Milliseconds before `data-dropzone="rejected"` auto-clears to `"idle"` |
| `clickToPick` | `boolean` | **`true`** | Click on the host (or any non-interactive descendant) opens the picker `<input type="file">`. `accept`/`multiple` flow through. The input is visually hidden but stays focusable, so Tab + Enter open the picker too. `false` opts out: no input at mount, no tab stop, drag/paste only |
| `clickIgnore` | `string` | — | Extra CSS selector for descendants whose clicks must not open the picker, merged with the built-in interactive list. Matches anywhere up the ancestor chain. Must be valid CSS; matching the host itself has no effect (use `clickToPick: false`) |
| `pickerLabel` | `string` | `'Choose files'` / `'Choose file'` | Accessible name of the picker input — what a screen reader announces on the control Tab lands on. Defaults to the singular form when `multiple: false` |
| `paste` | `boolean` | `false` | Attach a `paste` listener. Files in `clipboardData.items` (e.g. screenshots) flow through the same validation pipeline |
| `pasteOn` | `'host' \| 'document'` | `'host'` | Where to attach the paste listener. `'host'` only hears a paste while focus is **inside** the host — clicking the zone or tabbing to it both put focus on the picker input, so both arm it; with `clickToPick: false` there is no focusable control left in a plain `<div>` zone, so pair that with `'document'`. `'document'` catches "paste anywhere on the page" flows (recommended for screenshot uploads — iOS Safari doesn't fire `paste` for images outside focusable inputs) |
| `upload` | `UploadConfig \| UploadFn` | — | URL-based config object **or** async function. See "Upload pipeline" |
| `onProgress` | `(file, percent: number) => void` | — | Per-file progress. Integer `0..100`. URL-based: fires when `lengthComputable === true`. Function-based: fires when the consumer calls the 3rd-arg callback |
| `onUploaded` | `(file, response: unknown) => void` | — | Per-file success. URL-based: auto-parsed JSON or raw text. Function-based: the resolved value |
| `onError` | `(file, error: UploadError) => void` | — | Per-file failure. URL-based: `{ message, status?, aborted?, timedOut? }`. Function-based: `{ message }` from the thrown Error |
| `successDuration` | `number` | `1500` | Milliseconds before `data-dropzone="success"` auto-clears to `"idle"`. `error` is sticky and never auto-clears |
| `enabled` | `boolean` | `true` | Activate / deactivate reactively. `false` fully tears the zone down: listeners detached, in-flight uploads aborted with `onError({ aborted: true })`, `pending` / `failed` discarded, the hidden picker removed, and a `ref` reset to `undefined`. Re-enabling builds a fresh instance — it is a teardown, not a pause |
| `autoUpload` | `boolean` | `true` | When `false`, accepted files are queued in `api.pending` until `api.upload()` is invoked |
| `ref` | `Ref<DropzoneApi \| undefined>` | — | Vue ref the directive populates with the reactive `DropzoneApi` (see below) |

## Programmatic API (`DropzoneApi`)

Pass a `ref` and the directive fills it with a reactive object:

```ts
import type { DropzoneApi } from '@ozjsey/v-dropzone'

const dz = ref<DropzoneApi>()
const options = computed(() => ({ ref: dz, upload: { url: '/api/upload' } }))
// <div v-dropzone="options" />   ← never `v-dropzone="{ ref: dz }"`; see recipe 7
```

| Member | Type | Description |
|---|---|---|
| `state` | `DropzoneState` (reactive) | Mirrors `data-dropzone` — `'idle' \| 'active' \| 'rejected' \| 'uploading' \| 'success' \| 'error'` |
| `pending` | `readonly File[]` (reactive) | Files queued under `autoUpload: false` waiting for `upload()` |
| `uploading` | `readonly File[]` (reactive) | Files currently in flight |
| `failed` | `readonly File[]` (reactive) | Files whose upload errored — kept until `retry()`, `cancel()`, `dismissError()`, or the next drop / paste / pick that brings in accepted files, which reseeds the zone (the same rule that clears the sticky `error` state). Hold on to what you need from `onError` if you want a record that outlives the next drop |
| `open()` | `() => void` | Opens the native file picker. Uses the zone's picker input, or creates one on demand when `clickToPick: false` (in which case it stays out of the tab order — your own button is the affordance) |
| `upload(file?)` | `(file?: File \| File[]) => void` | No-arg flushes `pending` through the upload pipeline. With-arg routes the given files through validation + `on` + upload. Both forms upload **regardless of `autoUpload`** — that option gates the automatic dispatch after a drop / paste / pick, not an explicit call |
| `cancel(file?)` | `(file?: File) => void` | No-arg aborts every in-flight upload and leaves the queue alone. With-arg cancels just that file's group (URL batched mode aborts the whole group); if the file is only *queued* under `autoUpload: false` it is discarded from `pending` — that is the "remove from queue" lever, and it leaves the zone's state untouched |
| `retry(file?)` | `(file?: File) => void` | No-arg retries every `failed` file as one combined batch. With-arg retries just that file's group |
| `dismissError()` | `() => void` | Drops `failed` records from tracking and transitions `error` → `idle` (or `uploading` if a batch is still in flight) |

The api object identity is **stable** across reactive option updates — safe to capture in a `computed` / `watch`. Cleared on host unmount, and replaced (not preserved) by toggling `enabled`, which tears the instance down and rebuilds it.

## Bundle size

Single dependency-free file. No Vue components, no runtime deps beyond the `vue` peer.

| Format | Size |
|---|---|
| ESM minified | **15.8 KB** |
| ESM minified + gzipped | **5.4 KB** |

Covers drag-drop + folder drops (recursive `webkitGetAsEntry` walk) + validation + click-to-pick + paste-from-clipboard + URL upload (XHR + progress + batched) + function upload (AbortController + progress callback) + programmatic API (open/upload/cancel/retry/dismissError) + `autoUpload` queue + CSS variables + full state lifecycle + picker accessibility (visually-hidden-but-focusable input, accessible name, affordance-driven tab stop). Tree-shakable (`vDropzone` / `default` / `DropzonePlugin` / `DIRECTIVE_NAME` exports).

## `accept` patterns

```ts
'image/*'                   // any image MIME
'image/png,image/jpeg'      // exact MIME list
'.pdf,.docx'                // file extensions (leading dot required)
'image/*,.pdf'              // mix of MIME wildcards and extensions
'.PDF'                      // case-insensitive (so is `report.PDF`)
```

Behavior:

- All patterns and inputs are matched case-insensitively.
- MIME parameters are stripped before comparison: `text/plain;charset=utf-8` matches `text/plain`.
- When `file.type === ''` (some platforms / unknown extensions), MIME / wildcard patterns cannot match — fall back to an extension pattern (`.docx`).
- Empty (`''`) or whitespace-only `accept` is treated as "no filter set" — every file passes.
- Extension patterns require a leading dot (`.pdf`, not `pdf`). A pattern without a leading dot is interpreted as a MIME type.

## TypeScript

Every consumer-facing type is exported by name:

```ts
import type {
  DropzoneOptions,
  DropzoneHandler,
  DropzoneBinding,
  DropzoneRejectReason,
  DropzoneRejectEvent,
  DropzoneState,
  DropzonePasteScope,
  UploadConfig,
  UploadFn,
  UploadValueOrFn,
  UploadMethod,
  UploadError,
} from '@ozjsey/v-dropzone'
```

`UploadProgressEvent` and `UploadResult` are also exported, and are **deprecated** — nothing in the
package produces or accepts either, and they will be removed in the next major. Type a progress
handler as `(file: File, percent: number) => void`; upload outcomes arrive through
`onUploaded(file, response)` and `onError(file, error)`.

No `@types/v-dropzone` companion package; the package ships its own `dist/vDropzone.d.ts`.

`UploadFn` is generic on the response type: `UploadFn<{ id: string }>` types `onUploaded(file, response: { id: string })`.

## Folder drops

> [Folder drop](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/folder-drop) — drag a directory onto it and watch the flattened list come back.

Dropping a folder (or a mix of files and folders) works out of the box — no option to set. The
directive walks the folder recursively via the FileSystem Entry API (`webkitGetAsEntry` — the
nonstandard-but-universal API shipped by Chromium, Firefox and Safari) and hands your `on` handler
one flat `File[]` of everything inside, preserving top-level order (`[top.png, dir/]` →
`[top.png, ...filesInsideDir]`).

- **Validation runs on the flattened list** — `accept` / `maxSize` reject per file (valid siblings
  from the same folder still pass through, same partial-rejection model as a plain multi-file
  drop); `maxCount` counts every file found inside the folder tree.
- **The walk is async, the capture is not** — entries are read synchronously inside the drop
  handler (the browser revokes `DataTransfer` access after it returns), then resolved to `File`s
  asynchronously. Unmounting mid-walk cancels delivery; nothing fires after unmount.
- **Empty folders are a no-op** — the handler is not called, the state stays `idle`.
- **Unreadable entries are skipped silently** — a file the OS refuses to hand over drops out of
  the list instead of failing the whole drop, per OS convention.
- **Recursion is capped at 64 levels** — real folder trees never get near this (OS path-length
  limits give out first); the cap exists so a self-referencing entry (the shape a symlink loop
  produces) terminates instead of walking forever. Files found above the cutoff are still
  delivered.
- **Browsers without `webkitGetAsEntry`** fall back to the plain synchronous file list — top-level
  files still arrive; folder *contents* need the Entry API.
- **Drags with no filesystem backing take that same fallback.** Chromium exposes
  `webkitGetAsEntry` on every item but answers `null` from it whenever the item has nothing on disk
  behind it — a synthetic `DataTransfer` (how automated drop tests drive a dropzone), a drag out of
  a virtual folder, a mail-client attachment. `dataTransfer.files` is populated the whole time, so
  the directive detects the empty walk and reads the files from there. Only folder *contents* are
  unavailable in that case, because there is no directory entry to walk.

## Behavior

- **Enter/leave counter** — `dragenter` increments, `dragleave` decrements. Moving the cursor across children does *not* flip the host to `idle`. This is the canonical drop-zone bug; pinned in tests.
- **`dragover` always `preventDefault`s** — without it the browser navigates away to open the file natively. The directive does this for you.
- **All four drag events also `stopPropagation`** — `dragenter`, `dragover`, `dragleave` and `drop` stop at the zone. An ancestor's `@dragover` / `@drop` will not fire while the pointer is over it, so a page-level "drop anywhere" overlay goes quiet over a zone, and **nesting one `v-dropzone` inside another does not work**: the inner zone swallows the `dragenter` the outer zone's depth counter needs, so the outer zone's `active` styling drops off while the drag is over the inner one. Use one zone per drop target.
- **`drop` resets the counter to `0`** — even if the user dragged across multiple children before dropping.
- **Per-file vs all-or-nothing validation** — type and size violations are per-file (others in the same drop still pass through); count violations reject the whole drop.
- **Cumulative `reasons`** — a single drop may surface multiple reasons. Even when count-class rules fail, type / size reasons across the dropped files are still surfaced (e.g. `maxCount: 2` with three files where one is the wrong type → `reasons: ['type', 'count']`). Reasons are always in canonical order `['type', 'size', 'count']`.
- **`data-dropzone="rejected"` auto-clears** — after `rejectDuration` ms. A new drag cancels the pending clear (so the user always sees `active` while dragging). A new drop resets the timer (most-recent-rejection wins).
- **Drag during upload** — the host temporarily flips to `active`; on dragleave with no completed uploads the state returns to `uploading` (not `idle`).
- **`error` is sticky** — never auto-clears, even after `successDuration`. The next drop / paste / pick that delivers accepted files reseeds the state machine, discarding the failed records with it; `retry()`, `cancel(file)` and `dismissError()` clear it explicitly. A retry of one failed file leaves another file's failure standing.
- **Overlapping drops are safe** — drop again while the first set is still uploading and both sets are tracked as one outstanding population. The zone reports `success` only once everything has answered, a failure in *any* of them wins, and the CSS vars count them all. (Before 0.1.1 the second drop overwrote the first drop's bookkeeping: the zone flashed `success` with files still on the wire and then swallowed their failure entirely.)
- **`unmounted` removes all listeners, aborts in-flight XHRs/`AbortController`s, and clears `data-dropzone`.** Pending success/reject timers are cancelled — no stray DOM mutations post-unmount.
- **Per-element state via `WeakMap`** — multiple `v-dropzone` instances on the same page do not interfere; no per-instance setup required inside `v-for`.
- **Click-to-pick is on by default** — the bare binding gives you drop, click and keyboard, because a zone that only accepts a drag excludes every user who cannot perform one. `clickToPick: false` opts out; nothing else changes.
- **Click-to-pick respects interactive descendants** — clicks on `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `[contenteditable]`, `[tabindex]` (other than `-1`), `[role="button"]`, `<summary>`, `<audio controls>`, `<video controls>` — or any nested descendant of those — preserve their own semantics and do not open the picker. `clickIgnore` extends the list per zone. A `tabindex` or `role` on the **host** does not exempt the host: it is still the click target. The picker `<input type="file">`'s `accept` / `multiple` attributes are kept in sync with the directive options on every update.
- **Stray clicks are filtered** — the second click of a double-click (`event.detail > 1`) is ignored, so double-clicking opens exactly one picker; and a click that terminates a text selection touching the zone is ignored, so selecting the zone's own copy never summons a file dialog.
- **The picker input is the keyboard route in** — HTML5 drag-and-drop has no keyboard or screen-reader story, so the input is visually hidden (clipped to a 1×1 box, contributing zero layout) rather than `display: none`, which would also drop it from the tab order. With click-to-pick on it is a normal tab stop: Tab focuses it, Enter/Space open the native picker, and it is announced with `pickerLabel` (default `'Choose files'`). No key handling of the directive's own, and **nothing is injected onto the host** — no `role`, no `tabindex` — so a "drag files here **or browse**" layout keeps its inner button or link reachable.
- **The picker input is positioned against the host** — it is `position: absolute` at the host's top-left, and the directive gives the host `position: relative` when it has none so those offsets resolve against the zone. Without that they resolve against the *initial* containing block: the input sits at document (0, 0) whatever page the zone is on, and Tab scrolls the page thousands of pixels away from the zone it just focused — measured at 4,754px on a 8,000px page. The write happens only while the input is a real tab stop (so never for `clickToPick: false`), never to a host that already has a `position`, and it is reverted on teardown and unmount. It is also re-asserted on every update, because a **string** `:style` binding is patched by Vue with `el.style.cssText = …`, which wipes every inline property the element had — including this one. (An object `:style` binding sets properties individually and never disturbs it.) One residual: if your zone is *itself* a scroll container and is scrolled down, Tab scrolls its content back to the top, because that is where the input is.
- **The picker's own click never escapes the directive** — opening the picker is `input.click()`, and that click would bubble to your host: before this was stopped, one real click on a zone fired the host's `click` listener **twice** (once untrusted, with `event.target` set to the hidden input), and `api.open()` fired it with no click on the page at all. So `@click` on a zone is called exactly once per user click, and never for a programmatic open.
- **Clicking a zone leaves focus inside it** — the host click handler focuses the picker input (with `preventScroll`) before opening the dialog, the way a click on a real `<button>` leaves focus on the button. That is what makes `:focus-within` light for a mouse user, and what gives `pasteOn: 'host'` a deterministic focus target.
- **Focusability follows the affordance** — with `clickToPick: false` there is no input at mount at all; `api.open()` still creates one on demand, and it carries `tabindex="-1"` + `aria-hidden="true"` because nothing on screen points at it. Your own button (the one calling `api.open()`) is the affordance instead. Flipping `clickToPick` true → false at runtime keeps the existing input for `api.open()` and downgrades it the same way. `enabled: false` removes it entirely.
- **A re-render writes nothing** — the option sync onto the picker input is idempotent: `accept`, `multiple`, `aria-label`, `tabindex` and `aria-hidden` are written only when the value would change. So a `MutationObserver` on your zone stays quiet between real changes. It matters because `setAttribute` queues a mutation record even for an identical value, and an observer callback that writes reactive state would otherwise loop: mutation → render → `updated` → mutation, with no fixed point and no yield to the main thread.
- **Paste pipeline shares processing with drop/pick** — same validation, same `rejected` lifecycle, same `upload` dispatch.

## Accessibility

> [Click-to-pick: guards, opt-out, keyboard](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/click-to-pick) is where to Tab into a zone and
> press Enter, and to check that an interactive descendant still keeps its own click.

Clicking is the default, so keyboard and screen-reader access is not optional — a directive that
makes an element clickable owes it keyboard operability. `v-dropzone` pays that debt with a **real
focusable control** rather than injected ARIA: the picker `<input type="file">` is visually hidden
with the clip recipe (not `display: none`), which leaves it in the tab order and in the
accessibility tree.

What you get without writing anything:

| | Provided by |
|---|---|
| Tab stop on the zone | the picker input's natural focusability (no `tabindex` injected) |
| Enter / Space opens the picker | native `<input type="file">` activation — zero key handling |
| Announced as a file control | the platform, plus `aria-label` from `pickerLabel` |
| `accept` / `multiple` conveyed to AT | mirrored onto the input on every update |
| Host semantics untouched | no `role`, no `tabindex`, no `aria-label` written to the host |

**Why not `role="button"` on the host.** `button` makes its children presentational, which would
hide the inner `<button>` or `<a>` of a "drag files here **or browse**" layout — the exact layout
click-to-pick exists to support — and would give the control a nonsense accessible name. A real
control beats a described one.

### The two rules you have to write yourself

```css
.dz               { cursor: pointer; }                    /* the click affordance is invisible otherwise */
.dz:focus-within  { outline: 2px solid #4f46e5;           /* the input is clipped, so IT cannot show focus */
                    outline-offset: 2px; }
```

`:focus-within`, not `:focus` — focus lands on the clipped input inside the host, not on the host.
Skipping this ships a keyboard trap-shaped bug: the zone is focusable but nothing on screen says
so.

**If the zone contains other focusable things** — a Remove button on a file chip, a "Browse…"
button, a link in the instructional copy — `:focus-within` lights the whole zone when *they* are
focused too, which is the wrong ring on the wrong control. Target the picker itself instead:

```css
.dz:has(> input[type='file']:focus-visible) { outline: 2px solid #4f46e5; outline-offset: 2px; }
```

`:focus-visible` also drops the ring for the mouse click that opens the dialog — clicking a zone
deliberately leaves focus on the picker input, so plain `:focus-within` rings every click.
`:has()` is Chrome 105+ / Firefox 121+ / Safari 15.4+; `:focus-within` on a zone with nothing else
focusable in it is exactly equivalent and is the simpler thing to write.

### Naming the control

The default accessible name is `'Choose files'` (`'Choose file'` when `multiple: false`). When a
page has several zones, or the surrounding text is what gives the zone its meaning, name it:

```vue
<div v-dropzone="{ pickerLabel: 'Add receipts', accept: 'image/*,.pdf', on: addReceipts }">
  Receipts — drop here or click to browse
</div>
```

### Checklist

- [ ] `cursor: pointer` on the host.
- [ ] `:focus-within` outline on the host — or `:has(> input[type='file']:focus-visible)` if the zone contains other focusable controls.
- [ ] `pickerLabel` when `'Choose files'` would be ambiguous on the page.
- [ ] Visible text that says the zone is clickable ("or click to browse") — the affordance is
      otherwise invisible to sighted mouse users.
- [ ] Do **not** add your own `tabindex="0"` to the host: it creates a second tab stop that does
      nothing on Enter. If you want the host focusable for another reason, keep it in mind that
      the input already carries the pick.
- [ ] `clickToPick: false` whenever the zone is genuinely drag/paste-only — that removes the tab
      stop and the input entirely, rather than leaving a control nothing points at.

## Caveats

- **iOS Safari** doesn't fire `paste` for images outside `<input>` / `<textarea>`. Use `pasteOn: 'document'` (or document the limit to your users).
- **XHR `progress` events** don't fire cross-origin without `Access-Control-Allow-Origin`. The directive doesn't paper over this — the server must allow CORS for progress to work.
- **The directive adds no visual style** — consumer is responsible for CSS via the `data-dropzone="..."` state hooks. With click-to-pick on by default that includes `cursor: pointer` and a `:focus-within` outline; see [Accessibility](#accessibility).
- **A `<input type="file">` child appears in the host** — visually hidden, 1×1, absolutely positioned, contributing zero layout. It is created at mount unless `clickToPick: false`. Selectors like `.dz > *`, `:first-child` / `:last-child`, `:empty`, or a `childElementCount` assertion see it.
- **The host gets `position: relative` if it has none** — required so the picker input's offsets resolve against the zone (see [Behavior](#behavior)); without it, tabbing into the zone scrolls the page away from it. The consequences are the ordinary ones of a positioned element: it becomes the containing block for *your* absolutely positioned children, and it paints in the positioned-descendant layer. Set any `position` of your own and the directive leaves the host alone. `clickToPick: false` zones are never touched.
- **A `position` that is only *sometimes* declared is a one-way door.** The check reads the
  *computed* position, and the write is an inline style — which beats any stylesheet and is removed
  only on teardown. So with, say, `@media (min-width: 900px) { .dz { position: sticky } }`:

  | | computed | inline | result |
  |---|---|---|---|
  | mounted wide, rule live | `sticky` | — | the directive stands down |
  | resized narrow, no re-render yet | `static` | — | not anchored — tabbing to the picker scrolls the page, until the next update |
  | after any re-render | `relative` | `position: relative` | anchored |
  | resized wide again | `relative` | `position: relative` | **your `sticky` never comes back** |

  **The fix is one line: declare the `position` unconditionally.** `.dz { position: relative }` in
  the base rule with `position: sticky` in the media query means the directive never touches the
  host at any width, and your sticky behaves normally. The same applies to any `position` that
  appears under a media query, a container query, a `:hover`, or a conditional class.
- **`clickIgnore` must be a valid CSS selector** — it is merged into a `closest()` call, so an invalid one throws a `SyntaxError` from that call and the zone stops picking. The error names the bad selector in the console; it is loud rather than silent, but it is on you to pass valid CSS.
- **The text-selection guard depends on `window.getSelection()`** — a click ending a selection inside the zone is suppressed. Inside a shadow root, or wherever the selection API reports nothing, that guard cannot fire and the click opens the picker as normal.
- **`ref` cannot be passed from a template expression.** Vue unwraps refs there, so the directive receives `undefined` and the api silently never binds. Build the options object in `<script setup>` (see recipe 7). Every other option is safe inline.
- **Drags with no filesystem backing** (synthetic `DataTransfer`, virtual folders, mail-client attachments) deliver files normally but cannot be walked as folders — see [Folder drops](#folder-drops).

## License

MIT — Ozgur Seyidoglu
