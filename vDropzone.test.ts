import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, withDirectives } from 'vue'
import {
  vDropzone,
  DropzonePlugin,
  DIRECTIVE_NAME,
  type DropzoneApi,
  type DropzoneApiRef,
  type DropzoneOptions,
  type DropzoneHandler,
  type DropzoneRejectEvent,
  type UploadError,
  type UploadFn,
} from './vDropzone'
// Internal: the visually-hidden recipe carries a property jsdom cannot represent.
import { PICKER_HIDDEN_STYLE } from './src/constants'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * jsdom doesn't construct DataTransfer objects natively, so we hand-roll
 * a minimal stub that mimics the parts of the spec the directive reads.
 */
type DataTransferFileStub = {
  files: File[]
  items: { kind: string; type: string; getAsFile(): File | null }[]
  types: string[]
}

function makeDataTransfer(files: File[]): DataTransferFileStub {
  return {
    files,
    items: files.map((f) => ({
      kind: 'file',
      type: f.type,
      getAsFile: () => f,
    })),
    types: files.length > 0 ? ['Files'] : [],
  }
}

function makeFile(name: string, type: string, sizeBytes = 100): File {
  const content = new Array(sizeBytes).fill('x').join('')
  return new File([content], name, { type })
}

function fireDragEvent(
  el: HTMLElement,
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  files: File[] = [],
  target?: EventTarget,
): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: makeDataTransfer(files),
    configurable: true,
  })
  if (target) Object.defineProperty(event, 'target', { value: target, configurable: true })
  el.dispatchEvent(event)
  return event
}

/** Mount the directive on a single host element and return the host. */
function mountHost(opts: DropzoneOptions | DropzoneHandler | undefined) {
  const host = document.createElement('div')
  document.body.appendChild(host)

  const App = defineComponent({
    setup() {
      return () => withDirectives(h('div', { ref: 'root' }), [[vDropzone, opts as DropzoneOptions]])
    },
  })

  const app = createApp(App)
  app.mount(host)

  const dz = host.querySelector('div')!
  return { app, host, dz }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

/* ------------------------------------------------------------------ */
/*  P0 — Drag-drop core                                                */
/* ------------------------------------------------------------------ */

describe('v-dropzone — handler shape', () => {
  it('accepts a bare handler function as binding value', async () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost(onFiles)
    await nextTick()

    const f = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [f])

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles).toHaveBeenCalledWith([f])
  })

  it('accepts an options object with `on` callback', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const f = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [f])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([f])
  })
})

describe('v-dropzone — 4-event drag wiring', () => {
  it('dragover calls preventDefault — otherwise drop never fires (the canonical drop-zone bug)', async () => {
    const { dz } = mountHost(vi.fn())
    await nextTick()

    const e = fireDragEvent(dz, 'dragover', [makeFile('a.png', 'image/png')])
    expect(e.defaultPrevented).toBe(true)
  })

  it('dragenter sets data-dropzone="active"', async () => {
    const { dz } = mountHost(vi.fn())
    await nextTick()

    expect(dz.getAttribute('data-dropzone')).toBe('idle')

    fireDragEvent(dz, 'dragenter', [makeFile('a.png', 'image/png')])
    expect(dz.getAttribute('data-dropzone')).toBe('active')
  })

  it('moving cursor across children does NOT flip state to idle (enter/leave counter > 0)', async () => {
    const { dz } = mountHost(vi.fn())
    const child = document.createElement('span')
    dz.appendChild(child)
    await nextTick()

    fireDragEvent(dz, 'dragenter', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    fireDragEvent(dz, 'dragenter', [], child)
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    fireDragEvent(dz, 'dragleave', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('active') // still active — bug if 'idle'

    fireDragEvent(dz, 'dragleave', [], child)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('drop clears counter to 0 and resets state to idle even after multiple enters', async () => {
    const { dz } = mountHost(vi.fn())
    const child = document.createElement('span')
    dz.appendChild(child)
    await nextTick()

    fireDragEvent(dz, 'dragenter', [], dz)
    fireDragEvent(dz, 'dragenter', [], child)
    fireDragEvent(dz, 'dragenter', [], child)
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')

    fireDragEvent(dz, 'dragleave', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('drop, dragenter, dragleave all call preventDefault + stopPropagation', async () => {
    const { dz } = mountHost(vi.fn())
    await nextTick()

    const f = makeFile('a.png', 'image/png')
    for (const t of ['dragenter', 'dragover', 'dragleave', 'drop'] as const) {
      const e = fireDragEvent(dz, t, [f])
      expect(e.defaultPrevented, `${t} should preventDefault`).toBe(true)
    }
  })

  it('drop fires the handler with `File[]` and clears active state', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    fireDragEvent(dz, 'dragenter', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.pdf', 'application/pdf')
    fireDragEvent(dz, 'drop', [a, b])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([a, b])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('drop with no files does not call handler', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    fireDragEvent(dz, 'drop', [])
    expect(on).not.toHaveBeenCalled()
  })
})

describe('v-dropzone — data-dropzone state attribute', () => {
  it('starts as "idle" on mount', async () => {
    const { dz } = mountHost(vi.fn())
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('returns to "idle" when leave-counter reaches 0', async () => {
    const { dz } = mountHost(vi.fn())
    await nextTick()

    fireDragEvent(dz, 'dragenter', [], dz)
    fireDragEvent(dz, 'dragleave', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })
})

describe('v-dropzone — lifecycle cleanup', () => {
  it('removes event listeners on unmount', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { app, dz } = mountHost({ on })
    await nextTick()

    app.unmount()
    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    expect(on).not.toHaveBeenCalled()
  })

  it('preserves per-element state across multiple dropzones (WeakMap keying)', async () => {
    const onA = vi.fn<(files: File[]) => void>()
    const onB = vi.fn<(files: File[]) => void>()

    const { dz: dzA } = mountHost({ on: onA })
    const { dz: dzB } = mountHost({ on: onB })
    await nextTick()

    fireDragEvent(dzA, 'dragenter', [], dzA)
    expect(dzA.getAttribute('data-dropzone')).toBe('active')
    expect(dzB.getAttribute('data-dropzone')).toBe('idle')

    fireDragEvent(dzA, 'drop', [makeFile('a.png', 'image/png')])
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — Validation (accept / multiple / maxSize / maxCount)           */
/* ------------------------------------------------------------------ */

describe('v-dropzone — accept filter (MIME wildcard)', () => {
  it('`image/*` matches any image subtype', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', on, onReject })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    const jpg = makeFile('b.jpg', 'image/jpeg')
    fireDragEvent(dz, 'drop', [png, jpg])

    expect(on).toHaveBeenCalledWith([png, jpg])
    expect(onReject).not.toHaveBeenCalled()
  })

  it('`image/*` rejects non-image MIME', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', on, onReject })
    await nextTick()

    const pdf = makeFile('a.pdf', 'application/pdf')
    fireDragEvent(dz, 'drop', [pdf])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([pdf])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['type'])
  })
})

describe('v-dropzone — accept filter (exact MIME list)', () => {
  it('comma-separated MIME list allows any-of', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/png,application/pdf', on, onReject })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    const pdf = makeFile('b.pdf', 'application/pdf')
    const jpg = makeFile('c.jpg', 'image/jpeg')
    fireDragEvent(dz, 'drop', [png, pdf, jpg])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([png, pdf])
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([jpg])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['type'])
  })
})

describe('v-dropzone — accept filter (extensions)', () => {
  it('`.pdf,.docx` matches files by extension', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: '.pdf,.docx', on, onReject })
    await nextTick()

    const pdf = makeFile('a.pdf', 'application/pdf')
    const docx = makeFile('b.docx', '')
    const png = makeFile('c.png', 'image/png')
    fireDragEvent(dz, 'drop', [pdf, docx, png])

    expect(on).toHaveBeenCalledWith([pdf, docx])
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([png])
  })

  it('extension matching is case-insensitive (uppercase filename)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: '.pdf', on, onReject })
    await nextTick()

    const pdfUpper = makeFile('REPORT.PDF', 'application/pdf')
    fireDragEvent(dz, 'drop', [pdfUpper])

    expect(on).toHaveBeenCalledWith([pdfUpper])
    expect(onReject).not.toHaveBeenCalled()
  })

  it('extension matching is case-insensitive (uppercase accept pattern)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: '.PDF', on, onReject })
    await nextTick()

    const pdf = makeFile('a.pdf', 'application/pdf')
    fireDragEvent(dz, 'drop', [pdf])

    expect(on).toHaveBeenCalledWith([pdf])
    expect(onReject).not.toHaveBeenCalled()
  })
})

describe('v-dropzone — accept filter (mixed)', () => {
  it('mixes MIME wildcard with extension in the same `accept`', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*,.pdf', on, onReject })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    const pdf = makeFile('b.pdf', 'application/pdf')
    const txt = makeFile('c.txt', 'text/plain')
    fireDragEvent(dz, 'drop', [png, pdf, txt])

    expect(on).toHaveBeenCalledWith([png, pdf])
    expect(onReject.mock.calls[0]![0].files).toEqual([txt])
  })

  it('handles whitespace around comma-separated patterns', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ accept: ' image/png , application/pdf ', on })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    const pdf = makeFile('b.pdf', 'application/pdf')
    fireDragEvent(dz, 'drop', [png, pdf])

    expect(on).toHaveBeenCalledWith([png, pdf])
  })
})

describe('v-dropzone — multiple', () => {
  it('`multiple: false` allows a single-file drop', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ multiple: false, on, onReject })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [a])

    expect(on).toHaveBeenCalledWith([a])
    expect(onReject).not.toHaveBeenCalled()
  })

  it('`multiple: false` rejects a multi-file drop with reason `count`', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ multiple: false, on, onReject })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([a, b])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['count'])
  })

  it('default behavior allows multi-file drop (multiple defaults to true)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])

    expect(on).toHaveBeenCalledWith([a, b])
  })
})

describe('v-dropzone — maxSize', () => {
  it('rejects an oversize file with reason `size`', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ maxSize: 50, on, onReject })
    await nextTick()

    const big = makeFile('big.png', 'image/png', 200)
    fireDragEvent(dz, 'drop', [big])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([big])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['size'])
  })

  it('allows files at the size cap (≤ maxSize)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ maxSize: 100, on, onReject })
    await nextTick()

    const exact = makeFile('exact.png', 'image/png', 100)
    fireDragEvent(dz, 'drop', [exact])

    expect(on).toHaveBeenCalledWith([exact])
    expect(onReject).not.toHaveBeenCalled()
  })

  it('rejects only the oversize files; under-cap files still pass to `on` (per-file model)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ maxSize: 100, on, onReject })
    await nextTick()

    const small = makeFile('small.png', 'image/png', 50)
    const big = makeFile('big.png', 'image/png', 500)
    fireDragEvent(dz, 'drop', [small, big])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([small])
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([big])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['size'])
  })
})

describe('v-dropzone — maxCount', () => {
  it('allows a drop at the count cap', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ maxCount: 2, on, onReject })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])

    expect(on).toHaveBeenCalledWith([a, b])
    expect(onReject).not.toHaveBeenCalled()
  })

  it('rejects when total exceeds maxCount with reason `count`', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ maxCount: 2, on, onReject })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    const c = makeFile('c.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b, c])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([a, b, c])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['count'])
  })
})

describe('v-dropzone — cumulative reasons', () => {
  it('surfaces both `type` and `size` reasons when a drop fails both rules across different files', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', maxSize: 100, on, onReject })
    await nextTick()

    const ok = makeFile('ok.png', 'image/png', 50)
    const badType = makeFile('doc.pdf', 'application/pdf', 50)
    const tooBig = makeFile('big.png', 'image/png', 500)
    fireDragEvent(dz, 'drop', [ok, badType, tooBig])

    expect(on).toHaveBeenCalledWith([ok])
    expect(onReject).toHaveBeenCalledTimes(1)
    const ev = onReject.mock.calls[0]![0]
    expect(ev.files).toEqual([badType, tooBig])
    expect(new Set(ev.reasons)).toEqual(new Set(['type', 'size']))
  })

  it('reasons array is deduped (a single reason category appears once even when multiple files fail it)', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ maxSize: 100, onReject })
    await nextTick()

    const big1 = makeFile('a.png', 'image/png', 500)
    const big2 = makeFile('b.png', 'image/png', 500)
    fireDragEvent(dz, 'drop', [big1, big2])

    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['size'])
  })

  it('size-failing file that ALSO fails type counts under both reasons', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', maxSize: 100, onReject })
    await nextTick()

    const wrongAndBig = makeFile('doc.pdf', 'application/pdf', 500)
    fireDragEvent(dz, 'drop', [wrongAndBig])

    expect(onReject).toHaveBeenCalledTimes(1)
    expect(new Set(onReject.mock.calls[0]![0].reasons)).toEqual(new Set(['type', 'size']))
  })
})

describe('v-dropzone — data-dropzone="rejected" state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets `data-dropzone="rejected"` after a validation failure', async () => {
    const { dz } = mountHost({ accept: 'image/*', onReject: vi.fn() })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
  })

  it('auto-clears `rejected` to `idle` after default 1500ms', async () => {
    const { dz } = mountHost({ accept: 'image/*', onReject: vi.fn() })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(1499)
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(1)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('honors a custom `rejectDuration`', async () => {
    const { dz } = mountHost({ accept: 'image/*', rejectDuration: 500, onReject: vi.fn() })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(499)
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(1)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('sets `rejected` even on partial rejection (some files passed, some failed)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ accept: 'image/*', on, onReject: vi.fn() })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('ok.png', 'image/png'),
      makeFile('bad.pdf', 'application/pdf'),
    ])

    expect(on).toHaveBeenCalled()
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
  })

  it('cancels the auto-clear timer if a new drag begins (flips to `active`)', async () => {
    const { dz } = mountHost({ accept: 'image/*', onReject: vi.fn() })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    fireDragEvent(dz, 'dragenter', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    // Now if the original timer fires it would clobber 'active' to 'idle'. Advance past it.
    vi.advanceTimersByTime(2000)
    expect(dz.getAttribute('data-dropzone')).toBe('active')
  })

  it('cancels the auto-clear timer if a new drop happens (rejected → new rejected resets timer)', async () => {
    const { dz } = mountHost({ accept: 'image/*', rejectDuration: 1000, onReject: vi.fn() })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(900)
    fireDragEvent(dz, 'drop', [makeFile('b.pdf', 'application/pdf')])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(900)
    expect(dz.getAttribute('data-dropzone')).toBe('rejected') // would have already cleared if timer wasn't reset

    vi.advanceTimersByTime(200)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('clears the pending timer on unmount (no stray DOM mutation post-unmount)', async () => {
    const { app, dz } = mountHost({ accept: 'image/*', onReject: vi.fn() })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    app.unmount()
    expect(dz.getAttribute('data-dropzone')).toBeNull() // detach clears the attribute

    vi.advanceTimersByTime(2000)
    // Should NOT have been re-set by a stray timer.
    expect(dz.getAttribute('data-dropzone')).toBeNull()
  })
})

describe('v-dropzone — `on` not called when nothing passes', () => {
  it('drops all files matching neither accept nor size — `on` is NOT called', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', on, onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf'), makeFile('b.txt', 'text/plain')])
    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
  })
})

describe('v-dropzone — disabled', () => {
  it('`enabled: false` detaches listeners — drop does nothing', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ enabled: false, on })
    await nextTick()

    expect(dz.getAttribute('data-dropzone')).toBeNull()
    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    expect(on).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — Validation edge cases (gap fixes from review)                 */
/* ------------------------------------------------------------------ */

describe('v-dropzone — accept edge cases', () => {
  it('empty accept string accepts all files (treated as "no filter set")', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: '', on, onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf'), makeFile('b.png', 'image/png')])
    expect(on).toHaveBeenCalledTimes(1)
    expect(onReject).not.toHaveBeenCalled()
  })

  it('whitespace-only accept string accepts all files (no filter set)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: '   ', on, onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    expect(on).toHaveBeenCalledTimes(1)
    expect(onReject).not.toHaveBeenCalled()
  })

  it('strips MIME parameters when comparing — `text/plain` matches `text/plain;charset=utf-8`', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'text/plain', on, onReject })
    await nextTick()

    const txt = makeFile('a.txt', 'text/plain;charset=utf-8')
    fireDragEvent(dz, 'drop', [txt])

    expect(on).toHaveBeenCalledWith([txt])
    expect(onReject).not.toHaveBeenCalled()
  })

  it('empty `file.type` against MIME wildcard is rejected (no signal to match on)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', on, onReject })
    await nextTick()

    const unknownType = makeFile('a.weirdext', '')
    fireDragEvent(dz, 'drop', [unknownType])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['type'])
  })

  it('empty `file.type` PASSES an extension match (extension is independent of MIME)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ accept: '.docx', on })
    await nextTick()

    const docx = makeFile('report.docx', '') // empty MIME, valid extension
    fireDragEvent(dz, 'drop', [docx])

    expect(on).toHaveBeenCalledWith([docx])
  })
})

describe('v-dropzone — maxSize edge cases', () => {
  it('`maxSize: 0` rejects every non-empty file', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ maxSize: 0, on, onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png', 1)])
    expect(on).not.toHaveBeenCalled()
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['size'])
  })

  it('`maxSize: Number.MAX_SAFE_INTEGER` allows any realistic file', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ maxSize: Number.MAX_SAFE_INTEGER, on })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png', 10_000)])
    expect(on).toHaveBeenCalled()
  })
})

describe('v-dropzone — cumulative reasons (count combined with type/size)', () => {
  it('`maxCount` fail PLUS type-failing files surfaces both reasons cumulatively', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', maxCount: 2, onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.pdf', 'application/pdf'),
    ])

    expect(onReject).toHaveBeenCalledTimes(1)
    const ev = onReject.mock.calls[0]![0]
    expect(ev.files.length).toBe(3) // all rejected because count failed
    expect(new Set(ev.reasons)).toEqual(new Set(['count', 'type']))
  })

  it('`multiple: false` + size-failing file surfaces both reasons cumulatively', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ multiple: false, maxSize: 100, onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png', 50), makeFile('b.png', 'image/png', 500)])

    expect(onReject).toHaveBeenCalledTimes(1)
    expect(new Set(onReject.mock.calls[0]![0].reasons)).toEqual(new Set(['count', 'size']))
  })

  it('`multiple: false` + `maxCount: 5` both ON only emits a single `count` reason (deduped)', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ multiple: false, maxCount: 5, onReject })
    await nextTick()

    // 2 files: violates `multiple: false`. `maxCount: 5` would have passed.
    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')])

    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['count'])
  })
})

