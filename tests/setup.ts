import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { MemoryStorage } from './fixtures/memory-storage'

// Node 26 installs its own experimental localStorage on the global object. It
// returns undefined unless --localstorage-file is passed, and because vitest's
// jsdom environment shares that global, it shadows the storage jsdom provides.
// Anything reading window.localStorage would therefore see undefined here and
// nowhere else, so browser-like storage is restored when it is missing.
if (window.localStorage === undefined) {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  cleanup()
  try {
    window.localStorage.clear()
  } catch {
    // Tests exercise unavailable browser storage; cleanup must tolerate it too.
  }
  vi.restoreAllMocks()
})
