# @ozjsey/v-dropzone

A Vue 3 directive that owns the whole drag-drop pipeline: drop / paste / click-to-pick → validate →
upload → state, from one binding.

[![npm](https://img.shields.io/npm/v/@ozjsey/v-dropzone.svg)](https://www.npmjs.com/package/@ozjsey/v-dropzone)
![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![dependencies 0](https://img.shields.io/badge/dependencies-0-blue.svg)

## The problem

HTML drag-and-drop is famously awful. Four events to wire — `dragenter`, `dragover`, `dragleave`,
`drop` — all needing `preventDefault()` or the browser navigates away and opens the file itself; and
`dragleave` fires every time the cursor crosses a child, so the zone flickers off unless you write an
enter/leave counter. There is no click or keyboard route in at all, which excludes anyone who cannot
perform a drag, so every dropzone hand-rolls a hidden `<input type="file">` and (rarely, which is the
problem) a way to reach it. MIME / size / count filtering is then re-implemented per project, paste
is a separate API, and there is no upload primitive — progress, cancel and retry get rebuilt on XHR.

## The solution

One binding owns the pipeline. You write CSS for `[data-dropzone="…"]`; everything else is config.

```vue
<div v-dropzone="(files) => myFiles = files" class="dz">
  Drop files here, or click to browse
</div>
```

That zone already does three things with no options passed: files can be **dropped** on it,
**clicked** into it (the native picker opens), and reached with **Tab** + Enter. Click-to-pick is on
by default because a zone that only accepts a drag excludes every user who cannot perform one; pass
`clickToPick: false` for a drag-only zone.

The one thing to know before you style it: **the directive puts a real `<input type="file">` inside
your host and gives the host `position: relative` when it has none.** That input is the keyboard and
screen-reader route in — clipped to 1×1, contributing no layout, but visible to `:first-child`,
`:empty` and `.dz > *` — and it must be anchored inside the zone or focusing it scrolls the page
away. Declare a `position` of your own and the directive stands down and never touches the host.

## Install

```bash
npm install @ozjsey/v-dropzone
```

Requires **Vue 3.0 or newer**: the directive imports `reactive`, `isReactive` and `toRaw`, all of
which shipped in 3.0, and nothing newer.

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { DropzonePlugin } from '@ozjsey/v-dropzone'

createApp(App).use(DropzonePlugin).mount('#app')   // registers `v-dropzone` app-wide
```

Or per component: `import { vDropzone } from '@ozjsey/v-dropzone'` — the `v` prefix is what lets a template pick it up as `v-dropzone`.

## Usage

### The CSS that zone needs

The directive paints nothing, so both affordances it adds are yours to make visible. Skipping the
focus rule ships a zone that is focusable with nothing on screen saying so.

```css
.dz                           { border: 2px dashed #aaa; padding: 2rem; cursor: pointer; }
/* The picker input is clipped, so its own focus ring is invisible — the host
   renders focus on its behalf. :focus-within, not :focus. */
.dz:focus-within              { outline: 2px solid #4f46e5; outline-offset: 2px; }
.dz[data-dropzone="active"]   { border-color: #4f46e5; background: #eef2ff; }
.dz[data-dropzone="rejected"] { border-color: #dc2626; background: #fef2f2; }
.dz[data-dropzone="success"]  { border-color: #16a34a; background: #f0fdf4; }
```

### Validate, then upload with progress

`accept` and `maxSize` are per-file: the files that pass go to `on`, the ones that fail go to
`onReject` with cumulative reasons. `maxCount` and `multiple: false` reject the whole drop.

```vue
<template>
  <div v-dropzone="options" class="dz">Drop images or PDFs</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropzoneOptions } from '@ozjsey/v-dropzone'

const token = ref('')
const uploaded = ref<{ file: File; response: unknown }[]>([])

// Built here, not inline: a template expression gets `token` already unwrapped,
// so `token.value` there is `undefined` — `Authorization: Bearer undefined`.
const options = computed<DropzoneOptions>(() => ({
  accept: 'image/*,.pdf',
  maxSize: 5_000_000,
  onReject: ({ reasons }) => console.warn('rejected', reasons),
  upload: { url: '/api/upload', headers: () => ({ Authorization: `Bearer ${token.value}` }) },
  onProgress: (file, percent) => console.log(file.name, percent),
  onUploaded: (file, response) => uploaded.value.push({ file, response }),
}))
</script>
```

### Queue files, then upload on demand

Pass a `ref` and the directive fills it with a reactive `DropzoneApi`: `open` / `upload` / `cancel` /
`retry` / `dismissError`, plus live `pending` / `uploading` / `failed` arrays.

```vue
<template>
  <div v-dropzone="options" class="dz">Drop files — they queue, nothing uploads yet</div>
  <button :disabled="!dz?.pending.length" @click="dz!.upload()">Upload</button>
  <button v-if="dz?.uploading.length" @click="dz!.cancel()">Cancel all</button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropzoneApi } from '@ozjsey/v-dropzone'

const dz = ref<DropzoneApi>()
// `ref` must come from <script setup>. Written inline, Vue unwraps it and the
// directive receives `undefined`: nothing throws, the buttons just stay dead.
const options = computed(() => ({ ref: dz, autoUpload: false, upload: { url: '/api/upload' } }))
</script>
```

## Everything else

Every option, event, state and CSS variable — the `data-dropzone` lifecycle and its sticky `error`,
`--dropzone-progress`, batched vs per-file uploads, custom transports, folder drops, `clickIgnore`,
`pasteOn` — is driven against a real dev server on the
**[v-dropzone playground tab](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone)**, one
card per feature, every card editable in place:
[drop or click](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/drop-basic) ·
[validation](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/validation) ·
[upload with progress](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/url-upload) ·
[custom transport](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/fn-upload) ·
[paste a screenshot](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/paste) ·
[the `DropzoneApi`](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/api) ·
[CSS-only progress](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/css-progress) ·
[click-to-pick and the keyboard](https://ozjsey.github.io/npm-portfolio-playground/#v-dropzone/click-to-pick)

[CHANGELOG.md](./CHANGELOG.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

## License

MIT