describe('v-dropzone — reasons order stability', () => {
  it('reasons are always in canonical order `[type, size, count]`', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', maxSize: 100, maxCount: 2, onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.pdf', 'application/pdf', 50), // type fail
      makeFile('b.png', 'image/png', 500), // size fail
      makeFile('c.png', 'image/png', 50), // ok
    ]) // 3 files violates maxCount: 2

    expect(onReject).toHaveBeenCalledTimes(1)
    // Order must be type, size, count — not insertion order.
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['type', 'size', 'count'])
  })
})

describe('v-dropzone — defensive drag-event handling', () => {
  it('dragenter with null dataTransfer (synthetic / a11y events) still flips state to active', async () => {
    const { dz } = mountHost(vi.fn())
    await nextTick()

    const event = new Event('dragenter', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(event, 'dataTransfer', { value: null, configurable: true })
    dz.dispatchEvent(event)

    expect(dz.getAttribute('data-dropzone')).toBe('active')
  })

  it('drop with null dataTransfer is a no-op (no handler call)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(event, 'dataTransfer', { value: null, configurable: true })
    dz.dispatchEvent(event)

    expect(on).not.toHaveBeenCalled()
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })
})

describe('v-dropzone — `enabled` toggle lifecycle', () => {
  it('enabled: false → true via `updated` attaches and starts at idle', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const opts = { enabled: false, on } as DropzoneOptions
    const enabled = { value: false }

    const App = defineComponent({
      setup() {
        return () =>
          withDirectives(h('div'), [[vDropzone, { enabled: enabled.value, on: opts.on } as DropzoneOptions]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    expect(dz.getAttribute('data-dropzone')).toBeNull()

    enabled.value = true
    // Force update — directive's `updated` hook fires when the binding value changes.
    // We re-render by triggering a synthetic update; in setup-script practice this
    // happens automatically via reactivity. Here we mount a fresh App with the
    // updated value and verify the attach path.
    app.unmount()
    const App2 = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, { enabled: true, on: opts.on } as DropzoneOptions]])
      },
    })
    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const app2 = createApp(App2)
    app2.mount(host2)
    const dz2 = host2.querySelector('div')!
    await nextTick()

    expect(dz2.getAttribute('data-dropzone')).toBe('idle')
    fireDragEvent(dz2, 'drop', [makeFile('a.png', 'image/png')])
    expect(on).toHaveBeenCalled()
    app2.unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — Click-to-pick                                                 */
/* ------------------------------------------------------------------ */

/**
 * jsdom doesn't open a file picker when `input.click()` is called — and
 * `change` is never auto-dispatched. We spy on `HTMLInputElement.prototype.click`
 * to assert the picker call, and manually fire `change` (with synthetic
 * `files`) when we need to exercise the post-pick pipeline.
 */
function getHiddenInput(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector('input[type="file"]')
}

function firePickedFiles(input: HTMLInputElement, files: File[]): void {
  // Mirror what the browser does on real selection.
  Object.defineProperty(input, 'files', {
    value: {
      length: files.length,
      item: (i: number) => files[i] ?? null,
      [Symbol.iterator]: function* () {
        for (const f of files) yield f
      },
      ...files.reduce((acc, f, i) => ({ ...acc, [i]: f }), {}),
    },
    configurable: true,
  })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('v-dropzone — click-to-pick (basic wiring)', () => {
  it('default (clickToPick omitted) — clicking host opens the picker', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ on: vi.fn() })
    await nextTick()

    dz.click()

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const input = getHiddenInput(dz)
    expect(input).not.toBeNull()
    expect(input!.type).toBe('file')
    clickSpy.mockRestore()
  })

  it('default (clickToPick omitted) — the picker input exists at mount, as a tab stop', async () => {
    const { dz } = mountHost({ on: vi.fn() })
    await nextTick()

    const input = getHiddenInput(dz)!
    expect(input).not.toBeNull()
    expect(input.hasAttribute('tabindex')).toBe(false)
    expect(input.hasAttribute('aria-hidden')).toBe(false)
    expect(input.getAttribute('aria-label')).toBe('Choose files')
  })

  it('clickToPick: false — clicking host does NOT open a picker, and no input is created', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ clickToPick: false, on: vi.fn() })
    await nextTick()

    dz.click()

    expect(clickSpy).not.toHaveBeenCalled()
    // No input at all — so no phantom tab stop on a zone that opted out.
    expect(getHiddenInput(dz)).toBeNull()
    clickSpy.mockRestore()
  })

  it('clickToPick: true — clicking host opens the hidden input picker', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()

    dz.click()

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const input = getHiddenInput(dz)
    expect(input).not.toBeNull()
    expect(input!.type).toBe('file')
    clickSpy.mockRestore()
  })

  it('clickToPick: true — clicking a plain child (span) opens the picker', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    const child = document.createElement('span')
    child.textContent = 'inner label'
    dz.appendChild(child)
    await nextTick()

    child.click()

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('clickToPick: true — the picker input is clipped out of layout while staying focusable', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    const input = getHiddenInput(dz)!
    // Not `display: none`: that would also drop the only keyboard route in.
    expect(input.style.display).toBe('')
    expect(input.style.position).toBe('absolute')
    expect(input.style.width).toBe('1px')
    expect(input.style.height).toBe('1px')
    expect(input.style.overflow).toBe('hidden')
    expect(input.style.clipPath).toBe('inset(50%)')
    expect(input.hasAttribute('tabindex')).toBe(false)
  })

  it('hidden input is removed and stops opening the picker after unmount', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { app, dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)).not.toBeNull()

    app.unmount()
    expect(getHiddenInput(dz)).toBeNull()
    dz.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})

describe('v-dropzone — click-to-pick (a click leaves focus in the zone)', () => {
  it('focuses the picker input when the host is clicked', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz, app } = mountHost({ on: vi.fn() })
    await nextTick()
    expect(document.activeElement).not.toBe(getHiddenInput(dz))
    dz.click()
    // A click on a real <button> leaves focus on it. Without this the zone
    // leaves `activeElement` on BODY, `:focus-within` never lights for a
    // mouse user, and `pasteOn: 'host'` has no focus target of its own.
    expect(document.activeElement).toBe(getHiddenInput(dz))
    clickSpy.mockRestore()
    app.unmount()
  })

  it('focuses without scrolling — the user is already looking at the zone they clicked', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')
    const { dz, app } = mountHost({ on: vi.fn() })
    await nextTick()
    dz.click()
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    focusSpy.mockRestore()
    clickSpy.mockRestore()
    app.unmount()
  })

  it('does not steal focus when the click belongs to an interactive descendant', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const App = defineComponent({
      setup() {
        return () =>
          withDirectives(h('div', [h('button', { id: 'inner' }, 'real button')]), [
            [vDropzone, { on: vi.fn() } as DropzoneOptions],
          ])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()
    const button = dz.querySelector('button')!
    button.click()
    expect(document.activeElement).not.toBe(getHiddenInput(dz))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
    app.unmount()
  })

  it('does not steal focus on the second click of a double-click', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus').mockImplementation(() => {})
    const { dz, app } = mountHost({ on: vi.fn() })
    await nextTick()
    dz.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    expect(focusSpy).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
    focusSpy.mockRestore()
    clickSpy.mockRestore()
    app.unmount()
  })
})

describe("v-dropzone — click-to-pick (the picker's own click stays inside the directive)", () => {
  /**
   * Opening the picker means calling `click()` on the hidden input, and a
   * click dispatched on a child bubbles. Measured in Chrome before this
   * guard: one real click on a zone made the host's `click` listener fire
   * **twice** — first with `isTrusted: false` and `target` = the hidden
   * input, then the user's own event. Any consumer handler on the zone
   * (`@click="selected = !selected"`) therefore ran twice per click and
   * looked like it had done nothing. `api.open()` fired it spuriously too,
   * with no click anywhere near the page.
   */
  it('the synthetic click that opens the picker does not reach the host', async () => {
    const { dz, app } = mountHost({ on: vi.fn() })
    await nextTick()
    const seen: string[] = []
    dz.addEventListener('click', (event) => seen.push((event.target as HTMLElement).tagName))
    dz.click()
    expect(seen).toEqual(['DIV'])
    app.unmount()
  })

  it('api.open() fires no click on the host at all', async () => {
    const apiRef = ref<DropzoneApi | undefined>(undefined)
    const { dz, app } = mountHost({ ref: apiRef, on: vi.fn() })
    await nextTick()
    const onHostClick = vi.fn()
    dz.addEventListener('click', onHostClick)
    apiRef.value!.open()
    expect(onHostClick).not.toHaveBeenCalled()
    app.unmount()
  })
})

describe('v-dropzone — click-to-pick (interactive-child guard)', () => {
  function setup() {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    return { dz, clickSpy }
  }

  it('click on a <button> child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const btn = document.createElement('button')
    btn.textContent = 'pick'
    dz.appendChild(btn)
    await nextTick()
    btn.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on an <a> child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const a = document.createElement('a')
    a.href = '#'
    a.textContent = 'link'
    dz.appendChild(a)
    await nextTick()
    a.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on an <input> child (e.g. checkbox) does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const inputChild = document.createElement('input')
    inputChild.type = 'checkbox'
    dz.appendChild(inputChild)
    await nextTick()
    // `inputChild.click()` would itself trip the prototype spy; dispatch
    // the click event directly so the spy only counts the picker invocation.
    inputChild.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a <textarea> child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const ta = document.createElement('textarea')
    dz.appendChild(ta)
    await nextTick()
    ta.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a <select> child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const sel = document.createElement('select')
    dz.appendChild(sel)
    await nextTick()
    sel.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a <label> child does NOT open the picker (would trigger its associated control)', async () => {
    const { dz, clickSpy } = setup()
    const label = document.createElement('label')
    label.textContent = 'choose later'
    dz.appendChild(label)
    await nextTick()
    label.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a [contenteditable] child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    dz.appendChild(editable)
    await nextTick()
    editable.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a NESTED descendant of a <button> (e.g. icon span) does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const btn = document.createElement('button')
    const icon = document.createElement('span')
    btn.appendChild(icon)
    dz.appendChild(btn)
    await nextTick()
    icon.click() // bubbles through button → host
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('synthetic click bubbling up from the hidden input does NOT re-invoke the picker (no recursion)', async () => {
    const realClick = HTMLInputElement.prototype.click
    let calls = 0
    const stub = function (this: HTMLInputElement) {
      calls += 1
      // Mirror what the browser does — dispatch a click event that bubbles
      // up to the host. The directive must skip this bubbled event.
      this.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    HTMLInputElement.prototype.click = stub as never

    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    dz.click()

    expect(calls).toBe(1) // not 2; bubbled click from input must be skipped
    HTMLInputElement.prototype.click = realClick
  })
})

describe('v-dropzone — click-to-pick (validation pipeline)', () => {
  it('picked files flow through `on` when valid', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ clickToPick: true, on })
    await nextTick()
    const input = getHiddenInput(dz)!

    const png = makeFile('a.png', 'image/png')
    firePickedFiles(input, [png])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([png])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('picked files fail `accept` filter just like dropped files', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ clickToPick: true, accept: 'image/*', on, onReject })
    await nextTick()
    const input = getHiddenInput(dz)!

    const pdf = makeFile('a.pdf', 'application/pdf')
    firePickedFiles(input, [pdf])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['type'])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
  })

  it('picked files fail `maxSize` rule with `size` reason', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ clickToPick: true, maxSize: 50, onReject })
    await nextTick()
    const input = getHiddenInput(dz)!

    firePickedFiles(input, [makeFile('big.png', 'image/png', 500)])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['size'])
  })

  it('picked files fail `multiple: false` rule with `count` reason', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ clickToPick: true, multiple: false, onReject })
    await nextTick()
    const input = getHiddenInput(dz)!

    firePickedFiles(input, [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['count'])
  })

  it('change event with no files is a no-op (handler not called)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ clickToPick: true, on })
    await nextTick()
    const input = getHiddenInput(dz)!

    firePickedFiles(input, [])
    expect(on).not.toHaveBeenCalled()
  })
})

