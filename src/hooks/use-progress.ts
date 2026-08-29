'use client'

import { useCallback } from 'react'
import { progressEntryKey, readProgress, writeProgress, type ProgressMap } from '../core/progress'

const unavailableStorage: Storage = {
  get length() {
    return 0
  },
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
}

/**
 * Storage is touched only inside callbacks, never during render, so this is safe
 * during the server pass of a client component.
 *
 * Reading the global can throw where site data is blocked, and a runtime that
 * stubs the global can hand back undefined despite the Storage type, so the
 * value is checked rather than trusted.
 */
function browserStorage(): Storage {
  try {
    return window.localStorage ?? unavailableStorage
  } catch {
    return unavailableStorage
  }
}

export function useProgress(brandId: string) {
  const read = useCallback((): ProgressMap => readProgress(browserStorage(), brandId), [brandId])

  const remember = useCallback(
    (subjectId: string, groupId: string, pageIndex: number) => {
      const storage = browserStorage()
      writeProgress(storage, brandId, {
        ...readProgress(storage, brandId),
        [progressEntryKey(subjectId, groupId)]: pageIndex,
      })
    },
    [brandId],
  )

  return { read, remember }
}
