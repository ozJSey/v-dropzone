/**
 * File extraction — turning DragEvent / ClipboardEvent payloads into a flat
 * `File[]`, including the async folder-drop walk via `webkitGetAsEntry`.
 * Pure input handling; no per-element state.
 */
export function extractFiles(event: DragEvent): File[] {
  const dt = event.dataTransfer
  if (!dt) return []
  if (dt.files && dt.files.length > 0) return Array.from(dt.files)
  if (dt.items && dt.items.length > 0) {
    const out: File[] = []
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    }
    return out
  }
  return []
}

/* ------------------------------------------------------------------ */
/*  Folder-drop support via webkitGetAsEntry                          */
/* ------------------------------------------------------------------ */

/**
 * Minimal structural typing of the FileSystem Entry API. We don't pull in
 * `lib.dom.iterable` shapes because not every browser version with
 * `webkitGetAsEntry` exposes the full TS DOM-lib types — and we only read
 * a tiny surface.
 */
interface FsEntryLike {
  isFile?: boolean
  isDirectory?: boolean
  name?: string
  file?: (success: (f: File) => void, error?: (e: unknown) => void) => void
  createReader?: () => FsReaderLike
}

interface FsReaderLike {
  readEntries: (
    success: (entries: FsEntryLike[]) => void,
    error?: (e: unknown) => void,
  ) => void
}

/**
 * Inspect a drop's `dataTransfer.items` synchronously and return the entry
 * references for items that expose the FileSystem Entry API.
 *
 * Returns `null` when the walk has nothing to work with — either no item
 * carries `webkitGetAsEntry`, or every call to it came back `null`. The
 * caller then falls back to the synchronous `extractFiles` path.
 *
 * That second case is not hypothetical: the method is present on every
 * Chromium `DataTransferItem`, but it yields `null` whenever the item has no
 * filesystem backing — a synthetic `new DataTransfer()` (how automated drop
 * tests and some drag polyfills work), a drag out of a virtual folder, and
 * attachments dragged straight from a mail client all behave this way, with
 * `dataTransfer.files` populated the whole time. Returning `[]` here would
 * send the caller down the folder walk with nothing to walk and silently
 * deliver zero files.
 *
 * Critical: must capture every entry SYNCHRONOUSLY inside the drop handler.
 * The browser revokes `dataTransfer.items` access once the event handler
 * returns, so we cannot defer the `webkitGetAsEntry()` call.
 */
export function gatherDropEntries(event: DragEvent): FsEntryLike[] | null {
  const dt = event.dataTransfer
  if (!dt || !dt.items || dt.items.length === 0) return null

  const out: FsEntryLike[] = []
  for (const it of Array.from(dt.items)) {
    if (it.kind !== 'file') continue
    const fn = (it as unknown as { webkitGetAsEntry?: () => FsEntryLike | null })
      .webkitGetAsEntry
    if (typeof fn !== 'function') continue
    const entry = fn.call(it)
    if (entry) out.push(entry)
  }
  return out.length > 0 ? out : null
}

/**
 * Hard ceiling on directory recursion. Real folder trees stay far below it
 * (OS path-length limits give out first); the cap exists so a
 * self-referencing entry — the shape a symlink loop produces — terminates
 * instead of recursing until the call stack blows. Directories at the
 * cutoff resolve to no files; everything found above it is still delivered.
 */
const MAX_WALK_DEPTH = 64

/**
 * Resolve a single `FsEntryLike` to a flat `File[]`. Recurses into directories
 * via `createReader().readEntries`, looping until the reader returns an empty
 * batch (real browsers cap each call at ~100 entries — the contract is "keep
 * calling until empty"). Errors are swallowed silently — a folder the user
 * can't read is a no-op, not a crash, per the OS convention.
 */
function walkEntry(entry: FsEntryLike, depth: number): Promise<File[]> {
  if (entry.isFile && typeof entry.file === 'function') {
    return new Promise<File[]>((resolve) => {
      try {
        entry.file!(
          (f) => resolve([f]),
          () => resolve([]),
        )
      } catch {
        resolve([])
      }
    })
  }
  if (entry.isDirectory && typeof entry.createReader === 'function') {
    if (depth >= MAX_WALK_DEPTH) return Promise.resolve([])
    const reader = entry.createReader()
    const collected: Promise<File[]>[] = []
    return new Promise<File[]>((resolve) => {
      const readBatch = () => {
        try {
          reader.readEntries(
            (entries) => {
              if (!entries || entries.length === 0) {
                Promise.all(collected).then((res) => resolve(res.flat()))
                return
              }
              for (const child of entries) {
                collected.push(walkEntry(child, depth + 1))
              }
              readBatch()
            },
            () => {
              Promise.all(collected).then((res) => resolve(res.flat()))
            },
          )
        } catch {
          Promise.all(collected).then((res) => resolve(res.flat()))
        }
      }
      readBatch()
    })
  }
  return Promise.resolve([])
}

/**
 * Walk an array of entries concurrently and flatten the results, preserving
 * the top-level order so a `[top.png, dir/]` drop yields
 * `[top.png, ...filesInsideDir]`.
 */
export function walkEntries(entries: FsEntryLike[]): Promise<File[]> {
  return Promise.all(entries.map((entry) => walkEntry(entry, 0))).then((parts) => parts.flat())
}

export function extractClipboardFiles(event: ClipboardEvent): File[] {
  const dt = event.clipboardData
  if (!dt) return []
  const items = dt.items
  if (!items || items.length === 0) return []
  const out: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  return out
}