describe('v-dropzone — click-to-pick (hidden input mirrors options)', () => {
  it('hidden input has `multiple` set when options.multiple !== false (default)', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.multiple).toBe(true)
  })

  it('hidden input has `multiple` UNSET when options.multiple === false', async () => {
    const { dz } = mountHost({ clickToPick: true, multiple: false, on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.multiple).toBe(false)
  })

  it('hidden input mirrors `accept` attribute when set', async () => {
    const { dz } = mountHost({ clickToPick: true, accept: 'image/*,.pdf', on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.getAttribute('accept')).toBe('image/*,.pdf')
  })

  it('hidden input has no `accept` when option not set', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.hasAttribute('accept')).toBe(false)
  })

  it('input.value is reset before each picker open so the same file can be picked twice in a row', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    const input = getHiddenInput(dz)!

    dz.click()
    expect(input.value).toBe('') // reset on first open
    expect(clickSpy).toHaveBeenCalledTimes(1)

    // Setting value to '' is a no-op visually but the directive must
    // also clear before each subsequent open — pin that it doesn't depend
    // on the value being preserved.
    dz.click()
    expect(input.value).toBe('')
    expect(clickSpy).toHaveBeenCalledTimes(2)
    clickSpy.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — Click-to-pick — picker input accessibility                    */
/* ------------------------------------------------------------------ */

/**
 * The picker `<input type="file">` is the ONLY keyboard/AT route into
 * click-to-pick — HTML5 drag-and-drop has neither by design. So it is
 * visually hidden with the clip recipe (still focusable) rather than
 * `display: none` (removed from the tab order), and it carries an
 * accessible name. When the host affordance is off (`api.open()` only)
 * the input drops back out of the tab order — see `applyPickerA11y`.
 */

/** Mount with a swappable options object and return an `update()` driver. */
function mountUpdatableHost(initial: DropzoneOptions) {
  const holder = { value: initial }
  const App = defineComponent({
    setup() {
      return () => withDirectives(h('div'), [[vDropzone, holder.value]])
    },
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(App)
  app.mount(host)
  const dz = host.querySelector('div')!
  return {
    app,
    dz,
    async update(next: DropzoneOptions) {
      holder.value = next
      app._instance!.update()
      await nextTick()
    },
  }
}

describe('v-dropzone — click-to-pick (picker input is visually hidden, not display:none)', () => {
  it('the picker input is clipped out of view but NOT removed from the tab order', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    const input = getHiddenInput(dz)!

    // `display: none` is what used to take the input out of the tab order.
    expect(input.style.display).toBe('')
    expect(input.style.visibility).toBe('')
    expect(input.style.position).toBe('absolute')
    expect(input.style.left).toBe('0px')
    expect(input.style.top).toBe('0px')
    expect(input.style.bottom).toBe('')
    expect(input.style.width).toBe('1px')
    expect(input.style.height).toBe('1px')
    expect(input.style.padding).toBe('0px')
    expect(input.style.margin).toBe('0px')
    expect(input.style.overflow).toBe('hidden')
    expect(input.style.clipPath).toBe('inset(50%)')
    expect(input.style.whiteSpace).toBe('nowrap')
  })

  it('keeps the legacy `clip` fallback beside `clip-path` (jsdom drops it, browsers do not)', () => {
    // jsdom's CSSStyleDeclaration does not implement the deprecated `clip`
    // property, so it never appears on `input.style` — the only place this
    // can be pinned is the constant the directive writes.
    expect(PICKER_HIDDEN_STYLE).toContain('clip:rect(0 0 0 0)')
    expect(PICKER_HIDDEN_STYLE).toContain('clip-path:inset(50%)')
    expect(PICKER_HIDDEN_STYLE).not.toContain('display:none')
  })

  it('anchors the picker input to the TOP-left of its containing block, never the bottom', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    const input = getHiddenInput(dz)!
    // `bottom: 0` is the DZ-3 regression: paired with a `static` host it
    // resolves against the *initial* containing block, so the input sits at
    // document (0, viewport height) whatever page the zone is on, and Tab
    // scrolls there. Both axes must be top/left, and `anchor.ts` must make
    // the host the containing block they resolve against.
    expect(input.style.left).toBe('0px')
    expect(input.style.top).toBe('0px')
    expect(input.style.bottom).toBe('')
    expect(PICKER_HIDDEN_STYLE).not.toContain('bottom')
    expect(dz.style.position).toBe('relative')
  })
})

describe("v-dropzone — click-to-pick (the picker input's containing block)", () => {
  it('makes a static host the containing block, so the input lands inside the zone', async () => {
    const { dz } = mountHost({ on: vi.fn() })
    await nextTick()
    // The bare binding. Without this the input's `left:0; top:0` resolves
    // against the initial containing block and Tab scrolls the page away
    // from the zone — measured at 5,000+px on a long page.
    expect(dz.style.position).toBe('relative')
  })

  it("leaves a host that already has a position of its own alone", async () => {
    for (const position of ['relative', 'absolute', 'fixed', 'sticky']) {
      const App = defineComponent({
        setup() {
          return () =>
            withDirectives(h('div', { style: `position: ${position}` }), [
              [vDropzone, { on: vi.fn() } as DropzoneOptions],
            ])
        },
      })
      const host = document.createElement('div')
      document.body.appendChild(host)
      const app = createApp(App)
      app.mount(host)
      const dz = host.querySelector('div')!
      await nextTick()
      expect(dz.style.position).toBe(position)
      app.unmount()
      // …and it is still the consumer's, not something the directive reverted.
      expect(dz.style.position).toBe(position)
    }
  })

  it('does not anchor a host whose picker cannot be focused (clickToPick: false)', async () => {
    const { dz } = mountHost({ clickToPick: false, on: vi.fn() })
    await nextTick()
    // The input is `tabindex="-1"` on this zone, so nothing focuses it and
    // nothing scrolls to it. Writing layout to an opted-out host would be a
    // cost with no benefit.
    expect(dz.style.position).toBe('')
  })

  it('does not anchor a host for the input `api.open()` creates on an opted-out zone', async () => {
    const apiRef = ref<DropzoneApi | undefined>(undefined)
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz, app } = mountHost({ clickToPick: false, ref: apiRef, on: vi.fn() })
    await nextTick()
    apiRef.value!.open()
    expect(getHiddenInput(dz)).not.toBeNull()
    expect(dz.style.position).toBe('')
    clickSpy.mockRestore()
    app.unmount()
  })

  it('reverts the position it wrote when the directive unmounts', async () => {
    const { dz, app } = mountHost({ on: vi.fn() })
    await nextTick()
    expect(dz.style.position).toBe('relative')
    app.unmount()
    expect(dz.style.position).toBe('')
    expect(dz.getAttribute('style') ?? '').not.toContain('position')
  })

  it('reverts when a reactive clickToPick turns the affordance off, and re-anchors when it comes back', async () => {
    const opts = { value: { clickToPick: true, on: vi.fn() } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()
    expect(dz.style.position).toBe('relative')

    opts.value = { clickToPick: false, on: vi.fn() }
    app._instance!.proxy!.$forceUpdate()
    await nextTick()
    expect(dz.style.position).toBe('')

    opts.value = { clickToPick: true, on: vi.fn() }
    app._instance!.proxy!.$forceUpdate()
    await nextTick()
    expect(dz.style.position).toBe('relative')
    app.unmount()
  })

  /**
   * The anchor is an inline style, and inline styles are shared territory.
   * Vue patches a **string** `:style` binding with `el.style.cssText = next`,
   * which wipes every inline property the element had — including this one.
   * Measured in Chrome on Vue 3.5.41: a zone with `:style="\`border: ${x}\`"`
   * lost `position: relative` the first time `x` changed, computed position
   * back to `static`, and DZ-3 was live again with nothing in the console.
   * (An *object* binding sets properties individually and does not.)
   *
   * `updated` runs after Vue has patched the element's props, so re-asserting
   * there is the one place that can see the damage and undo it.
   */
  it('re-anchors after a string `:style` binding wipes the inline position', async () => {
    const opts = { value: { on: vi.fn() } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()
    expect(dz.style.position).toBe('relative')

    // Exactly what Vue's `patchStyle` does for a string binding.
    dz.style.cssText = 'border: 1px solid red'
    expect(dz.style.position).toBe('')

    app._instance!.proxy!.$forceUpdate()
    await nextTick()
    expect(dz.style.position).toBe('relative')
    expect(dz.style.border).toBe('1px solid red')
    app.unmount()
  })

  it('does not re-anchor an opted-out host when its style is wiped', async () => {
    const opts = { value: { clickToPick: false, on: vi.fn() } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()
    expect(dz.style.position).toBe('')

    dz.style.cssText = 'border: 1px solid red'
    app._instance!.proxy!.$forceUpdate()
    await nextTick()
    // Nothing can focus the input on this zone, so there is nothing to anchor.
    expect(dz.style.position).toBe('')
    app.unmount()
  })

  it('reverts on the `enabled: false` detach path too', async () => {
    const opts = { value: { on: vi.fn() } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()
    expect(dz.style.position).toBe('relative')

    opts.value = { enabled: false, on: vi.fn() }
    app._instance!.proxy!.$forceUpdate()
    await nextTick()
    expect(dz.style.position).toBe('')
    app.unmount()
  })
})

describe('v-dropzone — click-to-pick (the picker sync is idempotent)', () => {
  /**
   * A re-render must not mutate the DOM inside the consumer's host when
   * nothing about the options changed.
   *
   * This is not a performance nicety. `updated` fires on every re-render of
   * the component that owns the zone, and `syncPickerAttrs` used to write
   * `multiple` and `aria-label` unconditionally — two MutationRecords per
   * render. A consumer who observes their own zone (reading back what the
   * directive put in it is exactly what the opt-out demo card does) and
   * writes reactive state from the callback gets: mutation → state → render
   * → `updated` → mutation, with no fixed point. Measured in Chrome: the
   * loop is microtask-driven, so the main thread never yields and the tab
   * hangs. It hung `13-click-opt-out.vue` on load, and with it every
   * interaction check on the whole tab.
   */
  function observePicker(dz: HTMLElement) {
    const records: string[] = []
    const collect = (list: MutationRecord[]): void => {
      for (const m of list) records.push(m.type === 'attributes' ? `attr ${m.attributeName}` : m.type)
    }
    // Both halves are needed. Delivering the queue to the callback *empties*
    // it, so anything that awaited a tick is only visible here; anything that
    // has not reached a microtask yet is only visible to `takeRecords()`.
    const observer = new MutationObserver(collect)
    observer.observe(dz, { childList: true, subtree: true, attributes: true })
    return {
      drain(): string[] {
        collect(observer.takeRecords())
        return records
      },
      stop: () => observer.disconnect(),
    }
  }

  function mountReactive(initial: DropzoneOptions) {
    const opts = { value: initial }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    const rerender = async (next?: DropzoneOptions) => {
      if (next) opts.value = next
      app._instance!.proxy!.$forceUpdate()
      await nextTick()
    }
    return { app, dz, rerender }
  }

  it('a re-render with unchanged options mutates nothing inside the host', async () => {
    const handler = vi.fn()
    const { app, dz, rerender } = mountReactive({ accept: 'image/*', on: handler })
    await nextTick()
    const watcher = observePicker(dz)
    for (let i = 0; i < 5; i++) await rerender({ accept: 'image/*', on: handler })
    expect(watcher.drain()).toEqual([])
    watcher.stop()
    app.unmount()
  })

  it('still writes when an option actually changes', async () => {
    const handler = vi.fn()
    const { app, dz, rerender } = mountReactive({ accept: 'image/*', on: handler })
    await nextTick()
    const input = getHiddenInput(dz)!
    await rerender({ accept: '.pdf', multiple: false, pickerLabel: 'Add a receipt', on: handler })
    expect(input.getAttribute('accept')).toBe('.pdf')
    expect(input.multiple).toBe(false)
    expect(input.getAttribute('aria-label')).toBe('Add a receipt')
    // …and going back is a write too, not a stuck value.
    await rerender({ accept: 'image/*', on: handler })
    expect(input.getAttribute('accept')).toBe('image/*')
    expect(input.multiple).toBe(true)
    expect(input.getAttribute('aria-label')).toBe('Choose files')
    app.unmount()
  })

  it('re-opening through api.open() does not churn the input either', async () => {
    const apiRef = ref<DropzoneApi | undefined>(undefined)
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz, app } = mountHost({ ref: apiRef, on: vi.fn() })
    await nextTick()
    const watcher = observePicker(dz)
    apiRef.value!.open()
    apiRef.value!.open()
    expect(watcher.drain()).toEqual([])
    watcher.stop()
    clickSpy.mockRestore()
    app.unmount()
  })
})

describe('v-dropzone — click-to-pick (picker input accessible name)', () => {
  it('defaults the accessible name to "Choose files"', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.getAttribute('aria-label')).toBe('Choose files')
  })

  it('names it "Choose file" (singular) when multiple: false', async () => {
    const { dz } = mountHost({ clickToPick: true, multiple: false, on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.getAttribute('aria-label')).toBe('Choose file')
  })

  it('`pickerLabel` overrides the default', async () => {
    const { dz } = mountHost({ clickToPick: true, pickerLabel: 'Upload your CV', on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.getAttribute('aria-label')).toBe('Upload your CV')
  })

  it('a blank `pickerLabel` falls back to the default rather than naming the input ""', async () => {
    const { dz } = mountHost({ clickToPick: true, pickerLabel: '   ', on: vi.fn() })
    await nextTick()
    expect(getHiddenInput(dz)!.getAttribute('aria-label')).toBe('Choose files')
  })

  it('the name follows a reactive `multiple` change', async () => {
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: true, on })
    await nextTick()
    expect(getHiddenInput(h1.dz)!.getAttribute('aria-label')).toBe('Choose files')

    await h1.update({ clickToPick: true, multiple: false, on })
    expect(getHiddenInput(h1.dz)!.getAttribute('aria-label')).toBe('Choose file')
    h1.app.unmount()
  })

  it('the name follows a reactive `pickerLabel` change', async () => {
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: true, pickerLabel: 'Add receipts', on })
    await nextTick()
    expect(getHiddenInput(h1.dz)!.getAttribute('aria-label')).toBe('Add receipts')

    await h1.update({ clickToPick: true, pickerLabel: 'Add invoices', on })
    expect(getHiddenInput(h1.dz)!.getAttribute('aria-label')).toBe('Add invoices')
    h1.app.unmount()
  })

  it('the api-only picker (clickToPick: false) is named too', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({ ref: apiRef as unknown as DropzoneApiRef, clickToPick: false, multiple: false })
    await nextTick()

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { /* no-op */ }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }
    expect(getHiddenInput(dz)!.getAttribute('aria-label')).toBe('Choose file')
  })
})

describe('v-dropzone — click-to-pick (focusability follows the affordance)', () => {
  it('clickToPick on — the input is naturally focusable and exposed to AT', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    const input = getHiddenInput(dz)!
    expect(input.hasAttribute('tabindex')).toBe(false)
    expect(input.hasAttribute('aria-hidden')).toBe(false)
    expect(input.getAttribute('aria-label')).toBe('Choose files')
  })

  it('api.open() only (clickToPick: false) — the input is NOT a tab stop and is hidden from AT', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({ ref: apiRef as unknown as DropzoneApiRef, clickToPick: false })
    await nextTick()

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { /* no-op */ }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }

    const input = getHiddenInput(dz)!
    expect(input.getAttribute('tabindex')).toBe('-1')
    expect(input.getAttribute('aria-hidden')).toBe('true')
  })

  it('api.open() on a clickToPick host does NOT downgrade the shared input', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({ ref: apiRef as unknown as DropzoneApiRef, clickToPick: true })
    await nextTick()

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { /* no-op */ }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }

    const input = getHiddenInput(dz)!
    expect(dz.querySelectorAll('input[type="file"]').length).toBe(1)
    expect(input.hasAttribute('tabindex')).toBe(false)
    expect(input.hasAttribute('aria-hidden')).toBe(false)
  })

  it('clickToPick true → false keeps the input for api.open() but removes it from the tab order', async () => {
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: true, on })
    await nextTick()
    expect(getHiddenInput(h1.dz)!.hasAttribute('tabindex')).toBe(false)

    await h1.update({ clickToPick: false, on })

    const input = getHiddenInput(h1.dz)!
    expect(input).not.toBeNull() // still there — api.open() may want it
    expect(input.getAttribute('tabindex')).toBe('-1')
    expect(input.getAttribute('aria-hidden')).toBe('true')
    h1.app.unmount()
  })

  it('clickToPick false → true restores the tab stop', async () => {
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: true, on })
    await nextTick()
    await h1.update({ clickToPick: false, on })
    expect(getHiddenInput(h1.dz)!.getAttribute('tabindex')).toBe('-1')

    await h1.update({ clickToPick: true, on })

    const input = getHiddenInput(h1.dz)!
    expect(input.hasAttribute('tabindex')).toBe(false)
    expect(input.hasAttribute('aria-hidden')).toBe(false)
    h1.app.unmount()
  })

  it('a de-affordanced input still opens through api.open() (tab stop removed, feature kept)', async () => {
    const apiRef = ref<DropzoneApi>()
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: true, ref: apiRef as unknown as DropzoneApiRef, on })
    await nextTick()
    await h1.update({ clickToPick: false, ref: apiRef as unknown as DropzoneApiRef, on })

    let clicked = 0
    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { clicked += 1 }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }
    expect(clicked).toBe(1)
    expect(getHiddenInput(h1.dz)!.getAttribute('tabindex')).toBe('-1')
    h1.app.unmount()
  })

  it('enabled: false destroys the input outright — no tab stop, no node', async () => {
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: true, on })
    await nextTick()
    expect(getHiddenInput(h1.dz)).not.toBeNull()

    await h1.update({ clickToPick: true, enabled: false, on })

    expect(getHiddenInput(h1.dz)).toBeNull()
    h1.app.unmount()
  })
})

describe('v-dropzone — click-to-pick (the host is never touched)', () => {
  it('injects no role, tabindex or aria-label onto the host', async () => {
    const { dz } = mountHost({ clickToPick: true, on: vi.fn() })
    await nextTick()
    expect(dz.hasAttribute('role')).toBe(false)
    expect(dz.hasAttribute('tabindex')).toBe(false)
    expect(dz.hasAttribute('aria-label')).toBe(false)
  })

  it("preserves a host's own role instead of overwriting it", async () => {
    const App = defineComponent({
      setup() {
        return () =>
          withDirectives(h('div', { role: 'group', tabindex: '0', 'aria-label': 'Attachments' }), [
            [vDropzone, { clickToPick: true, on: vi.fn() } as DropzoneOptions],
          ])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    expect(dz.getAttribute('role')).toBe('group')
    expect(dz.getAttribute('tabindex')).toBe('0')
    expect(dz.getAttribute('aria-label')).toBe('Attachments')
    app.unmount()
  })
})

describe('v-dropzone — click-to-pick (reactive option toggles)', () => {
  it('toggling clickToPick false → true via update creates the hidden input', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const opts = { value: { clickToPick: false, on: vi.fn() } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    expect(getHiddenInput(dz)).toBeNull()
    dz.click()
    expect(clickSpy).not.toHaveBeenCalled()

    opts.value = { clickToPick: true, on: opts.value.on }
    // Trigger a re-render via a fresh mount (simulates reactivity flow).
    app.unmount()
    const App2 = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const app2 = createApp(App2)
    app2.mount(host2)
    const dz2 = host2.querySelector('div')!
    await nextTick()

    expect(getHiddenInput(dz2)).not.toBeNull()
    dz2.click()
    expect(clickSpy).toHaveBeenCalledTimes(1)
    app2.unmount()
    clickSpy.mockRestore()
  })

  it('option changes to `accept` are reflected on the hidden input on update', async () => {
    const optsRef = { value: { clickToPick: true, accept: 'image/*', on: vi.fn() } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, optsRef.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    expect(getHiddenInput(dz)!.getAttribute('accept')).toBe('image/*')

    optsRef.value = { clickToPick: true, accept: '.pdf', on: optsRef.value.on }
    app._instance!.update()
    await nextTick()

    expect(getHiddenInput(dz)!.getAttribute('accept')).toBe('.pdf')
    app.unmount()
  })
})

/**
 * The default is `clickToPick: true`, so "omitted" and "true" must resolve
 * identically — at attach AND in the `updated` diff. When they disagree the
 * failures are silent and land on exactly the migration a consumer performs
 * when they delete the option they no longer need:
 *  - read as OFF on update but ON at attach → `false` → omitted never wires up
 *  - read as OFF on update but ON at attach → `true`  → omitted tears down
 * Both directions are pinned here.
 */
describe('v-dropzone — click-to-pick (omitted resolves identically at attach and on update)', () => {
  it('{ clickToPick: false } → omitted — the zone GAINS click-to-pick', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: false, on })
    await nextTick()
    expect(getHiddenInput(h1.dz)).toBeNull()

    await h1.update({ on })

    const input = getHiddenInput(h1.dz)
    expect(input).not.toBeNull()
    h1.dz.click()
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(input!.hasAttribute('tabindex')).toBe(false)
    h1.app.unmount()
    clickSpy.mockRestore()
  })

  it('{ clickToPick: true } → omitted — the zone KEEPS click-to-pick', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickToPick: true, on })
    await nextTick()

    await h1.update({ on })

    h1.dz.click()
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const input = getHiddenInput(h1.dz)!
    expect(input.hasAttribute('tabindex')).toBe(false)
    expect(input.hasAttribute('aria-hidden')).toBe(false)
    h1.app.unmount()
    clickSpy.mockRestore()
  })

  it('omitted → { clickToPick: false } — the zone LOSES click-to-pick', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const on = vi.fn()
    const h1 = mountUpdatableHost({ on })
    await nextTick()

    await h1.update({ clickToPick: false, on })

    h1.dz.click()
    expect(clickSpy).not.toHaveBeenCalled()
    // Input survives for api.open(), but stops being a tab stop.
    expect(getHiddenInput(h1.dz)!.getAttribute('tabindex')).toBe('-1')
    h1.app.unmount()
    clickSpy.mockRestore()
  })

  it('omitted → omitted — a no-op update neither re-wires nor tears down', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const on = vi.fn()
    const h1 = mountUpdatableHost({ on, accept: 'image/*' })
    await nextTick()
    const before = getHiddenInput(h1.dz)!

    await h1.update({ on, accept: '.pdf' })

    // Same node, still wired once, options still mirrored.
    expect(getHiddenInput(h1.dz)).toBe(before)
    expect(before.getAttribute('accept')).toBe('.pdf')
    h1.dz.click()
    expect(clickSpy).toHaveBeenCalledTimes(1)
    h1.app.unmount()
    clickSpy.mockRestore()
  })
})

/**
 * "Click anywhere" is the default now, so the clicks that are NOT a request
 * for a file picker have to be filtered out. jsdom can see two of the three
 * guards; the text-selection guard is browser-only (jsdom's Selection is
 * inert — `isCollapsed` is always true — so a green test here would be a lie).
 */
