export type ProgressMap = Record<string, number>

const PROGRESS_PREFIX = 'content-viewer.progress.v1.'

export function progressEntryKey(subjectId: string, groupId: string): string {
  return `${subjectId}/${groupId}`
}

export function progressStorageKey(brandId: string): string {
  return `${PROGRESS_PREFIX}${brandId}`
}

function isValidPageIndex(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  )
}

function sanitizeProgress(value: unknown): ProgressMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  const sanitized: ProgressMap = {}
  for (const [key, pageIndex] of Object.entries(value)) {
    if (key === '__proto__' || !isValidPageIndex(pageIndex)) continue
    sanitized[key] = pageIndex
  }
  return sanitized
}

export function readProgress(storage: Storage, brandId: string): ProgressMap {
  try {
    const serialized = storage.getItem(progressStorageKey(brandId))
    if (serialized === null) return {}
    return sanitizeProgress(JSON.parse(serialized) as unknown)
  } catch {
    return {}
  }
}

export function writeProgress(storage: Storage, brandId: string, progress: ProgressMap): void {
  try {
    storage.setItem(progressStorageKey(brandId), JSON.stringify(sanitizeProgress(progress)))
  } catch {
    // Storage can be disabled or full. Progress is an enhancement, not a reason to fail navigation.
  }
}
