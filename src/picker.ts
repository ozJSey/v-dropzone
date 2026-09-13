/**
 * Click-to-pick — the visually-hidden `<input type="file">`, its attribute
 * mirroring, its accessibility state, the host click listener with its
 * stray-click guards, and teardown. Shared by click-to-pick (on by default)
 * and `api.open()`.
 *
 * `wantsClickToPick` lives here because it is the one place the default is
 * decided; `directive.ts` must never re-derive it (see its jsdoc).
 */
import { anchorPickerHost, releasePickerHost } from './anchor'
import {
  DEFAULT_PICKER_LABEL_MULTIPLE,
  DEFAULT_PICKER_LABEL_SINGLE,
  INTERACTIVE_SELECTOR,
  PICKER_HIDDEN_STYLE,
} from './constants'
import { processFiles } from './process'
import type { DropzoneInstance } from './state'
import type { DropzoneOptions } from './types'

/**
 * Does this options object want the host to be a click target?
 *
 * `clickToPick` defaults to **on**, so only an explicit `false` turns it off —
 * the `!== false` idiom `multiple`, `enabled` and `autoUpload` already use.
 *
 * It is exported, and is the ONLY place that decides this, because `attach`
 * and the `updated` diff have to agree. When one reads "omitted" as off while
 * the other reads it as on, both failure modes are silent and both land on
 * the migration a consumer performs when they delete the option they no
 * longer need: `{ clickToPick: false }` → `{}` never wires the zone up, and
 * `{ clickToPick: true }` → `{}` tears a working zone down.
 */
export function wantsClickToPick(opts: DropzoneOptions): boolean {
  return opts.clickToPick !== false
}

/**
 * Write an attribute only when it would actually change.
 *
 * Every write the directive makes to the picker input is a write *inside the
 * consumer's host*, and `setAttribute` queues a `MutationRecord` even when
 * the value is identical. `syncPickerAttrs` runs on every `updated` — i.e.
 * every re-render of the component that owns the zone — so an unconditional
 * write meant a consumer observing their own zone got two records per render.
 * A `MutationObserver` callback that writes reactive state (reading back what
 * the directive put in the host is the natural reason to have one) then has
 * no fixed point: mutation → state → render → `updated` → mutation. The loop
 * is microtask-driven, so the main thread never yields and the tab hangs —
 * measured in Chrome, and it hung the playground's own `clickToPick: false`
 * card on load. Idempotence is what breaks it: the second render writes
 * nothing, so the observer goes quiet.
 */
function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}

/**
 * Mirror the directive's accept/multiple options onto the hidden input so
 * the native file picker filters at the OS level too. The directive
 * still re-validates on `change` — the input's `accept` is a hint, not a
 * guarantee (drag-from-finder bypasses it on some platforms).
 *
 * Every branch is conditional on the value actually differing; see `setAttr`
 * for the loop that unconditional writes cause.
 */
export function syncPickerAttrs(input: HTMLInputElement, opts: DropzoneOptions): void {
  const multiple = opts.multiple !== false
  if (input.multiple !== multiple) input.multiple = multiple
  if (typeof opts.accept === 'string' && opts.accept.trim() !== '') {
    setAttr(input, 'accept', opts.accept)
  } else {
    // `removeAttribute` on an attribute that is not there queues nothing —
    // measured in Chrome, where a sync with no `accept` produced records for
    // `multiple` and `aria-label` only — so this needs no guard of its own.
    input.removeAttribute('accept')
  }
  // The name is `multiple`-dependent, so it is mirrored on every sync — not
  // only at creation — and follows a reactive `multiple` / `pickerLabel` change.
  setAttr(input, 'aria-label', pickerLabel(opts))
}

/**
 * The picker input's accessible name: `pickerLabel` when the consumer gave a
 * usable one, otherwise a `multiple`-aware default. A blank label falls back
 * rather than shipping an unnamed control, mirroring how `accept` treats an
 * empty string.
 */
