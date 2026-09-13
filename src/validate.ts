/**
 * Validation — the `accept` pattern matcher and the per-file vs drop-level
 * rule split (`type`/`size` are per-file; `count` rejects the whole drop),
 * with reasons reported in canonical order.
 */
import type { DropzoneOptions, DropzoneRejectReason } from './types'

const REASON_ORDER: DropzoneRejectReason[] = ['type', 'size', 'count']

/** True if `file` matches at least one pattern in the comma-separated `accept` string. */
export function matchesAccept(file: File, accept: string): boolean {
  const patterns = accept
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (patterns.length === 0) return true

  // Strip MIME parameters: `text/plain;charset=utf-8` → `text/plain`.
  const rawType = file.type.toLowerCase()
  const semi = rawType.indexOf(';')
  const type = (semi === -1 ? rawType : rawType.slice(0, semi)).trim()
  const name = file.name.toLowerCase()

  for (const pattern of patterns) {
    if (pattern.startsWith('.')) {
      if (name.endsWith(pattern)) return true
      continue
    }
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1)
      if (type !== '' && type.startsWith(prefix)) return true
      continue
    }
    if (type !== '' && type === pattern) return true
  }
  return false
}

export type ValidationResult = {
  accepted: File[]
  rejected: File[]
  reasons: DropzoneRejectReason[]
}

export function validate(files: File[], opts: DropzoneOptions): ValidationResult {
  const tooMany = opts.multiple === false && files.length > 1
  const overCount = typeof opts.maxCount === 'number' && files.length > opts.maxCount
  const countFailed = tooMany || overCount

  const reasonSet = new Set<DropzoneRejectReason>()
  if (countFailed) reasonSet.add('count')

  const accepted: File[] = []
  const rejected: File[] = []

  for (const file of files) {
    const failsType = typeof opts.accept === 'string' && !matchesAccept(file, opts.accept)
    const failsSize = typeof opts.maxSize === 'number' && file.size > opts.maxSize

    if (failsType) reasonSet.add('type')
    if (failsSize) reasonSet.add('size')

    if (countFailed || failsType || failsSize) rejected.push(file)
    else accepted.push(file)
  }

  return {
    accepted,
    rejected,
    reasons: REASON_ORDER.filter((r) => reasonSet.has(r)),
  }
}
