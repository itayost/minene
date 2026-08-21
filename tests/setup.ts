import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  try {
    window.localStorage.clear()
  } catch {
    // Tests exercise unavailable browser storage; cleanup must tolerate it too.
  }
  vi.restoreAllMocks()
})