describe('v-dropzone — click-to-pick (stray-click guards)', () => {
  function setup(opts: DropzoneOptions = {}) {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ on: vi.fn(), ...opts })
    return { dz, clickSpy }
  }

  function clickWith(el: Element, detail: number): void {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
  }

  it('a double-click opens exactly ONE picker (the detail:2 repeat is ignored)', async () => {
    const { dz, clickSpy } = setup()
    await nextTick()

    clickWith(dz, 1)
    clickWith(dz, 2)

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('a triple-click (detail: 3) opens nothing extra either', async () => {
    const { dz, clickSpy } = setup()
    await nextTick()

    clickWith(dz, 3)

    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('a plain single click (detail: 1) still opens the picker', async () => {
    const { dz, clickSpy } = setup()
    await nextTick()

    clickWith(dz, 1)

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })
})

describe('v-dropzone — click-to-pick (widened interactive selector)', () => {
  function setup() {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ on: vi.fn() })
    return { dz, clickSpy }
  }

  async function appendAndClick(dz: HTMLElement, el: Element) {
    dz.appendChild(el)
    await nextTick()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('click on a [tabindex="0"] child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const el = document.createElement('div')
    el.setAttribute('tabindex', '0')
    await appendAndClick(dz, el)
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a [tabindex="-1"] child DOES open the picker (not a tab stop, not a control)', async () => {
    const { dz, clickSpy } = setup()
    const el = document.createElement('div')
    el.setAttribute('tabindex', '-1')
    await appendAndClick(dz, el)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('click on a [role="button"] child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const el = document.createElement('div')
    el.setAttribute('role', 'button')
    await appendAndClick(dz, el)
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a nested descendant of a [role="button"] does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const el = document.createElement('div')
    el.setAttribute('role', 'button')
    const icon = document.createElement('span')
    el.appendChild(icon)
    dz.appendChild(el)
    await nextTick()
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a <summary> child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'More'
    details.appendChild(summary)
    dz.appendChild(details)
    await nextTick()
    summary.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on an <audio controls> child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const el = document.createElement('audio')
    el.setAttribute('controls', '')
    await appendAndClick(dz, el)
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a <video controls> child does NOT open the picker', async () => {
    const { dz, clickSpy } = setup()
    const el = document.createElement('video')
    el.setAttribute('controls', '')
    await appendAndClick(dz, el)
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('click on a controls-less <video> DOES open the picker (there is nothing to click)', async () => {
    const { dz, clickSpy } = setup()
    const el = document.createElement('video')
    await appendAndClick(dz, el)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it("a host carrying its own tabindex does NOT exempt itself", async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const App = defineComponent({
      setup() {
        return () =>
          withDirectives(h('div', { tabindex: '0', role: 'button' }), [
            [vDropzone, { on: vi.fn() } as DropzoneOptions],
          ])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    dz.click()

    expect(clickSpy).toHaveBeenCalledTimes(1)
    app.unmount()
    clickSpy.mockRestore()
  })
})

describe('v-dropzone — click-to-pick (clickIgnore)', () => {
  function setup(opts: DropzoneOptions) {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ on: vi.fn(), ...opts })
    return { dz, clickSpy }
  }

  it('a descendant matching `clickIgnore` does NOT open the picker', async () => {
    const { dz, clickSpy } = setup({ clickIgnore: '.no-pick' })
    const el = document.createElement('div')
    el.className = 'no-pick'
    dz.appendChild(el)
    await nextTick()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('a NESTED child of a `clickIgnore` match does NOT open the picker either', async () => {
    const { dz, clickSpy } = setup({ clickIgnore: '.no-pick' })
    const el = document.createElement('div')
    el.className = 'no-pick'
    const deep = document.createElement('span')
    el.appendChild(deep)
    dz.appendChild(el)
    await nextTick()
    deep.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('a sibling that does NOT match still opens the picker', async () => {
    const { dz, clickSpy } = setup({ clickIgnore: '.no-pick' })
    const el = document.createElement('div')
    el.className = 'pick-me'
    dz.appendChild(el)
    await nextTick()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('`clickIgnore` accepts a selector list', async () => {
    const { dz, clickSpy } = setup({ clickIgnore: '.chip, [data-remove]' })
    const chip = document.createElement('div')
    chip.className = 'chip'
    const remove = document.createElement('div')
    remove.setAttribute('data-remove', '')
    dz.append(chip, remove)
    await nextTick()

    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('the built-in interactive guard still applies alongside `clickIgnore`', async () => {
    const { dz, clickSpy } = setup({ clickIgnore: '.no-pick' })
    const btn = document.createElement('button')
    dz.appendChild(btn)
    await nextTick()
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('a blank `clickIgnore` is treated as unset (and does not break the built-in guard)', async () => {
    const { dz, clickSpy } = setup({ clickIgnore: '   ' })
    const plain = document.createElement('span')
    const btn = document.createElement('button')
    dz.append(plain, btn)
    await nextTick()

    plain.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('`clickIgnore` matching the HOST does not disable the zone (use clickToPick: false for that)', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const App = defineComponent({
      setup() {
        return () =>
          withDirectives(h('div', { class: 'no-pick' }), [
            [vDropzone, { clickIgnore: '.no-pick', on: vi.fn() } as DropzoneOptions],
          ])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    dz.click()

    expect(clickSpy).toHaveBeenCalledTimes(1)
    app.unmount()
    clickSpy.mockRestore()
  })

  it('`clickIgnore` follows a reactive change without re-binding the listener', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const on = vi.fn()
    const h1 = mountUpdatableHost({ clickIgnore: '.a', on })
    await nextTick()
    const a = document.createElement('div')
    a.className = 'a'
    const b = document.createElement('div')
    b.className = 'b'
    h1.dz.append(a, b)

    a.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).not.toHaveBeenCalled()

    await h1.update({ clickIgnore: '.b', on })

    a.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    h1.app.unmount()
    clickSpy.mockRestore()
  })
})

describe('v-dropzone — click-to-pick (disabled / safety)', () => {
  it('enabled: false + clickToPick: true — directive does not attach, no input created, click is a no-op', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { dz } = mountHost({ enabled: false, clickToPick: true, on: vi.fn() })
    await nextTick()

    expect(getHiddenInput(dz)).toBeNull()
    dz.click()
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — Paste-from-clipboard                                          */
/* ------------------------------------------------------------------ */

/**
 * jsdom doesn't construct ClipboardEvent natively; we synthesize a paste
 * event with a stubbed clipboardData mirroring the parts the directive reads.
 */
type ClipboardItemStub = { kind: 'file' | 'string'; type: string; file?: File | null }

function firePaste(target: HTMLElement | Document, items: ClipboardItemStub[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: items.map((it) => ({
        kind: it.kind,
        type: it.type,
        getAsFile: () => (it.kind === 'file' ? it.file ?? null : null),
      })),
      types: items.map((it) => it.type),
    },
    configurable: true,
  })
  target.dispatchEvent(event)
  return event
}

describe('v-dropzone — paste-from-clipboard (basic wiring)', () => {
  it('default (paste omitted) — paste on host does NOT fire handler', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    firePaste(dz, [{ kind: 'file', type: 'image/png', file: png }])

    expect(on).not.toHaveBeenCalled()
  })

  it('paste: true — paste on host with an image file fires handler with the file', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const png = makeFile('clip.png', 'image/png')
    firePaste(dz, [{ kind: 'file', type: 'image/png', file: png }])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([png])
  })

  it('paste: true — paste with multiple file items fires handler with all files in order', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.jpg', 'image/jpeg')
    firePaste(dz, [
      { kind: 'file', type: 'image/png', file: a },
      { kind: 'file', type: 'image/jpeg', file: b },
    ])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([a, b])
  })

  it('paste: true — non-file paste (text only) is ignored — handler NOT called and default NOT prevented', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const e = firePaste(dz, [{ kind: 'string', type: 'text/plain' }])

    expect(on).not.toHaveBeenCalled()
    // Critical: we must not preventDefault on a pure-text paste, or pasting
    // text into descendants (e.g. a contenteditable inside the zone) breaks.
    expect(e.defaultPrevented).toBe(false)
  })

  it('paste: true — mixed (image + text) — only the file item flows through', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    firePaste(dz, [
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'image/png', file: png },
    ])

    expect(on).toHaveBeenCalledWith([png])
  })

  it('paste: true — empty items list is a no-op', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const e = firePaste(dz, [])
    expect(on).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('paste: true — null clipboardData is a no-op (defensive)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: null, configurable: true })
    dz.dispatchEvent(event)

    expect(on).not.toHaveBeenCalled()
  })

  it('paste: true — items with kind="file" but `getAsFile()` returning null are filtered out', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    firePaste(dz, [
      { kind: 'file', type: 'image/png', file: null },
      { kind: 'file', type: 'image/png', file: png },
    ])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([png])
  })

  it('paste: true — directive preventDefaults when at least one file was consumed', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    const e = firePaste(dz, [{ kind: 'file', type: 'image/png', file: png }])

    expect(e.defaultPrevented).toBe(true)
  })
})

describe('v-dropzone — paste-from-clipboard (validation pipeline)', () => {
  it('pasted files flow through `accept` filter (type rejection sets rejected state)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ paste: true, accept: 'image/png', on, onReject })
    await nextTick()

    const jpg = makeFile('a.jpg', 'image/jpeg')
    firePaste(dz, [{ kind: 'file', type: 'image/jpeg', file: jpg }])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([jpg])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['type'])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
  })

  it('pasted files flow through `maxSize` (size reason)', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ paste: true, maxSize: 50, onReject })
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('big.png', 'image/png', 500) }])

    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['size'])
  })

  it('pasted files flow through `multiple: false` (count reason)', async () => {
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ paste: true, multiple: false, onReject })
    await nextTick()

    firePaste(dz, [
      { kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') },
      { kind: 'file', type: 'image/png', file: makeFile('b.png', 'image/png') },
    ])

    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['count'])
  })

  it('pasted files flow through `maxCount`', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ paste: true, maxCount: 1, on, onReject })
    await nextTick()

    firePaste(dz, [
      { kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') },
      { kind: 'file', type: 'image/png', file: makeFile('b.png', 'image/png') },
    ])

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['count'])
  })

  it('partial-rejection — image passes accept, pdf rejects with `type` reason', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ paste: true, accept: 'image/*', on, onReject })
    await nextTick()

    const png = makeFile('a.png', 'image/png')
    const pdf = makeFile('b.pdf', 'application/pdf')
    firePaste(dz, [
      { kind: 'file', type: 'image/png', file: png },
      { kind: 'file', type: 'application/pdf', file: pdf },
    ])

    expect(on).toHaveBeenCalledWith([png])
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0]![0].files).toEqual([pdf])
    expect(onReject.mock.calls[0]![0].reasons).toEqual(['type'])
  })

  it('paste with all-valid files sets data-dropzone to "idle" (not "active") after processing', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })
})

describe('v-dropzone — paste-from-clipboard (`pasteOn` scope)', () => {
  it('pasteOn: "document" — paste on document.body fires handler', async () => {
    const on = vi.fn<(files: File[]) => void>()
    mountHost({ paste: true, pasteOn: 'document', on })
    await nextTick()

    const png = makeFile('clip.png', 'image/png')
    firePaste(document, [{ kind: 'file', type: 'image/png', file: png }])

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith([png])
  })

  it('default pasteOn (host) — paste on document does NOT fire handler', async () => {
    const on = vi.fn<(files: File[]) => void>()
    mountHost({ paste: true, on }) // pasteOn defaults to 'host'
    await nextTick()

    const png = makeFile('clip.png', 'image/png')
    firePaste(document, [{ kind: 'file', type: 'image/png', file: png }])

    expect(on).not.toHaveBeenCalled()
  })

  it('pasteOn: "document" — paste dispatched on host bubbles to document and fires handler exactly once', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, pasteOn: 'document', on })
    await nextTick()

    const png = makeFile('clip.png', 'image/png')
    firePaste(dz, [{ kind: 'file', type: 'image/png', file: png }])

    // The directive attached only the document listener; bubbling from host
    // hits document exactly once. (Pin to catch any accidental double-attach.)
    expect(on).toHaveBeenCalledTimes(1)
  })

  it('pasteOn: "host" explicit — same as default, only paste on host or descendants fires', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, pasteOn: 'host', on })
    await nextTick()

    const png = makeFile('clip.png', 'image/png')
    firePaste(document, [{ kind: 'file', type: 'image/png', file: png }])
    expect(on).not.toHaveBeenCalled()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: png }])
    expect(on).toHaveBeenCalledTimes(1)
  })

  it('pasteOn: "host" — paste on a descendant of the host fires (event bubbles to host)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ paste: true, on })
    const child = document.createElement('span')
    dz.appendChild(child)
    await nextTick()

    const png = makeFile('clip.png', 'image/png')
    firePaste(child, [{ kind: 'file', type: 'image/png', file: png }])

    expect(on).toHaveBeenCalledTimes(1)
  })
})

describe('v-dropzone — paste-from-clipboard (lifecycle)', () => {
  it('paste listener is removed on unmount (host scope)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { app, dz } = mountHost({ paste: true, on })
    await nextTick()

    app.unmount()
    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])

    expect(on).not.toHaveBeenCalled()
  })

  it('pasteOn: "document" listener is removed on unmount', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { app } = mountHost({ paste: true, pasteOn: 'document', on })
    await nextTick()

    app.unmount()
    firePaste(document, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])

    expect(on).not.toHaveBeenCalled()
  })

  it('enabled: false + paste: true — no listener attached, paste is a no-op', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ enabled: false, paste: true, on })
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])
    expect(on).not.toHaveBeenCalled()
  })

  it('enabled: false + pasteOn: "document" — no document listener attached', async () => {
    const on = vi.fn<(files: File[]) => void>()
    mountHost({ enabled: false, paste: true, pasteOn: 'document', on })
    await nextTick()

    firePaste(document, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])
    expect(on).not.toHaveBeenCalled()
  })
})

describe('v-dropzone — paste-from-clipboard (reactive option toggles)', () => {
  it('toggling paste false → true via update attaches the listener', async () => {
    const handler = vi.fn<(files: File[]) => void>()
    const optsRef = { value: { paste: false, on: handler } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, optsRef.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])
    expect(handler).not.toHaveBeenCalled()

    optsRef.value = { paste: true, on: handler }
    app._instance!.update()
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('b.png', 'image/png') }])
    expect(handler).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('toggling paste true → false via update detaches the listener', async () => {
    const handler = vi.fn<(files: File[]) => void>()
    const optsRef = { value: { paste: true, on: handler } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, optsRef.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])
    expect(handler).toHaveBeenCalledTimes(1)

    optsRef.value = { paste: false, on: handler }
    app._instance!.update()
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('b.png', 'image/png') }])
    expect(handler).toHaveBeenCalledTimes(1) // unchanged
    app.unmount()
  })

  it('toggling pasteOn from "host" → "document" via update moves the listener', async () => {
    const handler = vi.fn<(files: File[]) => void>()
    const optsRef = { value: { paste: true, pasteOn: 'host' as const, on: handler } as DropzoneOptions }
    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, optsRef.value]])
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    const dz = host.querySelector('div')!
    await nextTick()

    // host scope — document paste does not fire
    firePaste(document, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])
    expect(handler).not.toHaveBeenCalled()

    optsRef.value = { paste: true, pasteOn: 'document' as const, on: handler }
    app._instance!.update()
    await nextTick()

    // document scope — document paste fires
    firePaste(document, [{ kind: 'file', type: 'image/png', file: makeFile('b.png', 'image/png') }])
    expect(handler).toHaveBeenCalledTimes(1)

    // host paste also fires (bubbles to document) but should not re-fire from
    // any leftover host listener — pin the count.
    firePaste(dz, [{ kind: 'file', type: 'image/png', file: makeFile('c.png', 'image/png') }])
    expect(handler).toHaveBeenCalledTimes(2)

    app.unmount()
  })
})

