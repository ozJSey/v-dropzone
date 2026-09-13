/**
 * Shared defaults + the interactive-descendant selector.
 *
 * Leaf module: imports only types.
 */
import type { UploadMethod } from './types'

export const DEFAULT_REJECT_DURATION = 1500
export const DEFAULT_SUCCESS_DURATION = 1500
export const DEFAULT_FIELD_NAME = 'file'
export const DEFAULT_UPLOAD_METHOD: UploadMethod = 'POST'

/**
 * Selector for elements whose own click semantics should win over the
 * dropzone's click-to-pick. `closest()` against this catches both the
 * exact target and any interactive ancestor (e.g. an icon inside a button).
 *
 * Click-to-pick is on by default, so this list is what stands between
 * "click anywhere opens the picker" and "every control inside the zone is
 * shadowed by it". Beyond the native form controls it therefore covers:
 *  - `[tabindex]:not([tabindex="-1"])` — anything the author made a tab stop
 *    is, by definition, something the user is meant to activate. `-1` is
 *    excluded: it means *programmatically* focusable, not clickable.
 *  - `[role="button"]` — the custom-control convention, for widgets that
 *    carry no tabindex of their own.
 *  - `summary` — the disclosure toggle of a `<details>`.
 *  - `audio[controls]`, `video[controls]` — a visible transport bar; without
 *    `controls` the element has no click semantics of its own.
 * `clickIgnore` extends this per-zone for anything this list cannot see.
 */
export const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label,' +
  ' [contenteditable]:not([contenteditable="false"]),' +
  ' [tabindex]:not([tabindex="-1"]), [role="button"], summary,' +
  ' audio[controls], video[controls]'

/**
 * Visually-hidden style for the picker `<input type="file">`.
 *
 * Deliberately NOT `display: none`. HTML5 drag-and-drop has no keyboard or
 * assistive-technology story by design, so this input is not a fallback — it
 * is the only accessible route into click-to-pick. `display: none` takes it
 * out of the tab order and out of the accessibility tree; the clip recipe
 * takes it out of *view* only, so Tab reaches it and Enter/Space open the
 * native picker with no key handling of our own.
 *
 * Two properties of this recipe are load-bearing, and they pull in opposite
 * directions:
 *
 * 1. **`position: absolute` keeps the input out of the host's formatting
 *    context.** An in-flow 1px box is a *child* of whatever the host is: a
 *    flex item, a grid item, a table cell, an extra `:last-child`. Measured:
 *    putting it in flow inside a `justify-content: space-between` flex zone
 *    moved that zone's second child 170px. Out of flow it contributes
 *    nothing — document scroll extents are byte-identical with and without it.
 * 2. **Focusing it scrolls the page to wherever it is**, because that is what
 *    every browser does with the focused element. So it has to be *inside its
 *    own zone*, or Tab throws the user somewhere else on the page.
 *
 * `left:0; top:0` satisfies (2) only if the host is the input's containing
 * block, which is why `anchor.ts` guarantees that. It used to read
 * `left:0; bottom:0` with no such guarantee, and on a `static` host — the
 * default, and what the README quick-start produces — the containing block is
 * then the *initial* containing block: the input sat at document
 * (0, viewport height) no matter where its zone was. Measured, on a long page:
 * a real Tab moved `scrollY` 5535 → 656 and left the zone 5722px below the
 * fold. Anchoring to the top-left of the host's padding box is the only
 * variant that held for all six host shapes tested (static, already
 * positioned, inside a transformed ancestor, inside a scrolling pane, a host
 * that is its own scroll container, and a flex host).
 *
 * Not `position: fixed`: a fixed input is always "in view", so focusing it
 * never scrolls — the zone stays wherever it was and `:focus-within` paints a
 * focus ring the user cannot see.
 *
 * `clip` is the deprecated fallback for `clip-path`; both are kept because
 * the pair is what makes the recipe work everywhere. `clip` applies only to
 * absolutely positioned elements, which is a third reason (1) is not optional.
 */
export const PICKER_HIDDEN_STYLE =
  'position:absolute; left:0; top:0; width:1px; height:1px;' +
  ' padding:0; margin:0; border:0; overflow:hidden;' +
  ' clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap;'

/**
 * What the host is set to when it has no `position` of its own, so that
 * `PICKER_HIDDEN_STYLE`'s `left:0; top:0` resolves against the zone rather
 * than against the initial containing block. Applied and reverted by
 * `anchor.ts`; see that module for why the write is unavoidable.
 */
export const PICKER_HOST_POSITION = 'relative'

/** Accessible name for the picker input when `multiple` is on (the default). */
export const DEFAULT_PICKER_LABEL_MULTIPLE = 'Choose files'
/** Accessible name for the picker input when `multiple: false`. */
export const DEFAULT_PICKER_LABEL_SINGLE = 'Choose file'
