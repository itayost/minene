import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ContentGroup, Direction, PageAsset } from '../core/brand-types'

type PageViewerProps = {
  group: ContentGroup
  pageIndex: number
  direction: Direction
  onPageChange: (index: number) => void
  onShare: () => void
}

type PointerOrigin = {
  pointerId: number
  x: number
  y: number
}

type ImageStatus = 'loading' | 'loaded' | 'error'

const SWIPE_THRESHOLD = 55
const HORIZONTAL_DOMINANCE = 1.4

function PageImage({ page }: { page: PageAsset }) {
  const [status, setStatus] = useState<ImageStatus>('loading')
  const [retryAttempt, setRetryAttempt] = useState(0)

  const retryImage = () => {
    setStatus('loading')
    setRetryAttempt((attempt) => attempt + 1)
  }

  return (
    <div className="page-viewer__scroll">
      {status === 'loading' ? (
        <div className="page-viewer__loading" role="progressbar" aria-label={`Loading ${page.alt}`}>
          <span className="page-viewer__spinner" aria-hidden="true" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="page-viewer__error" role="alert">
          <p>{page.alt}</p>
          <button type="button" onClick={retryImage}>Retry loading {page.alt}</button>
        </div>
      ) : (
        <img
          key={retryAttempt}
          className="page-viewer__image"
          src={page.src}
          alt={page.alt}
          onError={() => setStatus('error')}
          onLoad={() => setStatus('loaded')}
        />
      )}
    </div>
  )
}

export function PageViewer({ group, pageIndex, direction, onPageChange, onShare: _onShare }: PageViewerProps) {
  const pointerOrigin = useRef<PointerOrigin | null>(null)
  const pageCount = group.pages.length
  const currentIndex = Number.isInteger(pageIndex)
    ? Math.max(0, Math.min(pageCount - 1, pageIndex))
    : 0
  const currentPage = group.pages[currentIndex]

  if (!currentPage) {
    return (
      <section className="page-viewer page-viewer--empty" aria-label={`${group.label} page viewer`}>
        <p>No pages available</p>
      </section>
    )
  }

  const requestPage = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= pageCount || nextIndex === currentIndex) return
    onPageChange(nextIndex)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

    const movesForward = direction === 'rtl'
      ? event.key === 'ArrowLeft'
      : event.key === 'ArrowRight'
    requestPage(currentIndex + (movesForward ? 1 : -1))
    event.preventDefault()
  }

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
    pointerOrigin.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const origin = pointerOrigin.current
    pointerOrigin.current = null
    if (!origin || origin.pointerId !== event.pointerId) return

    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (Math.abs(dx) <= SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_DOMINANCE) return

    requestPage(currentIndex + (dx < 0 ? 1 : -1))
  }

  return (
    <section
      className="page-viewer"
      aria-label={`${group.label} page viewer`}
      onKeyDown={handleKeyDown}
      onPointerCancel={() => { pointerOrigin.current = null }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      role="region"
      tabIndex={0}
    >
      <PageImage key={currentPage.src} page={currentPage} />

      <footer className="page-viewer__footer">
        <span className="page-viewer__count" aria-live="polite">{currentIndex + 1} / {pageCount}</span>
        <div className="page-viewer__indicators" aria-label={`Choose a page in ${group.label}`} role="group">
          {group.pages.map((page, index) => (
            <button
              className="page-viewer__indicator"
              key={`${page.src}-${index}`}
              type="button"
              aria-current={index === currentIndex ? 'page' : undefined}
              aria-label={`Go to page ${index + 1} of ${pageCount}`}
              onClick={() => requestPage(index)}
            />
          ))}
        </div>
      </footer>
    </section>
  )
}