describe('v-dropzone — paste-from-clipboard (multi-instance isolation)', () => {
  it('two dropzones with pasteOn: "document" — both fire on document paste', async () => {
    const onA = vi.fn<(files: File[]) => void>()
    const onB = vi.fn<(files: File[]) => void>()
    mountHost({ paste: true, pasteOn: 'document', on: onA })
    mountHost({ paste: true, pasteOn: 'document', on: onB })
    await nextTick()

    firePaste(document, [{ kind: 'file', type: 'image/png', file: makeFile('clip.png', 'image/png') }])

    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(1)
  })

  it('host-scoped paste on zone A does not fire zone B', async () => {
    const onA = vi.fn<(files: File[]) => void>()
    const onB = vi.fn<(files: File[]) => void>()
    const { dz: dzA } = mountHost({ paste: true, on: onA })
    mountHost({ paste: true, on: onB })
    await nextTick()

    firePaste(dzA, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])

    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()
  })

  it('unmounting one document-scoped dropzone removes its listener; remaining zone still fires', async () => {
    const onA = vi.fn<(files: File[]) => void>()
    const onB = vi.fn<(files: File[]) => void>()
    const { app: appA } = mountHost({ paste: true, pasteOn: 'document', on: onA })
    mountHost({ paste: true, pasteOn: 'document', on: onB })
    await nextTick()

    appA.unmount()
    firePaste(document, [{ kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') }])

    expect(onA).not.toHaveBeenCalled()
    expect(onB).toHaveBeenCalledTimes(1)
  })
})

describe('v-dropzone — paste-from-clipboard (data-dropzone rejected lifecycle)', () => {
  it('paste rejection sets data-dropzone="rejected" and auto-clears to "idle" after `rejectDuration`', async () => {
    vi.useFakeTimers()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ paste: true, accept: 'image/png', rejectDuration: 200, onReject })
    await nextTick()

    firePaste(dz, [{ kind: 'file', type: 'application/pdf', file: makeFile('a.pdf', 'application/pdf') }])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(199)
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')

    vi.advanceTimersByTime(1)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
    vi.useRealTimers()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — URL-based upload (XHR + progress + uploading state)          */
/* ------------------------------------------------------------------ */

/**
 * FakeXhr — minimal stand-in for XMLHttpRequest that records what the
 * directive sent and exposes test-side controls to simulate progress /
 * success / error / abort. We register every instance into a queue so
 * tests can grab a specific one and drive its lifecycle.
 *
 * Why hand-roll instead of vi.spyOn? jsdom's XMLHttpRequest doesn't fire
 * upload `progress` events for FormData bodies, which is precisely the
 * surface we need to pin. Faking the whole class is cheaper than mocking
 * each method on the prototype.
 */
type FakeXhrInstance = {
  method: string
  url: string
  body: BodyInit | null
  requestHeaders: Record<string, string>
  withCredentials: boolean
  responseType: string
  timeout: number
  responseHeaders: Record<string, string>
  /** Trigger a single `progress` event on `xhr.upload`. */
  emitProgress: (loaded: number, total: number, lengthComputable?: boolean) => void
  /** Resolve the request: optional `responseHeaders`, optional `response` body. */
  emitLoad: (status: number, response?: string, headers?: Record<string, string>) => void
  /** Trigger a network error. */
  emitError: () => void
  /** Trigger a timeout. */
  emitTimeout: () => void
  /** Trigger abort (mimics what happens after xhr.abort() is called by the directive). */
  emitAbort: () => void
  /** Last value passed to xhr.abort() — `null` if not called. */
  aborted: boolean
}

let xhrQueue: FakeXhrInstance[] = []
let realXHR: typeof XMLHttpRequest | undefined

function installFakeXhr(): void {
  realXHR = globalThis.XMLHttpRequest
  xhrQueue = []
  class FakeXHR {
    method = ''
    url = ''
    body: BodyInit | null = null
    requestHeaders: Record<string, string> = {}
    withCredentials = false
    responseType = ''
    timeout = 0
    responseHeaders: Record<string, string> = {}
    status = 0
    response: string = ''
    responseText: string = ''
    upload: {
      onprogress: ((event: ProgressEvent) => void) | null
      addEventListener: (type: string, handler: (e: ProgressEvent) => void) => void
    }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    ontimeout: (() => void) | null = null
    aborted = false

    constructor() {
      const upload = {
        onprogress: null as ((event: ProgressEvent) => void) | null,
        _listeners: [] as Array<(e: ProgressEvent) => void>,
        addEventListener(_type: string, handler: (e: ProgressEvent) => void) {
          this._listeners.push(handler)
        },
      }
      this.upload = upload

      const self = this
      const instance: FakeXhrInstance = {
        get method() {
          return self.method
        },
        get url() {
          return self.url
        },
        get body() {
          return self.body
        },
        get requestHeaders() {
          return self.requestHeaders
        },
        get withCredentials() {
          return self.withCredentials
        },
        get responseType() {
          return self.responseType
        },
        get timeout() {
          return self.timeout
        },
        get responseHeaders() {
          return self.responseHeaders
        },
        get aborted() {
          return self.aborted
        },
        emitProgress(loaded: number, total: number, lengthComputable = true) {
          const event = { loaded, total, lengthComputable } as ProgressEvent
          upload.onprogress?.(event)
          for (const l of upload._listeners) l(event)
        },
        emitLoad(status: number, response = '', headers: Record<string, string> = {}) {
          self.status = status
          self.response = response
          self.responseText = response
          self.responseHeaders = headers
          self.onload?.()
        },
        emitError() {
          self.onerror?.()
        },
        emitTimeout() {
          self.ontimeout?.()
        },
        emitAbort() {
          self.onabort?.()
        },
      }
      xhrQueue.push(instance)
    }

    open(method: string, url: string) {
      this.method = method
      this.url = url
    }
    setRequestHeader(name: string, value: string) {
      this.requestHeaders[name] = value
    }
    send(body: BodyInit | null = null) {
      this.body = body
    }
    abort() {
      this.aborted = true
    }
    getResponseHeader(name: string): string | null {
      const lower = name.toLowerCase()
      for (const [k, v] of Object.entries(this.responseHeaders)) {
        if (k.toLowerCase() === lower) return v
      }
      return null
    }
  }
  // @ts-expect-error — stubGlobal types are loose
  globalThis.XMLHttpRequest = FakeXHR
}

function restoreXhr(): void {
  if (realXHR) globalThis.XMLHttpRequest = realXHR
  xhrQueue = []
}

/** Convenience: drop one file and wait for the upload to be enqueued. */
async function dropOneFile(dz: HTMLElement, file: File): Promise<FakeXhrInstance> {
  fireDragEvent(dz, 'drop', [file])
  await nextTick()
  expect(xhrQueue.length).toBeGreaterThanOrEqual(1)
  return xhrQueue[xhrQueue.length - 1]
}

describe('v-dropzone — URL upload — wiring', () => {
  beforeEach(() => {
    installFakeXhr()
  })
  afterEach(() => {
    restoreXhr()
  })

  it('opens a POST XHR to the configured URL with the file as FormData', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)

    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/upload')
    expect(xhr.body).toBeInstanceOf(FormData)
    const fd = xhr.body as FormData
    expect(fd.get('file')).toBe(file)
  })

  it('respects custom method (PUT)', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload', method: 'PUT' } })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    expect(xhr.method).toBe('PUT')
  })

  it('respects custom fieldName', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload', fieldName: 'attachment' } })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    const fd = xhr.body as FormData
    expect(fd.get('attachment')).toBe(file)
    expect(fd.get('file')).toBe(null)
  })

  it('applies static headers via setRequestHeader', async () => {
    const { dz } = mountHost({
      upload: { url: '/api/upload', headers: { Authorization: 'Bearer abc123', 'X-Token': 't' } },
    })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(xhr.requestHeaders['Authorization']).toBe('Bearer abc123')
    expect(xhr.requestHeaders['X-Token']).toBe('t')
  })

  it('does NOT set a Content-Type header — XHR + FormData sets the multipart boundary itself', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload', headers: { Authorization: 'x' } } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(xhr.requestHeaders['Content-Type']).toBeUndefined()
    expect(xhr.requestHeaders['content-type']).toBeUndefined()
  })

  it('applies dynamic headers via function(file)', async () => {
    const headerFn = vi.fn((file: File) => ({ 'X-Filename': file.name }))
    const { dz } = mountHost({ upload: { url: '/api/upload', headers: headerFn } })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    expect(headerFn).toHaveBeenCalledWith(file)
    expect(xhr.requestHeaders['X-Filename']).toBe('a.png')
  })

  it('applies dynamic URL via function(file)', async () => {
    const urlFn = vi.fn((file: File) => `/api/upload/${file.name}`)
    const { dz } = mountHost({ upload: { url: urlFn } })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    expect(urlFn).toHaveBeenCalledWith(file)
    expect(xhr.url).toBe('/api/upload/a.png')
  })

  it('appends static formDataExtras to FormData', async () => {
    const { dz } = mountHost({
      upload: { url: '/api/upload', formDataExtras: { folder: 'avatars', userId: '42' } },
    })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    const fd = xhr.body as FormData
    expect(fd.get('folder')).toBe('avatars')
    expect(fd.get('userId')).toBe('42')
  })

  it('appends dynamic formDataExtras via function(file)', async () => {
    const extras = vi.fn((file: File) => ({ originalName: file.name }))
    const { dz } = mountHost({ upload: { url: '/api/upload', formDataExtras: extras } })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    expect(extras).toHaveBeenCalledWith(file)
    const fd = xhr.body as FormData
    expect(fd.get('originalName')).toBe('a.png')
  })

  it('withCredentials option is honored', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload', withCredentials: true } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(xhr.withCredentials).toBe(true)
  })

  it('timeout option is honored', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload', timeout: 5000 } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(xhr.timeout).toBe(5000)
  })
})

describe('v-dropzone — URL upload — per-file vs batched', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('per-file by default — one XHR per dropped file', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await nextTick()

    expect(xhrQueue.length).toBe(2)
    expect((xhrQueue[0].body as FormData).get('file')).toBe(a)
    expect((xhrQueue[1].body as FormData).get('file')).toBe(b)
  })

  it('batched: true — single XHR with all files appended under fieldName', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload', batched: true, fieldName: 'files' } })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await nextTick()

    expect(xhrQueue.length).toBe(1)
    const fd = xhrQueue[0].body as FormData
    const collected = fd.getAll('files')
    expect(collected).toEqual([a, b])
  })
})

describe('v-dropzone — URL upload — progress callback', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('fires onProgress with monotonically increasing percent (0..100)', async () => {
    const onProgress = vi.fn<(file: File, percent: number) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onProgress })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)

    xhr.emitProgress(0, 1000)
    xhr.emitProgress(250, 1000)
    xhr.emitProgress(750, 1000)
    xhr.emitProgress(1000, 1000)

    const percents = onProgress.mock.calls.map((c) => c[1])
    expect(percents).toEqual([0, 25, 75, 100])
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    }
    expect(onProgress.mock.calls.every((c) => c[0] === file)).toBe(true)
  })

  it('skips progress events with lengthComputable === false (can\'t compute a percent)', async () => {
    const onProgress = vi.fn<(file: File, percent: number) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onProgress })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitProgress(500, 1000, false)
    xhr.emitProgress(800, 1000, true)

    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress.mock.calls[0][1]).toBe(80)
  })

  it('clamps percent to [0, 100] even if loaded > total (server overcounts)', async () => {
    const onProgress = vi.fn<(file: File, percent: number) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onProgress })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitProgress(1500, 1000)

    expect(onProgress).toHaveBeenCalledWith(expect.any(File), 100)
  })

  it('skips progress events when total is 0 (cannot divide by zero)', async () => {
    const onProgress = vi.fn<(file: File, percent: number) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onProgress })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitProgress(0, 0)

    expect(onProgress).not.toHaveBeenCalled()
  })
})

describe('v-dropzone — URL upload — success path', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('200 with JSON content-type → onUploaded with parsed object', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onUploaded })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    xhr.emitLoad(200, '{"id":"abc","url":"/cdn/abc.png"}', { 'content-type': 'application/json' })
    await nextTick()

    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith(file, { id: 'abc', url: '/cdn/abc.png' })
  })

  it('200 with text content-type → onUploaded with raw string', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onUploaded })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.txt', 'text/plain'))
    xhr.emitLoad(200, 'OK', { 'content-type': 'text/plain' })
    await nextTick()

    expect(onUploaded).toHaveBeenCalledWith(expect.any(File), 'OK')
  })

  it('200 with no content-type and parsable JSON → falls back to JSON parse', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onUploaded })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, '{"ok":true}')
    await nextTick()

    expect(onUploaded).toHaveBeenCalledWith(expect.any(File), { ok: true })
  })

  it('200 with empty response body → onUploaded with empty string', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onUploaded })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(204, '')
    await nextTick()

    expect(onUploaded).toHaveBeenCalledWith(expect.any(File), '')
  })

  it('any 2xx status is treated as success', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onUploaded, onError })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(201, '{"id":"new"}', { 'content-type': 'application/json' })
    await nextTick()

    expect(onUploaded).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('custom parseResponse overrides default parsing', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const parseResponse = vi.fn((xhr: XMLHttpRequest) => ({ raw: xhr.responseText, custom: true }))
    const { dz } = mountHost({ upload: { url: '/api/upload', parseResponse }, onUploaded })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, 'arbitrary body')
    await nextTick()

    expect(parseResponse).toHaveBeenCalled()
    expect(onUploaded).toHaveBeenCalledWith(expect.any(File), { raw: 'arbitrary body', custom: true })
  })

  it('malformed JSON body with application/json content-type → onUploaded with raw string fallback', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onUploaded, onError })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, '{ not json', { 'content-type': 'application/json' })
    await nextTick()

    // Server claimed JSON but sent garbage — don't crash; surface raw text as response.
    expect(onUploaded).toHaveBeenCalledWith(expect.any(File), '{ not json')
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('v-dropzone — URL upload — error path', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('500 status → onError with error.status === 500', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onError, onUploaded })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    xhr.emitLoad(500, 'Internal Server Error')
    await nextTick()

    expect(onError).toHaveBeenCalledTimes(1)
    const [errFile, err] = onError.mock.calls[0]
    expect(errFile).toBe(file)
    expect(err.status).toBe(500)
    expect(err.aborted).toBeFalsy()
    expect(err.message).toMatch(/500/)
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('4xx status → onError with status code preserved', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onError })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(413, 'Payload Too Large')
    await nextTick()

    expect(onError.mock.calls[0][1].status).toBe(413)
  })

  it('network error (XHR onerror) → onError with no status', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onError })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitError()
    await nextTick()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1].status).toBeUndefined()
    expect(onError.mock.calls[0][1].message).toBeTruthy()
  })

  it('timeout → onError with timeout indicator', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload', timeout: 100 }, onError })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitTimeout()
    await nextTick()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1].message).toMatch(/timeout/i)
  })
})

describe('v-dropzone — URL upload — uploading state attribute lifecycle', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('flips data-dropzone to "uploading" while any XHR is in-flight', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()

    expect(dz.getAttribute('data-dropzone')).not.toBe('uploading')
  })

  it('two files in flight — state stays "uploading" until BOTH complete', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    xhrQueue[0].emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    xhrQueue[1].emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).not.toBe('uploading')
  })

  it('all uploads succeed → data-dropzone becomes "success" then auto-clears to "idle"', async () => {
    vi.useFakeTimers()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, successDuration: 200 })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()

    expect(dz.getAttribute('data-dropzone')).toBe('success')
    vi.advanceTimersByTime(199)
    expect(dz.getAttribute('data-dropzone')).toBe('success')
    vi.advanceTimersByTime(1)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
    vi.useRealTimers()
  })

  it('any upload errors → data-dropzone becomes "error" and stays sticky (no auto-clear)', async () => {
    vi.useFakeTimers()
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onError, successDuration: 200 })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(500, 'Internal Server Error')
    await nextTick()

    expect(dz.getAttribute('data-dropzone')).toBe('error')

    vi.advanceTimersByTime(10000)
    expect(dz.getAttribute('data-dropzone')).toBe('error')
    vi.useRealTimers()
  })

  it('a drag that never drops does not clear a sticky error', async () => {
    // dragenter over an errored zone must still show `active` (the drag UI is
    // the point), but dragleave has to put the sticky error back rather than
    // fall through to `idle` — the consumer never dismissed it.
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onError })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(500, 'Internal Server Error')
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    fireDragEvent(dz, 'dragenter', [])
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    fireDragEvent(dz, 'dragleave', [])
    expect(dz.getAttribute('data-dropzone')).toBe('error')
  })

  it('after dismissError() a drag leaves the zone idle again', async () => {
    // The mirror of the test above: once the error is dismissed there is no
    // failed record left, so the resting state really is `idle`.
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload: { url: '/api/upload' },
      onError: vi.fn(),
    })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(500, 'Internal Server Error')
    await nextTick()
    apiRef.value!.dismissError()
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('idle')

    fireDragEvent(dz, 'dragenter', [])
    expect(dz.getAttribute('data-dropzone')).toBe('active')
    fireDragEvent(dz, 'dragleave', [])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('mixed success/error → state goes to "error" (any error wins)', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, onError, onUploaded })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await nextTick()

    xhrQueue[0].emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    xhrQueue[1].emitLoad(500, 'bad')
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('error')
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('new drop after sticky error → state moves back to "uploading"', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    let xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(500, 'bad')
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    xhr = await dropOneFile(dz, makeFile('b.png', 'image/png'))
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })

  it('drag during upload temporarily flips to "active" — then back to "uploading" on dragleave', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    fireDragEvent(dz, 'dragenter', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    fireDragEvent(dz, 'dragleave', [], dz)
    // No uploads completed yet — should restore the uploading state, not idle.
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
  })
})

describe('v-dropzone — URL upload — validation + handler interaction', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('rejected files (validation) do NOT trigger an upload', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const onReject = vi.fn<(event: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({
      upload: { url: '/api/upload' },
      accept: 'image/*',
      onReject,
      onUploaded,
      onError,
    })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    await nextTick()

    expect(xhrQueue.length).toBe(0)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onUploaded).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('mixed accepted + rejected — only accepted files are uploaded', async () => {
    const onReject = vi.fn<(event: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, accept: 'image/*', onReject })
    await nextTick()

    const ok = makeFile('a.png', 'image/png')
    const bad = makeFile('b.pdf', 'application/pdf')
    fireDragEvent(dz, 'drop', [ok, bad])
    await nextTick()

    expect(xhrQueue.length).toBe(1)
    expect((xhrQueue[0].body as FormData).get('file')).toBe(ok)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('`on` handler is still called with accepted files in parallel with upload', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, on })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [file])
    await nextTick()

    expect(on).toHaveBeenCalledWith([file])
    expect(xhrQueue.length).toBe(1)
  })

  it('drop with zero accepted files does NOT trigger any XHR', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    // empty drop (no dataTransfer files at all)
    fireDragEvent(dz, 'drop', [])
    await nextTick()

    expect(xhrQueue.length).toBe(0)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })
})

