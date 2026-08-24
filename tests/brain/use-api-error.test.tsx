import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/minene/tools/brain/lobby',
}))

const { useApiErrorHandler } = await import('../../src/brain/use-api-error')
const { RulesApiError } = await import('../../src/brain/rules-api')
const { DocumentsApiError } = await import('../../src/brain/documents-api')

describe('useApiErrorHandler', () => {
  it('sends an expired session to sign in, preserving where they were', () => {
    replace.mockClear()
    const { result } = renderHook(() => useApiErrorHandler())

    const message = result.current(new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.'))

    expect(replace).toHaveBeenCalledWith('/login?next=%2Fminene%2Ftools%2Fbrain%2Flobby')
    expect(message).toBeNull()
  })

  it('treats a documents-layer expiry the same way', () => {
    replace.mockClear()
    const { result } = renderHook(() => useApiErrorHandler())

    const message = result.current(new DocumentsApiError('UNAUTHORIZED', 'ההרשאה פגה. נא להתחבר מחדש.'))

    expect(replace).toHaveBeenCalled()
    expect(message).toBeNull()
  })

  it('returns the message for an ordinary failure without redirecting', () => {
    replace.mockClear()
    const { result } = renderHook(() => useApiErrorHandler())

    const message = result.current(new RulesApiError('REQUEST_FAILED', 500, 'לא הצלחנו להשלים את הבקשה'))

    expect(replace).not.toHaveBeenCalled()
    expect(message).toBe('לא הצלחנו להשלים את הבקשה')
  })

  it('surfaces a documents-layer failure message as written', () => {
    replace.mockClear()
    const { result } = renderHook(() => useApiErrorHandler())

    expect(result.current(new DocumentsApiError('UPLOAD_FAILED', 'העלאת הקובץ נכשלה. נסי שוב.')))
      .toBe('העלאת הקובץ נכשלה. נסי שוב.')
  })

  it('returns a generic Hebrew message for an unrecognised throw', () => {
    replace.mockClear()
    const { result } = renderHook(() => useApiErrorHandler())

    // Never leaks a raw Error message to a reader: it would be English, and
    // usually a stack-shaped string they cannot act on.
    expect(result.current(new Error('boom'))).toBe('לא הצלחנו להשלים את הבקשה')
  })
})
