import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { progressStorageKey } from '../src/core/progress'
import { useProgress } from '../src/hooks/use-progress'

describe('useProgress', () => {
  it('remembers a page for a brand, subject, and group', () => {
    const { result } = renderHook(() => useProgress('demo'))

    result.current.remember('multiple', 'group-one', 2)

    expect(JSON.parse(window.localStorage.getItem(progressStorageKey('demo'))!)).toEqual({
      'multiple/group-one': 2,
    })
  })

  it('reads back what it remembered', () => {
    const { result } = renderHook(() => useProgress('demo'))
    result.current.remember('multiple', 'group-one', 2)

    expect(result.current.read()).toEqual({ 'multiple/group-one': 2 })
  })

  it('keeps entries for other groups when remembering a new one', () => {
    const { result } = renderHook(() => useProgress('demo'))

    result.current.remember('multiple', 'group-one', 2)
    result.current.remember('multiple', 'group-two', 1)

    expect(result.current.read()).toEqual({ 'multiple/group-one': 2, 'multiple/group-two': 1 })
  })

  it('returns an empty map when nothing has been remembered', () => {
    const { result } = renderHook(() => useProgress('demo'))

    expect(result.current.read()).toEqual({})
  })
})
