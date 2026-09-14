/**
 * The picker input's containing block — the one place the directive writes
 * layout to an element it does not own, and the reason it has to.
 *
 * The picker `<input type="file">` is `position: absolute` (see
 * `PICKER_HIDDEN_STYLE` for why that is not negotiable) with `left:0; top:0`.
 * Absolute offsets resolve against the nearest *positioned* ancestor, so on a
 * `static` host — the default, and what the README quick-start produces —
 * they resolve against the **initial containing block** instead: the input
 * lands at document (0, 0) while its zone is 6000px further down the page.
 * Focusing it then scrolls the page away from the zone the user was trying to
 * reach, which is what shipped in DZ-1b and is what this module exists to
 * stop.
 *
 * Three alternatives were measured in Chrome against six host shapes (static,
 * already positioned, inside a transformed ancestor, inside a scrolling pane,
 * a host that is its own scroll container, a flex host) and all three lose:
 *
 * - **`position: absolute` with no offsets** (the input's *static position*,
 *   i.e. where it would have sat in flow) puts it inside the zone at rest,
 *   but its containing block is still the initial one, so it does not move
 *   when an ancestor scrolls: scrolling a pane by 300px pulled the input
 *   300px away from its zone, and the drift is unbounded.
 * - **In flow** tracks the zone perfectly but stops being free: a 1px in-flow
 *   box is a flex item, a grid item, an extra `:last-child`, and it lands at
 *   the *end* of the zone's content — 634px down inside a scrolling zone.
 * - **`position: fixed`** is always on screen, so focus never scrolls at all
 *   and the zone can stay off-screen with an invisible focus ring.
 *
 * So the host has to be the containing block, and only the host's own
 * `position` can make it one. What is under the directive's control is the
 * blast radius:
 *
 * - It writes only when the computed position is exactly `static`. A host
 *   that is already `relative`, `absolute`, `fixed` or `sticky` is never
 *   touched.
 * - It writes only while the picker input is a keyboard affordance — i.e.
 *   while click-to-pick is on. `clickToPick: false` zones, and the input that
 *   `api.open()` creates on one, are `tabindex="-1"`: nothing focuses them,
 *   so nothing scrolls to them, so they need no anchor.
 * - It reverts on teardown and on unmount, and only ever reverts a value it
 *   set itself (`pickerHostPositioned`).
 *
 * The cost, documented in the README: `position: relative` makes the host a
 * containing block for the consumer's *own* absolutely positioned children
 * too, and puts it in the positioned-descendant paint layer. A consumer who
 * needs neither thing sets any `position` of their own and this module stands
 * down.
 */
import { PICKER_HOST_POSITION } from './constants'
import type { DropzoneInstance } from './state'

/**
 * Is the host already a containing block for absolutely positioned children?
 *
 * The question is asked of the *computed* value, not the inline one, so a
 * host positioned by a stylesheet counts. Two environments answer `''` rather
 * than `'static'` for an unpositioned element — jsdom for every element, and
 * Chrome for an element that is not connected to a document — and `''` is
 * read as "not positioned", the same as `static`. Erring that way anchors a
 * host that may not have needed it (an inline `position: relative` a
 * consumer's own stylesheet was going to supply); erring the other way
 * reinstates the scroll jump this module exists to prevent.
 *
 * `sticky` is deliberately included: it is a containing block for absolutely
 * positioned descendants, and it is the consumer's own positioning choice.
 */
function isPositioned(el: HTMLElement): boolean {
  const position = window.getComputedStyle(el).position
  return position !== '' && position !== 'static'
}

/**
 * Make the host the picker input's containing block, unless it already is one.
 *
 * Safe to call repeatedly, and `directive.ts` does — on every `updated`, not
 * only when the picker is set up. The anchor is an inline style and inline
 * styles are shared territory: Vue patches a **string** `:style` binding with
 * `el.style.cssText = next`, which wipes every inline property the element
 * had, this one included. Measured on Vue 3.5.41 in Chrome: a zone with
 * `:style="\`border: ${x}\`"` lost its `position` the first time `x` changed
 * and DZ-3 was live again, silently. (An *object* binding sets properties one
 * at a time and does not.) `updated` runs after Vue has patched the element,
 * so it is the one place that can see the damage; the state is read off the
 * element rather than off `pickerHostPositioned`, because the flag records
 * what this module *wrote*, not what survived.
 */
export function anchorPickerHost(el: HTMLElement, instance: DropzoneInstance): void {
  if (isPositioned(el)) {
    // Positioned by someone. If it is no longer the value we wrote, the
    // consumer has taken the property over since — an object `:style` binding,
    // a conditional class that resolved to an inline style, a sticky header —
    // and the claim has to be dropped or teardown would delete their value.
    if (instance.pickerHostPositioned && el.style.position !== PICKER_HOST_POSITION) {
      instance.pickerHostPositioned = false
    }
    return
  }
  el.style.position = PICKER_HOST_POSITION
  instance.pickerHostPositioned = true
}

/**
 * Undo `anchorPickerHost`. A no-op unless this directive is the thing that
 * wrote the position — a host that arrived positioned is never un-positioned.
 *
 * The flag alone is not enough to know that. It records that the directive
 * wrote a position at *some point*, not that the value sitting on the element
 * now is still that write; a consumer who positions the host after we anchored
 * it owns the property from then on, and Vue will not put their value back
 * (`patchStyle` skips when the binding value is unchanged). So the current
 * inline value is checked too, and only the exact string this module writes is
 * removed. A consumer who sets inline `relative` themselves is indistinguishable
 * from us and does lose it — the price of not tracking every write.
 */
export function releasePickerHost(el: HTMLElement, instance: DropzoneInstance): void {
  if (!instance.pickerHostPositioned) return
  instance.pickerHostPositioned = false
  if (el.style.position !== PICKER_HOST_POSITION) return
  el.style.removeProperty('position')
}
