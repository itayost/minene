import { useEffect, useRef, useState } from 'react'
import type { BrandManifest } from '../core/brand-types'
import {
  downloadPage,
  sharePage,
  whatsappUrl,
  type BrowserActionApis,
  type PageActionContext,
} from '../core/page-actions'

type ShareSheetProps = {
  context: PageActionContext
  labels: Pick<BrandManifest['labels'], 'share' | 'save' | 'whatsapp'>
  onClose: () => void
  browserApis?: BrowserActionApis
  openWindow?: typeof window.open
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
      await sharePage(context, browserApis)
      setFeedback(`${labels.share} ✓`)
    } catch {
      setFeedback(`${labels.share} ⚠`)
    }
  }

  const completeDownload = async () => {
    setFeedback(null)
    try {
      await downloadPage(context, browserApis)
      setFeedback(`${labels.save} ✓`)
    } catch {
      setFeedback(`${labels.save} ⚠`)
    }
  }

  const openWhatsApp = () => {
    setFeedback(null)
    try {
      const popup = (openWindow ?? window.open.bind(window))(whatsappUrl(context), '_blank', 'noopener,noreferrer')
      if (popup === null) throw new Error('WhatsApp popup was blocked')
      setFeedback(`${labels.whatsapp} ✓`)
    } catch {
      setFeedback(`${labels.whatsapp} ⚠`)
    }
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
