import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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
  const imageRef = useRef<HTMLImageElement>(null)
  const [status, setStatus] = useState<ImageStatus>('loading')

  // The page now arrives in server-rendered HTML, so the browser can finish with
  // the image before React attaches onLoad and onError. Neither event fires
  // late, and the loading overlay is opaque, so the spinner would sit over a
  // settled image forever. A settled image is recognised here instead of waited
  // for: complete means the browser is done, and no intrinsic width means it is
  // done because the load failed.
  useEffect(() => {
    const image = imageRef.current
    if (status !== 'loading' || !image?.complete) return
    setStatus(image.naturalWidth === 0 ? 'error' : 'loaded')
  }, [status])

  const retryImage = () => setStatus('loading')

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
          <button type="button" onClick={retryImage}>
            Retry loading {page.alt}
          </button>
        </div>
      ) : (
        <img
          ref={imageRef}
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

export function PageViewer({
  group,
  pageIndex,
  direction,
  onPageChange,
  onShare: _onShare,
}: PageViewerProps) {
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

    const movesForward =
      direction === 'rtl' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight'
    requestPage(currentIndex + (movesForward ? 1 : -1))
    event.preventDefault()
  }

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
    if (event.target instanceof Element && event.target.closest('button')) return

    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointerOrigin.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const origin = pointerOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) return

    pointerOrigin.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (Math.abs(dx) <= SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_DOMINANCE)
      return

    requestPage(currentIndex + (dx < 0 ? 1 : -1))
  }

  const handlePointerCancel = (event: PointerEvent<HTMLElement>) => {
    const origin = pointerOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) return

    pointerOrigin.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const handleLostPointerCapture = (event: PointerEvent<HTMLElement>) => {
    if (pointerOrigin.current?.pointerId === event.pointerId) pointerOrigin.current = null
  }

  return (
    <section
      className="page-viewer"
      aria-label={`${group.label} page viewer`}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      role="region"
      tabIndex={0}
    >
      <PageImage key={currentPage.src} page={currentPage} />

      <footer className="page-viewer__footer">
        <span className="page-viewer__count" aria-live="polite">
          {currentIndex + 1} / {pageCount}
        </span>
        <div
          className="page-viewer__indicators"
          aria-label={`Choose a page in ${group.label}`}
          role="group"
        >
          {group.pages.map((page, index) => (
            <button
              className="page-viewer__indicator"
              key={`${page.src}-${index}`}
              type="button"
              aria-current={index === currentIndex ? 'page' : undefined}
              aria-label={`Go to page ${index + 1} of ${pageCount}`}
              onClick={() => requestPage(index)}
            >
              <span className="page-viewer__indicator-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
      </footer>
    </section>
  )
}
