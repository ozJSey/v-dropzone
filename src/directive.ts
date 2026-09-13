/**
 * The directive — binding resolution, attach/detach wiring, and the
 * `updated` diff for reactive option changes (enabled toggle, picker/paste
 * setup and teardown, paste-scope moves, ref swaps).
 */
import { isReactive, toRaw, type Directive, type DirectiveBinding } from 'vue'
import { anchorPickerHost } from './anchor'
import { detachRef, syncApi } from './api'
import { createDragListeners } from './drag'
import {
  destroyPickerInput,
  setupClickToPick,
  syncPickerAttrs,
  teardownClickToPick,
  wantsClickToPick,
} from './picker'
import { setupPaste, teardownPaste } from './paste'
import {
  clearRejectTimer,
  clearSuccessTimer,
  clearUploadVars,
  setState,
  stateMap,
  type DropzoneInstance,
} from './state'
import type { DropzoneBinding, DropzoneOptions, DropzonePasteScope } from './types'
import { abortAllUploads } from './upload-control'

/**
 * Resolve the binding value to an options object.
 *
 * Why `toRaw`: consumers commonly wrap options in a Vue `ref()` for reactivity
 * (`const opts = ref<DropzoneOptions>({ ref: apiRef, … })`). When the directive
 * sees `binding.value`, Vue has already produced a reactive proxy. Accessing
 * `.ref` on that proxy auto-unwraps the nested `apiRef` (a Vue `Ref`), so the
 * directive would receive `undefined` instead of the Ref it needs to populate.
 * Unwrapping to the raw object preserves the consumer's Ref identity so we can
 * mutate `.value = api` and `.value = undefined` reactively.
 */
function resolveOptions(value: DropzoneBinding | undefined): DropzoneOptions {
  if (typeof value === 'function') return { on: value }
  if (!value) return {}
  return isReactive(value) ? toRaw(value) : value
}

function attach(el: HTMLElement, opts: DropzoneOptions): void {
  const instance: DropzoneInstance = {
    opts,
    dragDepth: 0,
    rejectTimer: null,
    successTimer: null,
    // Placeholder — the real listeners are built right below, once the
    // instance object they close over exists.
    listeners: { dragenter: () => {}, dragover: () => {}, dragleave: () => {}, drop: () => {} },
    pickerInput: null,
    pickerHostClick: null,
    pickerChange: null,
    pickerHostPositioned: false,
    pasteListener: null,
    pasteTarget: null,
    records: new Map(),
    api: null,
    ref: null,
    uploadBatch: null,
    progressBatch: null,
  }
  // The listeners close over the real instance — build them once it exists.
  instance.listeners = createDragListeners(el, instance)

  el.addEventListener('dragenter', instance.listeners.dragenter)
  el.addEventListener('dragover', instance.listeners.dragover)
  el.addEventListener('dragleave', instance.listeners.dragleave)
  el.addEventListener('drop', instance.listeners.drop)

  stateMap.set(el, instance)
  setState(el, instance, 'idle')

  if (wantsClickToPick(opts)) setupClickToPick(el, instance)
  if (opts.paste) setupPaste(el, instance)
  if (opts.ref) syncApi(el, instance)
}

function detach(el: HTMLElement): void {
  const instance = stateMap.get(el)
  if (!instance) return
  clearRejectTimer(instance)
  clearSuccessTimer(instance)
  abortAllUploads(instance)
  detachRef(instance)
  teardownClickToPick(el, instance)
  destroyPickerInput(instance)
  teardownPaste(instance)
  el.removeEventListener('dragenter', instance.listeners.dragenter)
  el.removeEventListener('dragover', instance.listeners.dragover)
  el.removeEventListener('dragleave', instance.listeners.dragleave)
  el.removeEventListener('drop', instance.listeners.drop)
  el.removeAttribute('data-dropzone')
  instance.progressBatch = null
  clearUploadVars(el)
  stateMap.delete(el)
}

export const vDropzone: Directive<HTMLElement, DropzoneBinding | undefined> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<DropzoneBinding | undefined>) {
    const opts = resolveOptions(binding.value)
    if (opts.enabled === false) return
    attach(el, opts)
  },

  updated(el: HTMLElement, binding: DirectiveBinding<DropzoneBinding | undefined>) {
    const next = resolveOptions(binding.value)
    const existing = stateMap.get(el)

    const isEnabled = next.enabled !== false
    if (!existing && isEnabled) {
      attach(el, next)
      return
    }
    if (existing && !isEnabled) {
      detach(el)
      return
    }
    if (existing) {
      // Both sides go through the same resolver `attach` used. Re-deriving
      // the default here (`!!opts.clickToPick`) is the silent-bug shape:
      // omitted would read as off on update and on at attach, so a consumer
      // dropping the now-redundant option would either never gain the picker
      // or lose the one they had — with nothing thrown either way.
      const wasPicker = wantsClickToPick(existing.opts)
      const wantsPicker = wantsClickToPick(next)
      const wasPaste = !!existing.opts.paste
      const wantsPaste = !!next.paste
      const prevPasteScope: DropzonePasteScope = existing.opts.pasteOn === 'document' ? 'document' : 'host'
      const nextPasteScope: DropzonePasteScope = next.pasteOn === 'document' ? 'document' : 'host'
      existing.opts = next

      if (!wasPicker && wantsPicker) setupClickToPick(el, existing)
      else if (wasPicker && !wantsPicker) teardownClickToPick(el, existing)
      else if (existing.pickerInput) syncPickerAttrs(existing.pickerInput, next)

      // Re-assert the containing block while the picker is a tab stop. Vue has
      // just patched this element's props, and a string `:style` binding is
      // patched with `el.style.cssText = next` — which wipes the inline
      // `position` the anchor wrote and puts the picker input back at the
      // initial containing block, i.e. DZ-3, silently. `anchorPickerHost`
      // reads the host's computed position, so this is a no-op unless
      // something actually removed it.
      if (wantsPicker) anchorPickerHost(el, existing)

      if (!wasPaste && wantsPaste) setupPaste(el, existing)
      else if (wasPaste && !wantsPaste) teardownPaste(existing)
      else if (wasPaste && wantsPaste && prevPasteScope !== nextPasteScope) {
        teardownPaste(existing)
        setupPaste(el, existing)
      }

      // Ref sync: detect target swap, or first-time bind, or detach.
      syncApi(el, existing)
    }
  },

  unmounted(el: HTMLElement) {
    detach(el)
  },
}

export default vDropzone