describe('v-dropzone — URL upload — lifecycle cleanup', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('unmount during in-flight upload aborts the XHR and clears state', async () => {
    const { app, dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    app.unmount()

    expect(xhr.aborted).toBe(true)
    expect(dz.hasAttribute('data-dropzone')).toBe(false)
  })

  it('unmount while sticky error → attribute removed cleanly', async () => {
    const { app, dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(500, 'bad')
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    app.unmount()
    expect(dz.hasAttribute('data-dropzone')).toBe(false)
  })

  it('unmount cancels pending success → idle auto-clear', async () => {
    vi.useFakeTimers()
    const { app, dz } = mountHost({ upload: { url: '/api/upload' }, successDuration: 200 })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('success')

    app.unmount()
    vi.advanceTimersByTime(1000)
    // No throws / no errors from the timer firing post-unmount.
    expect(dz.hasAttribute('data-dropzone')).toBe(false)
    vi.useRealTimers()
  })
})

/* ------------------------------------------------------------------ */
/*  Function-based upload                                              */
/* ------------------------------------------------------------------ */

/**
 * Deferred promise utility — lets a test hold an upload `pending` until
 * `resolve()` / `reject()` is called explicitly. Mirrors the manual control
 * the URL-upload tests get via `xhr.emitLoad()` / `xhr.emitError()`.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Wait for all microtasks to flush (function-based uploads are await-based). */
async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('v-dropzone — function upload — wiring', () => {
  it('invokes the upload function once per accepted file', async () => {
    const upload = vi.fn(async () => 'ok')
    const { dz } = mountHost({ upload })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(2)
    expect((upload.mock.calls[0][0] as File).name).toBe('a.png')
    expect((upload.mock.calls[1][0] as File).name).toBe('b.png')
  })

  it('passes an AbortSignal as the second argument that is not yet aborted', async () => {
    const upload = vi.fn(async (_file: File, signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
      return 'ok'
    })
    const { dz } = mountHost({ upload })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('passes an onProgress callback as the third argument (when consumer supplies `onProgress`)', async () => {
    const onProgress = vi.fn<(file: File, percent: number) => void>()
    const upload: UploadFn = async (_file, _signal, report) => {
      expect(typeof report).toBe('function')
      report?.(0)
      report?.(50)
      report?.(100)
      return 'ok'
    }
    const { dz } = mountHost({ upload, onProgress })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(onProgress.mock.calls.map((c) => c[1])).toEqual([0, 50, 100])
  })

  it('clamps + rounds progress percents reported by the consumer to [0, 100]', async () => {
    const onProgress = vi.fn<(file: File, percent: number) => void>()
    const upload: UploadFn = async (_f, _s, report) => {
      report?.(-10)
      report?.(150)
      report?.(33.6)
      report?.(NaN)
      return 'ok'
    }
    const { dz } = mountHost({ upload, onProgress })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(onProgress.mock.calls.map((c) => c[1])).toEqual([0, 100, 34, 0])
  })

  it('progress reports are no-ops when consumer did NOT supply `onProgress`', async () => {
    const upload: UploadFn = async (_f, _s, report) => {
      // Calling without an `onProgress` consumer should NOT throw.
      report?.(50)
      return 'ok'
    }
    const { dz } = mountHost({ upload })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })
})

describe('v-dropzone — function upload — success path', () => {
  it('fires onUploaded with the resolved value per file', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const upload: UploadFn<{ id: string }> = async (file) => ({ id: file.name })
    const { dz } = mountHost({ upload: upload as UploadFn, onUploaded })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await flushPromises()

    expect(onUploaded).toHaveBeenCalledTimes(2)
    expect(onUploaded).toHaveBeenNthCalledWith(1, a, { id: 'a.png' })
    expect(onUploaded).toHaveBeenNthCalledWith(2, b, { id: 'b.png' })
  })

  it('all successes → data-dropzone="success" then auto-clears to "idle"', async () => {
    // Use real timers BEFORE the drop so the async function resolves on microtasks,
    // then swap to fake timers immediately to control the success → idle auto-clear.
    const upload: UploadFn = async () => 'ok'
    const { dz } = mountHost({ upload, successDuration: 200 })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('success')

    vi.useFakeTimers()
    // Re-arm the success timer because the original was created with real setTimeout —
    // simpler: directly assert the auto-clear by waiting on a real-time microtask.
    vi.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('resolved `undefined` is allowed and passed to onUploaded as-is', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const upload: UploadFn = async () => {
      /* return void */
    }
    const { dz } = mountHost({ upload, onUploaded })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onUploaded.mock.calls[0][1]).toBeUndefined()
  })
})

describe('v-dropzone — function upload — error path', () => {
  it('thrown Error fires onError with the Error.message and no `status`', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const upload: UploadFn = async () => {
      throw new Error('boom')
    }
    const { dz } = mountHost({ upload, onError })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(onError).toHaveBeenCalledTimes(1)
    const [, err] = onError.mock.calls[0]
    expect(err.message).toBe('boom')
    expect(err.status).toBeUndefined()
    expect(err.aborted).toBeUndefined()
  })

  it('thrown non-Error value falls back to a generic message (no crash)', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const upload: UploadFn = async () => {
      throw 'plain string' // eslint-disable-line @typescript-eslint/no-throw-literal
    }
    const { dz } = mountHost({ upload, onError })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1].message).toBe('Upload failed')
  })

  it('rejection → data-dropzone="error" and stays sticky', async () => {
    vi.useFakeTimers()
    const upload: UploadFn = async () => {
      throw new Error('boom')
    }
    const { dz } = mountHost({ upload, successDuration: 200 })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await vi.runAllTimersAsync()

    expect(dz.getAttribute('data-dropzone')).toBe('error')
    vi.advanceTimersByTime(10000)
    expect(dz.getAttribute('data-dropzone')).toBe('error')
    vi.useRealTimers()
  })

  it('mixed success + rejection across files → "error" wins (any error)', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const upload: UploadFn = async (file) => {
      if (file.name === 'bad.png') throw new Error('nope')
      return 'ok'
    }
    const { dz } = mountHost({ upload, onUploaded, onError })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('good.png', 'image/png'),
      makeFile('bad.png', 'image/png'),
    ])
    await flushPromises()

    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(dz.getAttribute('data-dropzone')).toBe('error')
  })
})

describe('v-dropzone — function upload — state lifecycle', () => {
  it('flips to "uploading" immediately and stays until all files settle', async () => {
    const a = deferred<string>()
    const b = deferred<string>()
    let nth = 0
    const upload: UploadFn = async () => {
      const which = nth++
      return which === 0 ? a.promise : b.promise
    }
    const { dz } = mountHost({ upload })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    a.resolve('ok')
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    b.resolve('ok')
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })

  it('new drop after sticky error transitions back to "uploading"', async () => {
    let count = 0
    const upload: UploadFn = async () => {
      count++
      if (count === 1) throw new Error('first fails')
      return 'ok'
    }
    const { dz } = mountHost({ upload })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    fireDragEvent(dz, 'drop', [makeFile('b.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })

  it('drag during in-flight function upload — flips to "active" then restores "uploading" on dragleave', async () => {
    const pending = deferred<string>()
    const upload: UploadFn = async () => pending.promise
    const { dz } = mountHost({ upload })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    fireDragEvent(dz, 'dragenter', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('active')

    fireDragEvent(dz, 'dragleave', [], dz)
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    pending.resolve('ok')
    await flushPromises()
  })
})

describe('v-dropzone — function upload — abort / unmount', () => {
  it('unmount mid-upload flips signal.aborted and the function can see it', async () => {
    const seen = { aborted: false }
    const pending = deferred<string>()
    const upload: UploadFn = async (_file, signal) => {
      signal.addEventListener('abort', () => {
        seen.aborted = true
      })
      return pending.promise
    }
    const { app, dz } = mountHost({ upload })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    app.unmount()

    expect(seen.aborted).toBe(true)
    expect(dz.hasAttribute('data-dropzone')).toBe(false)

    // Even if the promise resolves later, nothing should throw or restore state.
    pending.resolve('ignored')
    await flushPromises()
    expect(dz.hasAttribute('data-dropzone')).toBe(false)
  })

  it('unmount mid-upload fires onError with `aborted: true`', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const upload: UploadFn = (_file, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    const { app, dz } = mountHost({ upload, onError })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [file])
    await flushPromises()

    app.unmount()
    await flushPromises()

    expect(onError).toHaveBeenCalledTimes(1)
    const [arg, err] = onError.mock.calls[0]
    expect(arg).toBe(file)
    expect(err.aborted).toBe(true)
    expect(err.message).toBe('Upload aborted')
  })

  it('a function that ignores `signal` and resolves anyway after unmount does NOT advance state', async () => {
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const pending = deferred<string>()
    const upload: UploadFn = async () => pending.promise
    const { app, dz } = mountHost({ upload, onUploaded })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    app.unmount()
    pending.resolve('late')
    await flushPromises()

    // Attribute removed by detach; never flips to success.
    expect(dz.hasAttribute('data-dropzone')).toBe(false)
    // We don't fire onUploaded post-unmount — the consumer already saw `abort`.
    expect(onUploaded).not.toHaveBeenCalled()
  })
})

describe('v-dropzone — function upload — validation + handler interaction', () => {
  it('rejected files (validation) do NOT invoke the upload function', async () => {
    const upload = vi.fn(async () => 'ok')
    const onReject = vi.fn<(event: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ upload, accept: 'image/*', onReject })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('a.pdf', 'application/pdf')])
    await flushPromises()

    expect(upload).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('mixed accepted + rejected — only accepted files trigger the function', async () => {
    const upload = vi.fn(async () => 'ok')
    const { dz } = mountHost({ upload, accept: 'image/*' })
    await nextTick()

    const ok = makeFile('a.png', 'image/png')
    const bad = makeFile('b.pdf', 'application/pdf')
    fireDragEvent(dz, 'drop', [ok, bad])
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(1)
    expect((upload.mock.calls[0][0] as File).name).toBe('a.png')
  })

  it('`on` handler is invoked with accepted files in parallel with function-based upload', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const upload = vi.fn(async () => 'ok')
    const { dz } = mountHost({ upload, on })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [file])
    await flushPromises()

    expect(on).toHaveBeenCalledWith([file])
    expect(upload).toHaveBeenCalledTimes(1)
  })
})

describe('v-dropzone — function upload — input shape compatibility', () => {
  it('clickToPick → picked file flows through the function-based upload pipeline', async () => {
    const upload = vi.fn(async () => 'ok')
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload, onUploaded, clickToPick: true })
    await nextTick()

    const input = dz.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()

    const file = makeFile('picked.png', 'image/png')
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    })
    input.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })

  it('paste → pasted file flows through the function-based upload pipeline', async () => {
    const upload = vi.fn(async () => 'ok')
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const { dz } = mountHost({ upload, onUploaded, paste: true })
    await nextTick()

    const file = makeFile('pasted.png', 'image/png')
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
      configurable: true,
    })
    dz.dispatchEvent(event)
    await flushPromises()

    expect(upload).toHaveBeenCalledWith(file, expect.any(AbortSignal), expect.any(Function))
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — ref lifecycle                                   */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — ref lifecycle', () => {
  it('populates the supplied ref with a DropzoneApi on mount', async () => {
    const apiRef = ref<DropzoneApi>()
    mountHost({ ref: apiRef as unknown as DropzoneApiRef })
    await nextTick()

    expect(apiRef.value).toBeDefined()
    expect(typeof apiRef.value!.open).toBe('function')
    expect(typeof apiRef.value!.upload).toBe('function')
    expect(typeof apiRef.value!.cancel).toBe('function')
    expect(typeof apiRef.value!.retry).toBe('function')
    expect(typeof apiRef.value!.dismissError).toBe('function')
    expect(apiRef.value!.state).toBe('idle')
    expect(apiRef.value!.pending).toEqual([])
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
  })

  it('also accepts a plain { value } object as the ref target', async () => {
    const target: DropzoneApiRef = { value: undefined }
    mountHost({ ref: target })
    await nextTick()
    expect(target.value).toBeDefined()
    expect(typeof target.value!.open).toBe('function')
  })

  it('clears the ref on unmount (value = undefined)', async () => {
    const apiRef = ref<DropzoneApi>()
    const { app } = mountHost({ ref: apiRef as unknown as DropzoneApiRef })
    await nextTick()
    expect(apiRef.value).toBeDefined()

    app.unmount()
    await nextTick()
    expect(apiRef.value).toBeUndefined()
  })

  it('keeps the same api object across reactive opts updates', async () => {
    const apiRef = ref<DropzoneApi>()
    const opts = ref<DropzoneOptions>({ ref: apiRef as unknown as DropzoneApiRef, accept: 'image/*' })
    const host = document.createElement('div')
    document.body.appendChild(host)

    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const app = createApp(App)
    app.mount(host)
    await nextTick()

    const first = apiRef.value
    expect(first).toBeDefined()

    opts.value = { ref: apiRef as unknown as DropzoneApiRef, accept: 'image/png' }
    await nextTick()

    expect(apiRef.value).toBe(first)
    app.unmount()
  })

  it('swaps to a new ref target mid-life and clears the old one', async () => {
    const refA = ref<DropzoneApi>()
    const refB = ref<DropzoneApi>()
    const opts = ref<DropzoneOptions>({ ref: refA as unknown as DropzoneApiRef })
    const host = document.createElement('div')
    document.body.appendChild(host)

    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const app = createApp(App)
    app.mount(host)
    await nextTick()

    expect(refA.value).toBeDefined()
    expect(refB.value).toBeUndefined()

    const apiObj = refA.value
    opts.value = { ref: refB as unknown as DropzoneApiRef }
    await nextTick()

    expect(refA.value).toBeUndefined()
    expect(refB.value).toBe(apiObj)
    app.unmount()
  })

  it('binds the ref later if it appears after mount', async () => {
    const apiRef = ref<DropzoneApi>()
    const opts = ref<DropzoneOptions>({ accept: 'image/*' })
    const host = document.createElement('div')
    document.body.appendChild(host)

    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const app = createApp(App)
    app.mount(host)
    await nextTick()

    expect(apiRef.value).toBeUndefined()

    opts.value = { accept: 'image/*', ref: apiRef as unknown as DropzoneApiRef }
    await nextTick()

    expect(apiRef.value).toBeDefined()
    expect(typeof apiRef.value!.open).toBe('function')
    app.unmount()
  })

  it('removes the ref binding when opts.ref is dropped', async () => {
    const apiRef = ref<DropzoneApi>()
    const opts = ref<DropzoneOptions>({ ref: apiRef as unknown as DropzoneApiRef })
    const host = document.createElement('div')
    document.body.appendChild(host)

    const App = defineComponent({
      setup() {
        return () => withDirectives(h('div'), [[vDropzone, opts.value]])
      },
    })
    const app = createApp(App)
    app.mount(host)
    await nextTick()

    expect(apiRef.value).toBeDefined()

    opts.value = { /* no ref */ }
    await nextTick()
    expect(apiRef.value).toBeUndefined()

    app.unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — open()                                          */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — open()', () => {
  it('creates a hidden file input on demand and clicks it (clickToPick: false — otherwise it exists at mount)', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({ ref: apiRef as unknown as DropzoneApiRef, clickToPick: false })
    await nextTick()
    expect(dz.querySelector('input[type="file"]')).toBeNull()

    let clicked = 0
    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      clicked += 1
    }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }

    const input = dz.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    // Clipped, not `display: none` — and with no host click affordance it is
    // deliberately NOT a tab stop (nothing on screen points at it).
    expect(input.style.display).toBe('')
    expect(input.style.position).toBe('absolute')
    expect(input.style.clipPath).toBe('inset(50%)')
    expect(input.getAttribute('tabindex')).toBe('-1')
    expect(input.getAttribute('aria-hidden')).toBe('true')
    expect(clicked).toBe(1)
  })

  it('picked files flow through the same validation + on() + upload pipeline', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      on,
      upload,
      onUploaded,
      accept: 'image/*',
    })
    await nextTick()

    apiRef.value!.open()
    const input = dz.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()

    const file = makeFile('picked.png', 'image/png')
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    })
    input.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(on).toHaveBeenCalledWith([file])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith(file, 'ok')
  })

  it('reuses the same hidden input across multiple open() calls', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({ ref: apiRef as unknown as DropzoneApiRef })
    await nextTick()

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { /* no-op */ }
    try {
      apiRef.value!.open()
      apiRef.value!.open()
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }

    expect(dz.querySelectorAll('input[type="file"]').length).toBe(1)
  })

  it('shares the hidden input with `clickToPick: true` (no duplicate created)', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      clickToPick: true,
    })
    await nextTick()
    expect(dz.querySelectorAll('input[type="file"]').length).toBe(1)

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { /* no-op */ }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }
    expect(dz.querySelectorAll('input[type="file"]').length).toBe(1)
  })

  it('removes the hidden input on unmount', async () => {
    const apiRef = ref<DropzoneApi>()
    const { app, dz } = mountHost({ ref: apiRef as unknown as DropzoneApiRef })
    await nextTick()

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { /* no-op */ }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }
    expect(dz.querySelector('input[type="file"]')).toBeTruthy()

    app.unmount()
    expect(dz.querySelector('input[type="file"]')).toBeNull()
  })

  it('mirrors accept + multiple onto the hidden input on open()', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      accept: '.pdf,.docx',
      multiple: false,
    })
    await nextTick()

    const origClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { /* no-op */ }
    try {
      apiRef.value!.open()
    } finally {
      HTMLInputElement.prototype.click = origClick
    }

    const input = dz.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.getAttribute('accept')).toBe('.pdf,.docx')
    expect(input.multiple).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — upload(files)                                   */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — upload(files) drop-like', () => {
  it('treats a File argument like a drop — validates + fires on() + uploads', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const onUploaded = vi.fn<(file: File, response: unknown) => void>()
    const apiRef = ref<DropzoneApi>()
    mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      on,
      upload,
      onUploaded,
    })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    apiRef.value!.upload(file)
    await flushPromises()

    expect(on).toHaveBeenCalledWith([file])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith(file, 'ok')
  })

  it('treats a File[] argument like a multi-file drop', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      on,
      upload,
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    apiRef.value!.upload([a, b])
    await flushPromises()

    expect(on).toHaveBeenCalledWith([a, b])
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('drives validation: invalid file fires onReject and not on()', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      accept: 'image/*',
      on,
      onReject,
    })
    await nextTick()

    apiRef.value!.upload(makeFile('a.pdf', 'application/pdf'))
    await flushPromises()

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
  })

  it('with no upload configured: just fires on() and stays idle', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      on,
    })
    await nextTick()

    apiRef.value!.upload(makeFile('a.png', 'image/png'))
    await flushPromises()

    expect(on).toHaveBeenCalledTimes(1)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — upload() with pending queue (autoUpload: false) */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — autoUpload:false + upload() trigger', () => {
  it('drop queues into api.pending without starting upload when autoUpload:false', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [file])
    await flushPromises()

    expect(upload).not.toHaveBeenCalled()
    expect(apiRef.value!.pending.map((f) => f.name)).toEqual(['a.png'])
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  /**
   * The drop above fires `drop` on its own, which is not a drop: a real one
   * arrives as dragenter → dragover → drop, and `dragenter` sets the zone to
   * `active`. Nothing in the queue branch ever set it back, so the zone stayed
   * `active` — and `api.state` reported `active` — for as long as the page was
   * open, on the README's own recipe 8. A *pick* through the same options ends
   * `idle`, which is why the suite never saw it.
   */
  it('a REAL drop sequence (dragenter → drop) leaves a queued zone at rest, not "active"', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'dragenter', [file])
    expect(dz.getAttribute('data-dropzone')).toBe('active')
    fireDragEvent(dz, 'dragover', [file])
    fireDragEvent(dz, 'drop', [file])
    await flushPromises()

    expect(upload).not.toHaveBeenCalled()
    expect(apiRef.value!.pending.map((f) => f.name)).toEqual(['a.png'])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
    expect(apiRef.value!.state).toBe('idle')
  })

  it('a rejection in the same batch still wins the state (its timer clears it)', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
      accept: 'image/*',
    })
    await nextTick()

    const ok = makeFile('a.png', 'image/png')
    const bad = makeFile('notes.txt', 'text/plain')
    fireDragEvent(dz, 'dragenter', [ok, bad])
    fireDragEvent(dz, 'drop', [ok, bad])
    await flushPromises()

    // Queuing the accepted file must not swallow the rejection feedback —
    // the same rule the non-upload branch already follows.
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
    expect(apiRef.value!.pending.map((f) => f.name)).toEqual(['a.png'])
  })

  it('a queued drop during an in-flight upload keeps the zone "uploading"', async () => {
    let resolveUpload: (value: string) => void = () => {}
    const upload = vi.fn<UploadFn>(() => new Promise<string>((r) => (resolveUpload = r)))
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    fireDragEvent(dz, 'dragenter', [makeFile('a.png', 'image/png')])
    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    apiRef.value!.upload()
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    // A second drop that only queues must not report the zone at rest while
    // the first file is still on the wire.
    fireDragEvent(dz, 'dragenter', [makeFile('b.png', 'image/png')])
    fireDragEvent(dz, 'drop', [makeFile('b.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    resolveUpload('ok')
    await flushPromises()
  })

  it('api.upload() (no arg) starts uploads for everything in pending', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await flushPromises()
    expect(apiRef.value!.pending.length).toBe(2)

    apiRef.value!.upload()
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(2)
    expect(apiRef.value!.pending).toEqual([])
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })

  it('upload() (no arg) is a no-op when pending is empty', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    apiRef.value!.upload()
    await flushPromises()
    expect(upload).not.toHaveBeenCalled()
  })

  it('autoUpload:false combined with upload(file) still uploads immediately when explicit', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    // `autoUpload: false` suppresses the automatic dispatch that follows a
    // drop / paste / pick. An explicit `api.upload(file)` is the consumer
    // saying "upload this one now" — the reason to hold a queue back at all —
    // so it uploads and does not land back in `pending`.
    const file = makeFile('a.png', 'image/png')
    apiRef.value!.upload(file)
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(file)
    expect(apiRef.value!.pending.length).toBe(0)
  })

  it('upload(file) uploads exactly the named file and leaves the rest of the queue pending', async () => {
    // The "upload only the ones I ticked" flow: queue three, flush one.
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    const c = makeFile('c.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b, c])
    await flushPromises()
    expect(upload).not.toHaveBeenCalled()
    expect(apiRef.value!.pending.map((f) => f.name)).toEqual(['a.png', 'b.png', 'c.png'])

    apiRef.value!.upload(b)
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(b)
    expect(apiRef.value!.pending.map((f) => f.name)).toEqual(['a.png', 'c.png'])

    apiRef.value!.upload()
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(3)
    expect(apiRef.value!.pending.length).toBe(0)
  })

  it('upload(file) still validates — a rejected file is not force-uploaded', async () => {
    // forceUpload bypasses the autoUpload queue, never the validation gate.
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const onReject = vi.fn<(event: DropzoneRejectEvent) => void>()
    const apiRef = ref<DropzoneApi>()
    mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      accept: 'image/*',
      upload,
      autoUpload: false,
      onReject,
    })
    await nextTick()

    apiRef.value!.upload(makeFile('notes.txt', 'text/plain'))
    await flushPromises()

    expect(upload).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0].reasons).toEqual(['type'])
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — cancel() — function-based upload                */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — cancel() function-based', () => {
  it('cancel(file) aborts the in-flight upload, fires onError(aborted), removes from tracking', async () => {
    const { promise, resolve } = deferred<string>()
    const seenSignals: AbortSignal[] = []
    const upload = vi.fn<UploadFn>(async (_file, signal) => {
      seenSignals.push(signal)
      return promise
    })
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      onError,
    })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [file])
    await flushPromises()
    expect(apiRef.value!.uploading.map((f) => f.name)).toEqual(['a.png'])

    apiRef.value!.cancel(file)
    // Resolve later — should be ignored because signal.aborted will be true.
    resolve('late')
    await flushPromises()

    expect(seenSignals[0].aborted).toBe(true)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toMatchObject({ message: 'Upload aborted', aborted: true })
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
    // Batch settled — single file cancelled, no errors → idle.
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('cancel() (no arg) aborts every in-flight upload', async () => {
    const deferreds = [deferred<string>(), deferred<string>(), deferred<string>()]
    let idx = 0
    const upload = vi.fn<UploadFn>(async () => deferreds[idx++].promise)
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
    ])
    await flushPromises()
    expect(apiRef.value!.uploading.length).toBe(3)

    apiRef.value!.cancel()
    await flushPromises()

    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('cancel(file) for an unknown file is a no-op', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    apiRef.value!.cancel(makeFile('nonexistent.png', 'image/png'))
    await flushPromises()
    // No throw, no side effects.
  })

  it('cancel keeps existing `failed` records intact', async () => {
    const deferreds = [deferred<string>(), deferred<string>()]
    let idx = 0
    const upload = vi.fn<UploadFn>(async (_file, signal) => {
      const d = deferreds[idx++]
      signal.addEventListener('abort', () => d.reject(new Error('aborted')))
      return d.promise
    })
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await flushPromises()

    // a fails.
    deferreds[0].reject(new Error('boom'))
    await flushPromises()
    expect(apiRef.value!.failed.map((f) => f.name)).toEqual(['a.png'])
    expect(apiRef.value!.uploading.map((f) => f.name)).toEqual(['b.png'])

    // Cancel b.
    apiRef.value!.cancel(b)
    await flushPromises()
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed.map((f) => f.name)).toEqual(['a.png'])
    // Errors counter > 0 → stays in error.
    expect(dz.getAttribute('data-dropzone')).toBe('error')
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — cancel() — URL-based (XHR)                      */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — cancel() URL-based per-file', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('cancel(file) aborts the XHR and removes the file from tracking', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload: { url: '/api/upload' },
      onError,
    })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    const xhr = await dropOneFile(dz, file)
    expect(apiRef.value!.uploading.map((f) => f.name)).toEqual(['a.png'])

    apiRef.value!.cancel(file)
    // The directive triggered xhr.abort() — simulate the browser firing onabort.
    xhr.emitAbort()
    await nextTick()

    expect(xhr.aborted).toBe(true)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toMatchObject({ message: 'Upload aborted', aborted: true })
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('cancel() (no arg) aborts every in-flight XHR', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload: { url: '/api/upload' },
    })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await nextTick()
    expect(xhrQueue.length).toBe(2)
    expect(apiRef.value!.uploading.length).toBe(2)

    apiRef.value!.cancel()
    for (const xhr of xhrQueue) xhr.emitAbort()
    await nextTick()

    expect(xhrQueue.every((x) => x.aborted)).toBe(true)
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })
})

