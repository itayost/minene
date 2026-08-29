'use client'

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'

/**
 * Anything with a focus method.
 *
 * Not `RefObject<HTMLElement | null>`: `RefObject<T>` has a mutable `current`
 * and is therefore invariant, so a `useRef<HTMLTextAreaElement>(null)` from a
 * caller would not be assignable to it. What this needs is the capability, not
 * the element type.
 */
type FocusRef = { current: { focus: () => void } | null }

/**
 * The dismissal behaviour every sheet in this app shares: Escape closes it,
 * focus moves into it on open, and focus returns to whatever opened it on
 * close -- without which a keyboard user is dropped at the top of the document
 * every time a sheet closes.
 *
 * `openKey` is the identity of what is open, not a boolean. The effect re-runs
 * when the key changes, so a sheet swapped straight from one subject to another
 * re-focuses for the new one. A boolean would not change across that swap and
 * the effect would not re-run.
 */
export function BottomSheet({
  openKey,
  label,
  onDismiss,
  initialFocusRef,
  children,
}: {
  openKey: string | null
  label: string
  onDismiss: () => void
  initialFocusRef?: FocusRef
  children: ReactNode
}): ReactElement | null {
  // Held in a ref and deliberately NOT a dependency below. Callers pass inline
  // arrows, so the identity changes every render, and with it in the list the
  // effect tears down and re-runs on every render of the open sheet. That is
  // not merely wasteful: re-running re-fires the initial focus, so focus is
  // yanked back to the first field after every keystroke anywhere else in the
  // sheet. Invisible while a sheet has one field; not invisible now.
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const focusRef = useRef(initialFocusRef)
  focusRef.current = initialFocusRef

  const sheetRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!openKey) return undefined

    const trigger = document.activeElement as HTMLElement | null

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismissRef.current()
        return
      }
      if (event.key !== 'Tab') return

      // aria-modal is a promise, and nothing here makes the page behind the
      // sheet inert -- so without this a keyboard user tabs straight out into
      // the list underneath while the backdrop still covers it, with no way to
      // see where their focus went.
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      // Wrapping rather than blocking: Tab past the end returns to the start and
      // Shift+Tab before the start goes to the end, which is what a real dialog
      // does. Blocking would strand somebody at the last control.
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    focusRef.current?.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
    // openKey alone: opening, closing and swapping subject are the only three
    // events that should move focus.
  }, [openKey])

  if (!openKey) return null

  return (
    <div className="action-sheet-layer">
      {/* A button, not a div with onClick: it has to be reachable and pressable
          without a pointer, and it is the only dismissal a screen-reader user
          can find by touch exploration. */}
      <button
        aria-label="סגירה"
        className="action-sheet__backdrop"
        onClick={onDismiss}
        type="button"
      />
      <section
        aria-label={label}
        aria-modal="true"
        className="bottom-sheet"
        dir="rtl"
        ref={sheetRef}
        role="dialog"
      >
        {children}
      </section>
    </div>
  )
}
