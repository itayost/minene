'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { DocumentsApiError } from './documents-api'
import { RulesApiError } from './rules-api'

const GENERIC_MESSAGE = 'לא הצלחנו להשלים את הבקשה'

/**
 * Turns a thrown API error into something the reader can act on.
 *
 * An expired session is the case that needs special handling. The middleware
 * refreshes the cookie on navigation, but these screens make requests without
 * navigating -- polling an extraction, starring a rule -- so a long idle session
 * can expire in place where the middleware never sees it. Showing "ההרשאה פגה"
 * as text would leave the reader stuck on a page whose every action now fails;
 * sending them to sign in, with `next` pointing back here, gets them home again.
 *
 * Everything else returns its own message, which the API layers already write in
 * Hebrew. An unrecognised throw returns the generic message rather than its own:
 * a raw Error carries English, often stack-shaped, text that no reader can use.
 */
export function useApiErrorHandler(): (error: unknown) => string | null {
  const router = useRouter()
  const pathname = usePathname()

  return useCallback(
    (error: unknown): string | null => {
      const isExpired =
        (error instanceof RulesApiError || error instanceof DocumentsApiError) &&
        error.code === 'UNAUTHORIZED'

      if (isExpired) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`)
        return null
      }

      if (error instanceof RulesApiError || error instanceof DocumentsApiError) {
        return error.message
      }

      return GENERIC_MESSAGE
    },
    [pathname, router],
  )
}