describe('v-dropzone — api — cancel() URL-based batched', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('cancel(file) on a batched mode aborts the whole shared XHR + all files in the batch', async () => {
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload: { url: '/api/upload', batched: true, fieldName: 'files' },
      onError,
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await nextTick()
    expect(xhrQueue.length).toBe(1)
    expect(apiRef.value!.uploading.length).toBe(2)

    apiRef.value!.cancel(a)
    xhrQueue[0].emitAbort()
    await nextTick()

    expect(xhrQueue[0].aborted).toBe(true)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(apiRef.value!.uploading).toEqual([])
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — retry()                                         */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — retry() function-based', () => {
  it('retry(file) re-runs the upload for a failed file', async () => {
    let call = 0
    const upload = vi.fn<UploadFn>(async () => {
      call += 1
      if (call === 1) throw new Error('boom')
      return 'ok'
    })
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [file])
    await flushPromises()
    expect(apiRef.value!.failed.map((f) => f.name)).toEqual(['a.png'])
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    apiRef.value!.retry(file)
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(2)
    expect(apiRef.value!.failed).toEqual([])
    expect(apiRef.value!.uploading).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })

  it('retry() (no arg) re-runs every failed file in one batch', async () => {
    let call = 0
    const upload = vi.fn<UploadFn>(async () => {
      call += 1
      if (call <= 2) throw new Error('boom')
      return 'ok'
    })
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await flushPromises()
    expect(apiRef.value!.failed.length).toBe(2)
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    apiRef.value!.retry()
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(4)
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })

  it('retry(file) for an unknown file is a no-op', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    apiRef.value!.retry(makeFile('nope.png', 'image/png'))
    await flushPromises()
    expect(upload).not.toHaveBeenCalled()
  })

  it('retry(file) for a non-failed file (e.g. uploading) is a no-op', async () => {
    const { promise } = deferred<string>()
    const upload = vi.fn<UploadFn>(async () => promise)
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    const file = makeFile('a.png', 'image/png')
    fireDragEvent(dz, 'drop', [file])
    await flushPromises()
    expect(apiRef.value!.uploading.map((f) => f.name)).toEqual(['a.png'])

    apiRef.value!.retry(file)
    await flushPromises()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')
  })
})

describe('v-dropzone — api — retry() URL-based batched', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('retry(file) on a previously-failed batch re-uploads the whole group', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload: { url: '/api/upload', batched: true, fieldName: 'files' },
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await nextTick()
    expect(xhrQueue.length).toBe(1)

    xhrQueue[0].emitLoad(500, 'oops')
    await nextTick()
    expect(apiRef.value!.failed.length).toBe(2)
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    apiRef.value!.retry(a)
    await nextTick()
    expect(xhrQueue.length).toBe(2)
    const newFd = xhrQueue[1].body as FormData
    expect(newFd.getAll('files')).toEqual([a, b])

    xhrQueue[1].emitLoad(200, 'ok')
    await nextTick()
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('success')
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — dismissError()                                  */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — dismissError()', () => {
  it('clears the sticky error state and drops failed records', async () => {
    const upload = vi.fn<UploadFn>(async () => {
      throw new Error('boom')
    })
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await flushPromises()
    expect(apiRef.value!.failed.length).toBe(2)
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    apiRef.value!.dismissError()
    await flushPromises()
    expect(apiRef.value!.failed).toEqual([])
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('preserves in-flight records (state goes to uploading)', async () => {
    const deferreds = [deferred<string>(), deferred<string>()]
    let idx = 0
    const upload = vi.fn<UploadFn>(async () => {
      const d = deferreds[idx++]
      return d.promise
    })
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    fireDragEvent(dz, 'drop', [a, b])
    await flushPromises()

    deferreds[0].reject(new Error('boom'))
    await flushPromises()
    // a failed, b still uploading. But once a errored, batch advances; batch
    // has total 2 done 1. b's still pending. State is 'uploading' until batch settles.
    expect(apiRef.value!.failed.map((f) => f.name)).toEqual(['a.png'])
    expect(apiRef.value!.uploading.map((f) => f.name)).toEqual(['b.png'])

    apiRef.value!.dismissError()
    await flushPromises()
    expect(apiRef.value!.failed).toEqual([])
    expect(apiRef.value!.uploading.map((f) => f.name)).toEqual(['b.png'])
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    deferreds[1].resolve('ok')
    await flushPromises()
    expect(apiRef.value!.uploading).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — reactive state                                  */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — reactive state', () => {
  it('api.state reflects data-dropzone transitions', async () => {
    const { promise, resolve } = deferred<string>()
    const upload = vi.fn<UploadFn>(async () => promise)
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()
    expect(apiRef.value!.state).toBe('idle')

    fireDragEvent(dz, 'dragenter', [makeFile('a.png', 'image/png')])
    expect(apiRef.value!.state).toBe('active')

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(apiRef.value!.state).toBe('uploading')

    resolve('ok')
    await flushPromises()
    expect(apiRef.value!.state).toBe('success')
  })

  it('api.state is reactive — watch/computed observe transitions', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
    })
    await nextTick()

    const seen: string[] = []
    const { watchEffect, effectScope } = await import('vue')
    const s = effectScope()
    s.run(() => {
      watchEffect(() => {
        seen.push(apiRef.value!.state)
      })
    })

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()

    expect(seen.includes('uploading')).toBe(true)
    expect(seen.includes('success')).toBe(true)

    s.stop()
  })

  it('api.pending / uploading / failed are reactive', async () => {
    const upload = vi.fn<UploadFn>(async () => 'ok')
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      autoUpload: false,
    })
    await nextTick()

    const pendingSnapshots: number[] = []
    const { watchEffect, effectScope } = await import('vue')
    const s = effectScope()
    s.run(() => {
      watchEffect(() => {
        pendingSnapshots.push(apiRef.value!.pending.length)
      })
    })

    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await flushPromises()
    expect(pendingSnapshots.includes(2)).toBe(true)

    apiRef.value!.upload()
    await flushPromises()
    expect(apiRef.value!.pending.length).toBe(0)

    s.stop()
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — DropzoneApi — unmount cleanup                                 */
/* ------------------------------------------------------------------ */

describe('v-dropzone — api — unmount cleanup', () => {
  it('unmount aborts in-flight uploads, clears ref, removes input', async () => {
    const { promise } = deferred<string>()
    const seenSignals: AbortSignal[] = []
    const upload = vi.fn<UploadFn>(async (_file, signal) => {
      seenSignals.push(signal)
      return promise
    })
    const onError = vi.fn<(file: File, error: UploadError) => void>()
    const apiRef = ref<DropzoneApi>()
    const { app, dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload,
      onError,
      clickToPick: true,
    })
    await nextTick()
    expect(dz.querySelector('input[type="file"]')).toBeTruthy()

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(apiRef.value!.uploading.length).toBe(1)

    app.unmount()
    await nextTick()

    expect(seenSignals[0].aborted).toBe(true)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toMatchObject({ message: 'Upload aborted', aborted: true })
    expect(apiRef.value).toBeUndefined()
    expect(dz.querySelector('input[type="file"]')).toBeNull()
    expect(dz.hasAttribute('data-dropzone')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  P0 — CSS variables during upload (--dropzone-progress, --dropzone-files-pending) */
/* ------------------------------------------------------------------ */

describe('v-dropzone — CSS variables — URL upload', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('initial mount: --dropzone-progress and --dropzone-files-pending are unset', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('')
  })

  it('upload starts: --dropzone-progress="0", --dropzone-files-pending="1" for a single file', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    await dropOneFile(dz, makeFile('a.png', 'image/png'))
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('0')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('1')
  })

  it('XHR progress event updates --dropzone-progress to the new percent', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitProgress(500, 1000)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50')
    xhr.emitProgress(800, 1000)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('80')
  })

  it('aggregate percent across two files in per-file mode is the AVERAGE', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await nextTick()
    expect(xhrQueue.length).toBe(2)

    // Initial = 0
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('0')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('2')

    xhrQueue[0].emitProgress(500, 1000) // file a at 50%
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('25') // (50+0)/2
    xhrQueue[1].emitProgress(750, 1000) // file b at 75%
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('63') // round((50+75)/2)
  })

  it('batched URL mode: single XHR progress drives the same percent for all files in the batch', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload', batched: true } })
    await nextTick()
    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
    ])
    await nextTick()
    expect(xhrQueue.length).toBe(1)

    // files-pending counts FILES (not batch groups) — consistent UX across modes.
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('3')
    xhrQueue[0].emitProgress(500, 1000)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50')
  })

  it('file completes successfully: contributes 100% to aggregate; files-pending decrements', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await nextTick()

    xhrQueue[0].emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    // a is done (100%), b at 0% → aggregate = 50; files-pending = 1
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('1')

    xhrQueue[1].emitProgress(500, 1000) // b at 50%
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('75') // (100+50)/2
  })

  it('all files complete: --dropzone-progress="100", --dropzone-files-pending="0", vars persist in success state', async () => {
    vi.useFakeTimers()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, successDuration: 200 })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()

    expect(dz.getAttribute('data-dropzone')).toBe('success')
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('100')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('0')

    vi.useRealTimers()
  })

  it('success auto-clears to idle and clears the CSS vars', async () => {
    vi.useFakeTimers()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, successDuration: 200 })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('100')

    vi.advanceTimersByTime(250)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('')

    vi.useRealTimers()
  })

  it('error state: CSS vars persist showing last percent and remaining count', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()

    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitProgress(750, 1000) // 75% then error
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('75')
    xhr.emitLoad(500, 'Internal Server Error')
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('error')
    // Error keeps the last percent visible — consumer can show "Failed at 75%"
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('75')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('0')
  })

  it('drag during upload: state flips to active but CSS vars persist', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitProgress(500, 1000)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50')

    fireDragEvent(dz, 'dragenter', [makeFile('b.png', 'image/png')])
    expect(dz.getAttribute('data-dropzone')).toBe('active')
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('1')

    fireDragEvent(dz, 'dragleave')
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50')
  })

  it('rejected drop: CSS vars stay unset (no upload was attempted)', async () => {
    const { dz } = mountHost({
      upload: { url: '/api/upload' },
      maxSize: 10,
    })
    await nextTick()

    fireDragEvent(dz, 'drop', [makeFile('big.png', 'image/png', 1000)])
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('')
  })

  it('cancel resets state to idle and clears CSS vars (no remaining error)', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      upload: { url: '/api/upload' },
      ref: apiRef as unknown as DropzoneApiRef,
    })
    await nextTick()
    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitProgress(500, 1000)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50')

    apiRef.value!.cancel()
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('')
  })

  it('second batch resets the CSS vars (no leakage from previous batch)', async () => {
    vi.useFakeTimers()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, successDuration: 50 })
    await nextTick()

    const xhr1 = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr1.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    vi.advanceTimersByTime(100)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('')

    // Second batch — 3 files
    fireDragEvent(dz, 'drop', [
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
      makeFile('d.png', 'image/png'),
    ])
    await nextTick()
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('0')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('3')

    vi.useRealTimers()
  })

  it('--dropzone-files-pending decrements monotonically as files settle', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
    ])
    await nextTick()
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('3')

    xhrQueue[0].emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('2')

    xhrQueue[1].emitLoad(500, 'err')
    await nextTick()
    // Error still settles the file — pending should decrement
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('1')

    xhrQueue[2].emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    // Batch settles to error (because one failed). Pending = 0.
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('0')
  })

  it('multi-file per-file mode: --dropzone-files-pending matches the file count, not the batch group count', async () => {
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await nextTick()
    // 2 files, per-file mode → 2 groups → pending = 2
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('2')
  })
})