function pickerLabel(opts: DropzoneOptions): string {
  if (typeof opts.pickerLabel === 'string' && opts.pickerLabel.trim() !== '') return opts.pickerLabel
  return opts.multiple === false ? DEFAULT_PICKER_LABEL_SINGLE : DEFAULT_PICKER_LABEL_MULTIPLE
}

/**
 * Focusability follows the affordance.
 *
 * With `clickToPick` on, the host is a click target and this input is the
 * keyboard equivalent of that target: naturally focusable (no `tabindex`),
 * announced by its `aria-label`, and activated by Enter/Space natively.
 *
 * With `clickToPick` off the input still exists — `api.open()` needs it — but
 * nothing on screen points at it, so a tab stop there would be a phantom one
 * on a zone the consumer deliberately opted out of. It leaves the tab order
 * (`tabindex="-1"`) and the accessibility tree (`aria-hidden`); the consumer's
 * own button, the thing that calls `api.open()`, is the affordance instead.
 *
 * The host itself is never touched — no injected `role`, no injected
 * `tabindex`. `role="button"` would make the host's children presentational
 * and hide the inner button or link of a "drag files here or browse" layout.
 */
export function applyPickerA11y(
  input: HTMLInputElement,
  opts: DropzoneOptions,
  { keyboardAffordance }: { keyboardAffordance: boolean },
): void {
  setAttr(input, 'aria-label', pickerLabel(opts))
  if (keyboardAffordance) {
    input.removeAttribute('tabindex')
    input.removeAttribute('aria-hidden')
    return
  }
  setAttr(input, 'tabindex', '-1')
  setAttr(input, 'aria-hidden', 'true')
}

/**
 * Ensure a hidden file input exists, wired with a `change` handler that
 * pipes picked files through `processFiles`. Returns the input. Shared
 * between `clickToPick: true` and `api.open()`.
 */
