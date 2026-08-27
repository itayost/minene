import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../../src/brain/BottomSheet'

/**
 * Both fields are CONTROLLED, which is load-bearing rather than incidental: the
 * focus bug this primitive guards against needs a re-render per keystroke to
 * appear, and an uncontrolled input causes none. A harness built with
 * uncontrolled fields passes whether the bug is present or not -- checked by
 * putting onDismiss back in the effect's deps and watching the test stay green.
 *
 * Every real caller is controlled, because every real caller lifts its draft.
 */
function Harness({ onDismiss = vi.fn() }: { onDismiss?: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [response, setResponse] = useState('')
  const fieldRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button onClick={() => setOpenKey('rule-1')} type="button">פתיחה</button>
      <BottomSheet
        initialFocusRef={fieldRef}
        label="עריכת חוק"
        onDismiss={() => { setOpenKey(null); onDismiss() }}
        openKey={openKey}
      >
        <input
          aria-label="נוסח"
          onChange={(event) => setText(event.target.value)}
          ref={fieldRef}
          type="text"
          value={text}
        />
        <input
          aria-label="תגובה"
          onChange={(event) => setResponse(event.target.value)}
          type="text"
          value={response}
        />
      </BottomSheet>
    </>
  )
}

describe('the bottom sheet', () => {
  it('renders nothing until something opens it', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves focus into the sheet when it opens', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))

    expect(screen.getByLabelText('נוסח')).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<Harness onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))
    await user.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalled()
  })

  it('closes when the backdrop is pressed', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<Harness onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))
    await user.click(screen.getByRole('button', { name: 'סגירה' }))

    expect(onDismiss).toHaveBeenCalled()
  })

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'פתיחה' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    // Without this a keyboard user is dropped at the top of the document every
    // time a sheet closes, and has to tab back to where they were.
    expect(trigger).toHaveFocus()
  })

  it('keeps Tab inside itself, which is what aria-modal promises', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))

    // Nothing makes the page behind a sheet inert, so without a trap a keyboard
    // user tabs straight out of the "modal" into the list underneath while the
    // backdrop still covers it -- and cannot see where their focus went.
    await user.tab()
    await user.tab()
    await user.tab()

    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  })

  it('does not steal focus back while a second field is being typed in', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))
    await user.type(screen.getByLabelText('תגובה'), 'אב')

    // The bug this primitive exists to prevent: onDismiss in the effect's
    // dependency list tears the effect down every render and re-fires the
    // initial focus, so the second character lands in the first field. It is
    // invisible while a sheet has one field. This one has two.
    expect(screen.getByLabelText('תגובה')).toHaveValue('אב')
    expect(screen.getByLabelText('נוסח')).toHaveValue('')
  })
})
