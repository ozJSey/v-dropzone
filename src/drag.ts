/**
 * Drag wiring — the four listeners with the enter/leave depth counter (the
 * only signal that survives child-traversal phantom leaves), the mandatory
 * `dragover` preventDefault, and the folder-aware drop path.
 */
import { extractFiles, gatherDropEntries, walkEntries } from './files'
import { processFiles } from './process'
import {
  clearRejectTimer,
  nonDragRestState,
  setState,
  stateMap,
  type DropzoneInstance,
  type Listeners,
} from './state'

export function createDragListeners(el: HTMLElement, instance: DropzoneInstance): Listeners {
  const dragenter = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    clearRejectTimer(instance)
    instance.dragDepth += 1
    if (instance.dragDepth === 1) setState(el, instance, 'active')
  }

  const dragover = (event: DragEvent): void => {
    // MUST preventDefault or the drop event never fires.
    event.preventDefault()
    event.stopPropagation()
  }

  const dragleave = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (instance.dragDepth > 0) {
      instance.dragDepth -= 1
      if (instance.dragDepth === 0) setState(el, instance, nonDragRestState(instance))
    }
  }

  const drop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    instance.dragDepth = 0

    // Folder-drop path: when the browser exposes the FileSystem Entry API on
    // any dropped item we walk asynchronously so folders flatten into their
    // contained files. The entries themselves MUST be captured synchronously
    // (DataTransfer is revoked after the handler returns).
    const entries = gatherDropEntries(event)
    if (entries !== null) {
      walkEntries(entries).then((files) => {
        // Guard: directive may have been detached or replaced mid-walk.
        if (stateMap.get(el) !== instance) return
        processFiles(el, instance, files)
      })
      return
    }

    const files = extractFiles(event)
    processFiles(el, instance, files)
  }

  return { dragenter, dragover, dragleave, drop }
}