export function ensurePickerInput(el: HTMLElement, instance: DropzoneInstance): HTMLInputElement {
  const affordance = { keyboardAffordance: instance.pickerHostClick !== null }
  if (instance.pickerInput) {
    syncPickerAttrs(instance.pickerInput, instance.opts)
    applyPickerA11y(instance.pickerInput, instance.opts, affordance)
    return instance.pickerInput
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.style.cssText = PICKER_HIDDEN_STYLE
  syncPickerAttrs(input, instance.opts)
  applyPickerA11y(input, instance.opts, affordance)
  el.appendChild(input)

  // Opening the picker means `input.click()`, and that click bubbles. Left
  // alone it reaches the consumer's own handler on the host: measured in
  // Chrome, one real click on a zone fired the host's `click` listener twice
  // — once untrusted with `target` = this input, once for the user's actual
  // event — so `@click="selected = !selected"` on a zone toggled twice and
  // looked inert. `api.open()` fired it with no click on the page at all.
  // Nothing inside the directive needs it to bubble (the host handler already
  // ignores clicks whose target is an interactive descendant, which this is),
  // so it stops at the input. The listener cannot outlive the element: this
  // module creates the input and `destroyPickerInput` removes it.
  input.addEventListener('click', (event) => event.stopPropagation())

  const onChange = (): void => {
    const files = input.files ? Array.from(input.files) : []
    processFiles(el, instance, files)
    input.value = ''
  }
  input.addEventListener('change', onChange)

  instance.pickerInput = input
  instance.pickerChange = onChange
  return input
}

/**
 * The built-in interactive list plus the consumer's `clickIgnore`.
 *
 * Read from the live `opts` on every click rather than baked into the
 * listener at setup, so a reactive `clickIgnore` takes effect without
 * re-binding. A blank value is treated as unset — same rule `accept` and
 * `pickerLabel` follow. The selector must be valid CSS: an invalid one makes
 * `closest()` throw, loudly, which is the signal.
 */
function ignoreSelector(opts: DropzoneOptions): string {
  const extra = typeof opts.clickIgnore === 'string' ? opts.clickIgnore.trim() : ''
  return extra === '' ? INTERACTIVE_SELECTOR : `${INTERACTIVE_SELECTOR}, ${extra}`
}

/**
 * True when the click that just fired is the one that ended a text selection
 * touching the host.
 *
 * Selecting the zone's own instructional text ends with a mouse-up inside the
 * zone, and the browser follows that with a `click`. Without this the user who
 * just highlighted a line of copy gets an OS file dialog. Either end of the
 * selection being inside is enough — a drag that starts outside and finishes
 * in the zone is the same gesture.
 *
 * Not unit-tested: jsdom's `Selection` is inert (`isCollapsed` is always
 * true), so a green jsdom test would prove nothing. Verified in a browser.
 */
function endsATextSelection(el: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return false
  return isInside(el, selection.anchorNode) || isInside(el, selection.focusNode)
}

function isInside(el: HTMLElement, node: Node | null): boolean {
  return node !== null && el.contains(node)
}

export function setupClickToPick(el: HTMLElement, instance: DropzoneInstance): void {
  if (instance.pickerHostClick) return
  const input = ensurePickerInput(el, instance)

  const onHostClick = (event: MouseEvent): void => {
    // A double-click fires two `click` events (detail 1, then 2). Without this
    // the second one opens a picker on top of the first.
    if (event.detail > 1) return

    const target = event.target as Element | null
    if (!target || typeof target.closest !== 'function') return
    // The host matching the selector is not a reason to bail: a zone that
    // carries its own `tabindex` or `role` is still the click target. Only a
    // *descendant* with click semantics of its own wins.
    const interactive = target.closest(ignoreSelector(instance.opts))
    if (interactive && interactive !== el) return

    if (endsATextSelection(el)) return

    // Read the live input off the instance, not the one captured at setup —
    // a reactive `enabled` cycle can have replaced it since.
    const picker = instance.pickerInput
    if (!picker) return
    // Focus before opening. A click on a real <button> leaves focus on it; a
    // click on this zone used to leave `document.activeElement` on BODY,
    // because `input.click()` does not focus and a <div> host cannot. Three
    // things depend on it not doing that:
    //  - `:focus-within`, which the README prescribes as the zone's focus
    //    affordance, never lit for the mouse user;
    //  - `pasteOn: 'host'` needs focus *inside* the host, and was relying on
    //    the collapsed text selection Chrome happens to leave behind — which
    //    the next click anywhere else destroys;
    //  - when the native dialog closes, focus returns to whatever had it.
    // `preventScroll` because the user is already looking at the zone they
    // just clicked; the input sits at the host's top-left (see `anchor.ts`)
    // and scrolling a tall zone up under the pointer would be a surprise.
    picker.focus({ preventScroll: true })
    picker.value = ''
    picker.click()
  }
  el.addEventListener('click', onHostClick)
  instance.pickerHostClick = onHostClick
  // The host is a click target now, so the input becomes its keyboard twin.
  applyPickerA11y(input, instance.opts, { keyboardAffordance: true })
  // …and a tab stop, so focusing it will scroll the page to it. That is only
  // safe once the host is its containing block — see `anchor.ts`.
  anchorPickerHost(el, instance)
}

export function teardownClickToPick(el: HTMLElement, instance: DropzoneInstance): void {
  if (instance.pickerHostClick) {
    el.removeEventListener('click', instance.pickerHostClick)
    instance.pickerHostClick = null
  }
  // Keep the picker input around as long as the directive is mounted —
  // `api.open()` may still want it. It's pruned in `detach()`. But with the
  // host affordance gone it must stop being a tab stop, or Tab lands on a
  // control the consumer has just opted out of.
  if (instance.pickerInput) {
    applyPickerA11y(instance.pickerInput, instance.opts, { keyboardAffordance: false })
  }
  // Nothing can focus the input any more, so the host does not need to be its
  // containing block. Give the consumer their `position` back.
  releasePickerHost(el, instance)
}

export function destroyPickerInput(instance: DropzoneInstance): void {
  if (!instance.pickerInput) return
  if (instance.pickerChange) instance.pickerInput.removeEventListener('change', instance.pickerChange)
  instance.pickerInput.remove()
  instance.pickerInput = null
  instance.pickerChange = null
}
