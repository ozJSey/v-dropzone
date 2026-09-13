/**
 * Paste — the clipboard listener on the host or document (per `pasteOn`),
 * feeding the shared pipeline. The attach target is remembered so teardown
 * removes from wherever the listener actually went.
 */
import { extractClipboardFiles } from './files'
import { processFiles } from './process'
import type { DropzoneInstance } from './state'
import type { DropzoneOptions } from './types'

function resolvePasteTarget(el: HTMLElement, opts: DropzoneOptions): HTMLElement | Document {
  return opts.pasteOn === 'document' ? document : el
}

export function setupPaste(el: HTMLElement, instance: DropzoneInstance): void {
  if (instance.pasteListener) return

  const handler = (event: ClipboardEvent): void => {
    const files = extractClipboardFiles(event)
    if (files.length === 0) return
    event.preventDefault()
    processFiles(el, instance, files)
  }

  const target = resolvePasteTarget(el, instance.opts)
  target.addEventListener('paste', handler as EventListener)
  instance.pasteListener = handler
  instance.pasteTarget = target
}

export function teardownPaste(instance: DropzoneInstance): void {
  if (!instance.pasteListener || !instance.pasteTarget) return
  instance.pasteTarget.removeEventListener('paste', instance.pasteListener as EventListener)
  instance.pasteListener = null
  instance.pasteTarget = null
}
