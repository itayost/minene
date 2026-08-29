import { describe, expect, test } from 'vitest'
import { mineneBrand } from '../src/brands/minene'
import {
  progressEntryKey,
  progressStorageKey,
  readProgress,
  writeProgress,
} from '../src/core/progress'
import { MemoryStorage } from './fixtures/memory-storage'

describe('progress persistence', () => {
  test('namespaces progress by schema version and brand ID', () => {
    expect(progressStorageKey('minene')).toBe('content-viewer.progress.v1.minene')
  })

  test('round-trips valid progress by subject/group key', () => {
    const storage = new MemoryStorage()
    const progress = { [progressEntryKey('results', 'overview')]: 2 }
    writeProgress(storage, 'minene', progress)
    expect(storage.getItem('content-viewer.progress.v1.minene')).toBe('{"results/overview":2}')
    expect(readProgress(storage, 'minene')).toEqual(progress)
  })

  test('returns empty progress for malformed JSON', () => {
    const storage = new MemoryStorage()
    storage.setItem(progressStorageKey('minene'), '{not json')
    expect(readProgress(storage, 'minene')).toEqual({})
  })

  test('discards negative, non-integer, non-number, and non-finite values', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      progressStorageKey('minene'),
      JSON.stringify({
        negative: -1,
        decimal: 1.5,
        text: '2',
        infinity: null,
        valid: 3,
      }),
    )
    expect(readProgress(storage, 'minene')).toEqual({ valid: 3 })
  })

  test('never returns progress stored for another brand', () => {
    const storage = new MemoryStorage()
    writeProgress(storage, mineneBrand.id, { 'tasks/daily-tasks': 2 })
    expect(readProgress(storage, 'different-brand')).toEqual({})
  })

  test('sanitizes values before persisting progress', () => {
    const storage = new MemoryStorage()

    writeProgress(storage, 'minene', {
      valid: 3,
      negative: -1,
      decimal: 1.5,
      infinite: Number.POSITIVE_INFINITY,
    })

    expect(storage.getItem(progressStorageKey('minene'))).toBe('{"valid":3}')
  })

  test('catches storage read and write exceptions', () => {
    const failingStorage = {
      getItem: () => {
        throw new Error('security')
      },
      setItem: () => {
        throw new Error('quota')
      },
    } as unknown as Storage
    expect(readProgress(failingStorage, 'minene')).toEqual({})
    expect(() => writeProgress(failingStorage, 'minene', { 'tasks/daily-tasks': 1 })).not.toThrow()
  })
})
