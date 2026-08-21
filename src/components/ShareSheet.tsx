import { useEffect, useRef, useState } from 'react'
import type { BrandManifest } from '../core/brand-types'
import {
  downloadPage,
  openExternalWindow,
  sharePage,
  whatsappUrl,
  type BrowserActionApis,
  type OpenExternalWindow,
  type PageActionContext,
} from '../core/page-actions'

type ShareSheetProps = {
  context: PageActionContext
  labels: Pick<BrandManifest['labels'], 'share' | 'save' | 'whatsapp' | 'feedback'>
  onClose: () => void
  browserApis?: BrowserActionApis
  openWindow?: OpenExternalWindow
}

export function ShareSheet({ context, labels, onClose, browserApis, openWindow }: ShareSheetProps) {
  const shareButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  const [feedback, setFeedback] = useState<string | null>(null)

  closeRef.current = onClose

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    shareButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      previousFocusRef.current?.focus()
    }
  }, [])

  const completeShare = async () => {
    setFeedback(null)
    try {
      const outcome = await sharePage(context, browserApis)
      setFeedback({
        file: labels.feedback.sharedFile,
        url: labels.feedback.sharedUrl,
        copied: labels.feedback.copied,
      }[outcome])
    } catch {
      setFeedback(labels.feedback.shareFailed)
    }
  }

  const completeDownload = async () => {
    setFeedback(null)
    try {
      await downloadPage(context, browserApis)
      setFeedback(labels.feedback.saved)
    } catch {
      setFeedback(labels.feedback.saveFailed)
    }
  }

  const openWhatsApp = () => {
    setFeedback(null)
    const outcome = openExternalWindow(whatsappUrl(context), openWindow)
    setFeedback({
      opened: labels.feedback.whatsappOpened,
      blocked: labels.feedback.whatsappBlocked,
      failed: labels.feedback.whatsappFailed,
    }[outcome])
  }

  return (
    <div
      className="share-sheet-overlay"
      data-testid="share-sheet-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section aria-labelledby="share-sheet-title" aria-modal="true" className="share-sheet" role="dialog">
        <h2 id="share-sheet-title">{context.groupName}</h2>
        <div className="share-sheet__actions">
          <button ref={shareButtonRef} type="button" onClick={completeShare}>{labels.share}</button>
          <button type="button" onClick={completeDownload}>{labels.save}</button>
          <button type="button" onClick={openWhatsApp}>{labels.whatsapp}</button>
        </div>
        <p aria-live="polite" className="share-sheet__feedback" role="status">
          {feedback}
        </p>
      </section>
    </div>
  )
}