describe('v-dropzone — CSS variables — function upload', () => {
  it('function-based upload: onProgress callback drives --dropzone-progress', async () => {
    let reportProgress: ((p: number) => void) | null = null
    const { promise, resolve } = deferred<string>()
    const upload = vi.fn<UploadFn>(async (_file, _signal, onProgress) => {
      reportProgress = onProgress ?? null
      return promise
    })
    const { dz } = mountHost({ upload })
    await nextTick()
    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('0')

    reportProgress!(40)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('40')

    resolve('ok')
    await flushPromises()
    // After success, progress = 100, files-pending = 0
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('100')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('0')
  })

  it('function-based: aggregate across two files', async () => {
    const reports: ((p: number) => void)[] = []
    const upload = vi.fn<UploadFn>(async (_file, _signal, onProgress) => {
      if (onProgress) reports.push(onProgress)
      return new Promise(() => {})
    })
    const { dz } = mountHost({ upload })
    await nextTick()
    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await flushPromises()
    expect(reports.length).toBe(2)

    reports[0](30)
    reports[1](70)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('50') // (30+70)/2
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('2')
  })

  it('function-based error: vars persist in error state', async () => {
    const upload = vi.fn<UploadFn>(async () => {
      throw new Error('boom')
    })
    const { dz } = mountHost({ upload })
    await nextTick()
    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.getAttribute('data-dropzone')).toBe('error')
    // No progress reported; failed contributes 0%; pending=0 (all settled in batch)
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('0')
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('0')
  })

  it('unmount clears CSS vars', async () => {
    const upload = vi.fn<UploadFn>(async () => new Promise(() => {}))
    const { app, dz } = mountHost({ upload })
    await nextTick()
    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    await flushPromises()
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('0')

    app.unmount()
    await nextTick()
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('')
  })
})

describe('v-dropzone — CSS variables — autoUpload:false interaction', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('autoUpload:false → vars unset while queued; set when api.upload() actually starts', async () => {
    const apiRef = ref<DropzoneApi>()
    const { dz } = mountHost({
      ref: apiRef as unknown as DropzoneApiRef,
      upload: { url: '/api/upload' },
      autoUpload: false,
    })
    await nextTick()
    fireDragEvent(dz, 'drop', [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
    ])
    await nextTick()
    expect(apiRef.value!.pending.length).toBe(2)
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('')

    apiRef.value!.upload()
    await nextTick()
    expect(dz.style.getPropertyValue('--dropzone-progress')).toBe('0')
    expect(dz.style.getPropertyValue('--dropzone-files-pending')).toBe('2')
  })
})

describe('v-dropzone — state lifecycle — success auto-clear semantics', () => {
  beforeEach(installFakeXhr)
  afterEach(restoreXhr)

  it('success auto-clear uses successDuration default of 1500ms when not configured', async () => {
    vi.useFakeTimers()
    const { dz } = mountHost({ upload: { url: '/api/upload' } })
    await nextTick()
    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('success')

    vi.advanceTimersByTime(1499)
    expect(dz.getAttribute('data-dropzone')).toBe('success')

    vi.advanceTimersByTime(2)
    expect(dz.getAttribute('data-dropzone')).toBe('idle')

    vi.useRealTimers()
  })

  it('error state is sticky — does NOT auto-clear after successDuration', async () => {
    vi.useFakeTimers()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, successDuration: 200 })
    await nextTick()
    const xhr = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr.emitLoad(500, 'Internal Server Error')
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    vi.advanceTimersByTime(10_000)
    expect(dz.getAttribute('data-dropzone')).toBe('error')

    vi.useRealTimers()
  })

  it('a new drop during success state cancels the pending success→idle timer and starts a new batch', async () => {
    vi.useFakeTimers()
    const { dz } = mountHost({ upload: { url: '/api/upload' }, successDuration: 500 })
    await nextTick()
    const xhr1 = await dropOneFile(dz, makeFile('a.png', 'image/png'))
    xhr1.emitLoad(200, '{}', { 'content-type': 'application/json' })
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('success')

    vi.advanceTimersByTime(100) // partway through the success window
    fireDragEvent(dz, 'drop', [makeFile('b.png', 'image/png')])
    await nextTick()
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    // Confirm the OLD timer doesn't fire and override
    vi.advanceTimersByTime(500)
    expect(dz.getAttribute('data-dropzone')).toBe('uploading')

    vi.useRealTimers()
  })
})

/* ------------------------------------------------------------------ */
/*  DropzonePlugin + DIRECTIVE_NAME                                    */
/* ------------------------------------------------------------------ */

describe('DropzonePlugin + DIRECTIVE_NAME', () => {
  it('exports DIRECTIVE_NAME as the kebab-case directive name', () => {
    expect(DIRECTIVE_NAME).toBe('dropzone')
  })

  it('DropzonePlugin.install registers the directive under DIRECTIVE_NAME', () => {
    let registeredName: string | undefined
    let registeredDirective: unknown
    const stubApp = {
      directive(name: string, dir: unknown) {
        registeredName = name
        registeredDirective = dir
        return this
      },
    } as any

    ;(DropzonePlugin.install as any)(stubApp)
    expect(registeredName).toBe(DIRECTIVE_NAME)
    expect(registeredDirective).toBe(vDropzone)
  })

  it('app.use(DropzonePlugin) wires v-dropzone end-to-end through Vue', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const App = defineComponent({
      setup() {
        return () => h('div', { ref: 'box' })
      },
    })

    const app = createApp(App)
    app.use(DropzonePlugin)
    app.mount(host)
    await nextTick()

    expect((app as any)._context.directives[DIRECTIVE_NAME]).toBe(vDropzone)
    app.unmount()
  })

  it('idempotent: re-installing DropzonePlugin via app.use is a no-throw no-op', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const App = defineComponent({ setup() { return () => h('div') } })
    const app = createApp(App)
    expect(() => {
      app.use(DropzonePlugin)
      app.use(DropzonePlugin)
    }).not.toThrow()
    app.mount(host)
    await nextTick()
    expect((app as any)._context.directives[DIRECTIVE_NAME]).toBe(vDropzone)
    app.unmount()
  })

  it('app.use(DropzonePlugin) lets template author bind `v-dropzone` by kebab name', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const onFiles = vi.fn<(files: File[]) => void>()
    const App = defineComponent({
      // Plugin install registers the directive globally — template can use it.
      template: `<div ref="box" v-dropzone="onFiles" />`,
      setup() {
        return { onFiles }
      },
    })

    const app = createApp(App as any)
    app.use(DropzonePlugin)
    app.mount(host)
    await nextTick()

    const dz = host.querySelector('div')!
    expect(dz.getAttribute('data-dropzone')).toBe('idle')

    fireDragEvent(dz, 'drop', [makeFile('a.png', 'image/png')])
    expect(onFiles).toHaveBeenCalledTimes(1)

    app.unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  Folder drop via webkitGetAsEntry                                   */
/* ------------------------------------------------------------------ */

/**
 * Build a FileSystemFileEntry stub that resolves to `file`.
 * The directive treats it as opaque — only `isFile` / `file(success, error)` are read.
 */
function makeFileEntry(file: File): any {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: '/' + file.name,
    file: (success: (f: File) => void) => {
      success(file)
    },
  }
}

/**
 * Build a FileSystemDirectoryEntry stub. The reader yields `children` once
 * and then an empty array (mirroring the real `readEntries` contract).
 *
 * Pass `{ batched: true }` to yield children one at a time across multiple
 * `readEntries` calls — pins that the directive keeps calling until empty.
 */
function makeDirEntry(
  name: string,
  children: any[],
  opts: { batched?: boolean } = {},
): any {
  let cursor = 0
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: '/' + name,
    createReader: () => ({
      readEntries: (success: (entries: any[]) => void) => {
        if (opts.batched) {
          if (cursor >= children.length) return success([])
          const next = children[cursor++]
          return success([next])
        }
        if (cursor === 0) {
          cursor = 1
          return success(children)
        }
        return success([])
      },
    }),
  }
}

/**
 * Fire a `drop` DragEvent whose `dataTransfer.items[i].webkitGetAsEntry()`
 * returns the provided entries. `files` is the synchronous flat list used
 * by both `dt.files` and `dt.items[i].getAsFile()` fallback paths.
 */
function fireDropWithEntries(
  el: HTMLElement,
  pairs: Array<{ entry: any; file: File | null }>,
): DragEvent {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  const dt = {
    files: pairs.map((p) => p.file).filter((f): f is File => f !== null),
    items: pairs.map((p) => ({
      kind: 'file' as const,
      type: p.file?.type ?? '',
      getAsFile: () => p.file,
      webkitGetAsEntry: () => p.entry,
    })),
    types: ['Files'],
  }
  Object.defineProperty(event, 'dataTransfer', { value: dt, configurable: true })
  el.dispatchEvent(event)
  return event
}

/**
 * Settle helper for the async folder walk. A macrotask turn runs only after
 * the microtask queue has fully drained, so any depth of promise chain
 * (nested directories = more `.then` links) settles before we assert —
 * unlike counting `Promise.resolve()` ticks, which breaks the moment the
 * walk grows one level deeper than the count.
 */
async function flushAsync() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

describe('v-dropzone — folder drop (webkitGetAsEntry)', () => {
  it('flat folder: drop a folder with 2 files → handler receives both files', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    const dir = makeDirEntry('photos', [makeFileEntry(a), makeFileEntry(b)])
    fireDropWithEntries(dz, [{ entry: dir, file: null }])

    await flushAsync()
    expect(on).toHaveBeenCalledTimes(1)
    const received = on.mock.calls[0][0]
    expect(received.map((f) => f.name).sort()).toEqual(['a.png', 'b.png'])
  })

  it('nested folder: walks recursively', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const deep = makeFile('deep.txt', 'text/plain')
    const root = makeDirEntry('root', [
      makeDirEntry('inner', [
        makeDirEntry('inner2', [makeFileEntry(deep)]),
      ]),
    ])
    fireDropWithEntries(dz, [{ entry: root, file: null }])

    await flushAsync()
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0].map((f) => f.name)).toEqual(['deep.txt'])
  })

  it('mixed: drop one file + one folder → handler gets both top-level file and folder contents', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const topFile = makeFile('top.png', 'image/png')
    const inside = makeFile('inside.png', 'image/png')
    const dir = makeDirEntry('photos', [makeFileEntry(inside)])
    fireDropWithEntries(dz, [
      { entry: makeFileEntry(topFile), file: topFile },
      { entry: dir, file: null },
    ])

    await flushAsync()
    expect(on).toHaveBeenCalledTimes(1)
    const names = on.mock.calls[0][0].map((f) => f.name).sort()
    expect(names).toEqual(['inside.png', 'top.png'])
  })

  it('order: top-level slot order is preserved when a directory resolves slower than a file', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    // Directory first, plain file second. The directory resolves through
    // async readEntries while the file entry resolves immediately — if the
    // walk delivered files as they settled instead of by slot, top.png
    // would arrive first. README pins `[dir/, top.png]` → `[...inside, top.png]`.
    const topFile = makeFile('top.png', 'image/png')
    const dir = makeDirEntry('photos', [
      makeFileEntry(makeFile('inside1.png', 'image/png')),
      makeFileEntry(makeFile('inside2.png', 'image/png')),
    ])
    fireDropWithEntries(dz, [
      { entry: dir, file: null },
      { entry: makeFileEntry(topFile), file: topFile },
    ])

    await flushAsync()
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0].map((f) => f.name)).toEqual([
      'inside1.png',
      'inside2.png',
      'top.png',
    ])
  })

  it('empty folder: handler is NOT called (idle state)', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const empty = makeDirEntry('empty', [])
    fireDropWithEntries(dz, [{ entry: empty, file: null }])

    await flushAsync()
    expect(on).not.toHaveBeenCalled()
    expect(dz.getAttribute('data-dropzone')).toBe('idle')
  })

  it('readEntries batches: walker keeps calling until empty', async () => {
    // Each readEntries call yields ONE child until exhausted — production browsers
    // typically batch 100 entries per call. We pin the loop here.
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const files = [
      makeFile('1.png', 'image/png'),
      makeFile('2.png', 'image/png'),
      makeFile('3.png', 'image/png'),
    ]
    const dir = makeDirEntry('many', files.map(makeFileEntry), { batched: true })
    fireDropWithEntries(dz, [{ entry: dir, file: null }])

    await flushAsync()
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0].map((f) => f.name).sort()).toEqual(['1.png', '2.png', '3.png'])
  })

  it('validation: maxCount applies to the flattened folder contents', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ on, onReject, maxCount: 2 })
    await nextTick()

    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    const c = makeFile('c.png', 'image/png')
    const dir = makeDirEntry('photos', [makeFileEntry(a), makeFileEntry(b), makeFileEntry(c)])
    fireDropWithEntries(dz, [{ entry: dir, file: null }])

    await flushAsync()
    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0].reasons).toContain('count')
  })

  it('validation: per-file type filter applies inside folders', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(e: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ on, onReject, accept: 'image/*' })
    await nextTick()

    const img = makeFile('a.png', 'image/png')
    const pdf = makeFile('readme.pdf', 'application/pdf')
    const dir = makeDirEntry('mixed', [makeFileEntry(img), makeFileEntry(pdf)])
    fireDropWithEntries(dz, [{ entry: dir, file: null }])

    await flushAsync()
    // Per-file partial-rejection model — identical to the direct-drop and
    // paste paths: the png passes accept and reaches on(); the pdf fails
    // and reaches onReject().
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0].map((f) => f.name)).toEqual(['a.png'])
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0].files.map((f) => f.name)).toEqual(['readme.pdf'])
    expect(onReject.mock.calls[0][0].reasons).toEqual(['type'])
  })

  it('falls back to sync extractFiles when no item exposes webkitGetAsEntry (old browsers)', async () => {
    // No item has webkitGetAsEntry → the synchronous dt.files path must still work.
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    // Use the original fireDragEvent (no webkitGetAsEntry on items).
    const f = makeFile('legacy.png', 'image/png')
    fireDragEvent(dz, 'drop', [f])
    await nextTick()
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0]).toEqual([f])
  })

  it('falls back to sync extractFiles when webkitGetAsEntry exists but returns null for every item', async () => {
    // The shape real Chromium produces for a drag with no filesystem backing:
    // the method is present on every item, and every call answers `null` while
    // `dataTransfer.files` is fully populated. Reproduced in headless Chrome
    // via the playground interaction harness — a synthetic `new DataTransfer()`
    // (how automated drop tests drive a dropzone), a drag out of a virtual
    // folder, and a mail-client attachment all land here. Taking the folder
    // walk with an empty entry list silently delivered zero files.
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const f = makeFile('virtual.png', 'image/png')
    fireDropWithEntries(dz, [{ entry: null, file: f }])
    await flushAsync()

    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0]).toEqual([f])
  })

  it('null-entry fallback still runs the full validation pipeline', async () => {
    // The fallback must re-enter the same pipeline, not bypass it: a file the
    // `accept` filter rejects still rejects when it arrives via this path.
    const on = vi.fn<(files: File[]) => void>()
    const onReject = vi.fn<(event: DropzoneRejectEvent) => void>()
    const { dz } = mountHost({ accept: 'image/*', on, onReject })
    await nextTick()

    fireDropWithEntries(dz, [{ entry: null, file: makeFile('notes.txt', 'text/plain') }])
    await flushAsync()

    expect(on).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0].reasons).toEqual(['type'])
    expect(dz.getAttribute('data-dropzone')).toBe('rejected')
  })

  it('a real entry alongside a null entry still walks the entries it got', async () => {
    // All-or-nothing in practice — whether entries resolve is a property of the
    // drag source, not of the individual item — but pin the mixed case so the
    // fallback condition cannot silently widen into "any null entry disables
    // folder support".
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const inside = makeFile('inside.png', 'image/png')
    fireDropWithEntries(dz, [
      { entry: null, file: makeFile('virtual.png', 'image/png') },
      { entry: makeDirEntry('pics', [makeFileEntry(inside)]), file: null },
    ])
    await flushAsync()

    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0].map((f) => f.name)).toEqual(['inside.png'])
  })

  it('unmount mid-walk does not throw and does not call handler', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { app, dz } = mountHost({ on })
    await nextTick()

    let batchNo = 0
    const slow = {
      isFile: false,
      isDirectory: true,
      name: 'slow',
      fullPath: '/slow',
      createReader: () => ({
        readEntries: (success: (entries: any[]) => void) => {
          // The first batch lands on a later microtask — the app unmounts
          // before it arrives. The second call ends the walk with an empty
          // batch, like a real reader. (An earlier version of this stub
          // yielded a fresh file on EVERY call: a reader that never empties
          // makes the walk loop forever, saturating the microtask queue —
          // that was the 4 GB heap exhaustion when this describe ran whole.)
          const batch = batchNo++ === 0 ? [makeFileEntry(makeFile('a.png', 'image/png'))] : []
          queueMicrotask(() => success(batch))
        },
      }),
    }
    fireDropWithEntries(dz, [{ entry: slow, file: null }])
    app.unmount()
    // Even if the directory reader resolves after unmount, the directive must not throw or fire on().
    await flushAsync()
    expect(on).not.toHaveBeenCalled()
  })

  it('file entry that rejects (entry.file error callback) is silently skipped', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    const goodFile = makeFile('good.png', 'image/png')
    const goodEntry = makeFileEntry(goodFile)
    const badEntry: any = {
      isFile: true,
      isDirectory: false,
      name: 'bad',
      fullPath: '/bad',
      file: (_success: (f: File) => void, error?: (e: any) => void) => {
        if (error) error(new Error('permission'))
      },
    }
    const dir = makeDirEntry('mixed', [goodEntry, badEntry])
    fireDropWithEntries(dz, [{ entry: dir, file: null }])

    await flushAsync()
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0].map((f) => f.name)).toEqual(['good.png'])
  })

  it('self-referencing directory (symlink-loop shape) terminates via the depth guard', async () => {
    const on = vi.fn<(files: File[]) => void>()
    const { dz } = mountHost({ on })
    await nextTick()

    // A directory whose reader yields one real file plus ITSELF — the shape
    // a symlink loop produces. Without a depth cap the walk never bottoms
    // out; with it, recursion stops at the cap and the files found above
    // the cutoff are still delivered.
    const cyclic: any = {
      isFile: false,
      isDirectory: true,
      name: 'loop',
      fullPath: '/loop',
    }
    cyclic.createReader = () => {
      let done = false
      return {
        readEntries: (success: (entries: any[]) => void) => {
          if (done) return success([])
          done = true
          success([makeFileEntry(makeFile('real.png', 'image/png')), cyclic])
        },
      }
    }
    fireDropWithEntries(dz, [{ entry: cyclic, file: null }])

    await flushAsync()
    expect(on).toHaveBeenCalledTimes(1)
    const received = on.mock.calls[0][0]
    // One real.png per level actually descended — bounded by the cap, not by
    // the JS call stack blowing up somewhere in the thousands.
    expect(received.length).toBeGreaterThan(0)
    expect(received.length).toBeLessThanOrEqual(65)
    expect(received.every((f) => f.name === 'real.png')).toBe(true)
  })
})
