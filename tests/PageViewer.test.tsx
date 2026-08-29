/// <reference types="vite/client" />

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PageViewer } from '../src/components/PageViewer'
import type { ContentGroup, Direction } from '../src/core/brand-types'
import '../src/styles.css'

const group: ContentGroup = {
  id: 'welcome',
  label: 'Welcome guide',
  pages: [
    { src: '/pages/first.png', alt: 'First welcome page' },
    { src: '/pages/second.png', alt: 'Second welcome page' },
    { src: '/pages/third.png', alt: 'Third welcome page' },
  ],
}

const eightPageGroup: ContentGroup = {
  id: 'eight-pages',
  label: 'Eight page guide',
  pages: Array.from({ length: 8 }, (_, index) => ({
    src: `/pages/page-${index + 1}.png`,
    alt: `Page ${index + 1}`,
  })),
}

function renderViewer({
  pageIndex = 0,
  direction = 'ltr',
  onPageChange = vi.fn(),
}: {
  pageIndex?: number
  direction?: Direction
  onPageChange?: (index: number) => void
} = {}) {
  return render(
    <PageViewer
      group={group}
      pageIndex={pageIndex}
      direction={direction}
      onPageChange={onPageChange}
      onShare={() => undefined}
    />,
  )
}

function observePointerCapture(element: HTMLElement) {
  const setPointerCapture = vi.fn()
  const releasePointerCapture = vi.fn()
  Object.defineProperties(element, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  })
  return { setPointerCapture, releasePointerCapture }
}

describe('PageViewer', () => {
  it('shows the selected page, page count, and accessible indicators', () => {
    renderViewer()

    expect(screen.getByRole('img', { name: 'First welcome page' })).toHaveAttribute(
      'src',
      '/pages/first.png',
    )
    expect(screen.getByText('1 / 3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Go to page 1 of 3' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: 'Go to page 2 of 3' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('gives every indicator a 44px hit area around its compact visual dot', () => {
    renderViewer()
    const currentButton = screen.getByRole('button', { name: 'Go to page 1 of 3' })
    const inactiveButton = screen.getByRole('button', { name: 'Go to page 2 of 3' })

    expect(Number.parseFloat(getComputedStyle(currentButton).width)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(getComputedStyle(currentButton).height)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(getComputedStyle(inactiveButton).width)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(getComputedStyle(inactiveButton).height)).toBeGreaterThanOrEqual(44)

    const currentDot = currentButton.querySelector('[aria-hidden="true"]')
    const inactiveDot = inactiveButton.querySelector('[aria-hidden="true"]')
    expect(currentDot).not.toBeNull()
    expect(inactiveDot).not.toBeNull()
    expect(getComputedStyle(currentDot!).width).toBe('20px')
    expect(getComputedStyle(currentDot!).height).toBe('7px')
    expect(getComputedStyle(inactiveDot!).width).toBe('7px')
    expect(getComputedStyle(inactiveDot!).height).toBe('7px')
  })

  it('wraps eight 44px indicators within the available phone width', () => {
    render(
      <div style={{ width: '360px' }}>
        <PageViewer
          group={eightPageGroup}
          pageIndex={0}
          direction="ltr"
          onPageChange={() => undefined}
          onShare={() => undefined}
        />
      </div>,
    )

    const indicators = screen.getByRole('group', { name: 'Choose a page in Eight page guide' })
    expect(getComputedStyle(indicators).flexWrap).toBe('wrap')
    expect(getComputedStyle(indicators).maxWidth).toBe('100%')
    for (const button of screen.getAllByRole('button', { name: /Go to page .* of 8/ })) {
      expect(Number.parseFloat(getComputedStyle(button).width)).toBeGreaterThanOrEqual(44)
      expect(Number.parseFloat(getComputedStyle(button).height)).toBeGreaterThanOrEqual(44)
    }
  })

  it('mirrors screen-entry motion for RTL viewers', () => {
    render(
      <div dir="rtl">
        <PageViewer
          group={group}
          pageIndex={0}
          direction="rtl"
          onPageChange={() => undefined}
          onShare={() => undefined}
        />
      </div>,
    )

    expect(
      getComputedStyle(screen.getByRole('region', { name: 'Welcome guide page viewer' }))
        .getPropertyValue('--screen-enter-x')
        .trim(),
    ).toBe('8%')
  })

  it('requests the page selected with an indicator', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    renderViewer({ onPageChange })

    await user.click(screen.getByRole('button', { name: 'Go to page 3 of 3' }))

    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it.each([
    { direction: 'ltr' as const, pageIndex: 1, key: 'ArrowRight', expected: 2 },
    { direction: 'ltr' as const, pageIndex: 1, key: 'ArrowLeft', expected: 0 },
    { direction: 'rtl' as const, pageIndex: 1, key: 'ArrowLeft', expected: 2 },
    { direction: 'rtl' as const, pageIndex: 1, key: 'ArrowRight', expected: 0 },
  ])('maps $key to the visual page direction in $direction', ({
    direction,
    pageIndex,
    key,
    expected,
  }) => {
    const onPageChange = vi.fn()
    renderViewer({ direction, pageIndex, onPageChange })

    fireEvent.keyDown(screen.getByRole('region', { name: 'Welcome guide page viewer' }), { key })

    expect(onPageChange).toHaveBeenCalledWith(expected)
  })

  it('moves one page after a horizontal pointer gesture beyond the threshold', () => {
    const onPageChange = vi.fn()
    renderViewer({ pageIndex: 1, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })

    fireEvent.pointerDown(viewer, { clientX: 120, clientY: 20, isPrimary: true, pointerId: 1 })
    fireEvent.pointerUp(viewer, { clientX: 64, clientY: 25, isPrimary: true, pointerId: 1 })

    expect(onPageChange).toHaveBeenCalledOnce()
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('does not swipe at exactly the 55px distance boundary', () => {
    const onPageChange = vi.fn()
    renderViewer({ pageIndex: 1, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })

    fireEvent.pointerDown(viewer, { clientX: 100, clientY: 20, isPrimary: true, pointerId: 12 })
    fireEvent.pointerUp(viewer, { clientX: 45, clientY: 20, isPrimary: true, pointerId: 12 })

    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('does not swipe at exactly the 1.4 horizontal-dominance boundary', () => {
    const onPageChange = vi.fn()
    renderViewer({ pageIndex: 1, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })

    fireEvent.pointerDown(viewer, { clientX: 100, clientY: 100, isPrimary: true, pointerId: 13 })
    fireEvent.pointerUp(viewer, { clientX: 30, clientY: 150, isPrimary: true, pointerId: 13 })

    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('captures and releases the active pointer on a completed gesture', () => {
    renderViewer({ pageIndex: 1 })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })
    const capture = observePointerCapture(viewer)

    fireEvent.pointerDown(viewer, { clientX: 120, clientY: 20, isPrimary: true, pointerId: 8 })
    expect(capture.setPointerCapture).toHaveBeenCalledWith(8)

    fireEvent.pointerUp(viewer, { clientX: 64, clientY: 25, isPrimary: true, pointerId: 8 })
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(8)
  })

  it('clears and releases a cancelled gesture before a later pointer up', () => {
    const onPageChange = vi.fn()
    renderViewer({ pageIndex: 1, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })
    const capture = observePointerCapture(viewer)

    fireEvent.pointerDown(viewer, { clientX: 120, clientY: 20, isPrimary: true, pointerId: 9 })
    fireEvent.pointerCancel(viewer, { isPrimary: true, pointerId: 9 })
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(9)

    fireEvent.pointerUp(viewer, { clientX: 20, clientY: 20, isPrimary: true, pointerId: 9 })
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('clears a gesture when pointer capture is lost', () => {
    const onPageChange = vi.fn()
    renderViewer({ pageIndex: 1, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })
    observePointerCapture(viewer)

    fireEvent.pointerDown(viewer, { clientX: 120, clientY: 20, isPrimary: true, pointerId: 10 })
    fireEvent.lostPointerCapture(viewer, { isPrimary: true, pointerId: 10 })
    fireEvent.pointerUp(viewer, { clientX: 20, clientY: 20, isPrimary: true, pointerId: 10 })

    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('does not begin a gesture from an indicator button', () => {
    const onPageChange = vi.fn()
    renderViewer({ pageIndex: 1, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })
    const indicator = screen.getByRole('button', { name: 'Go to page 2 of 3' })
    const capture = observePointerCapture(viewer)

    fireEvent.pointerDown(indicator, { clientX: 120, clientY: 20, isPrimary: true, pointerId: 11 })
    fireEvent.pointerUp(viewer, { clientX: 20, clientY: 20, isPrimary: true, pointerId: 11 })

    expect(capture.setPointerCapture).not.toHaveBeenCalled()
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('ignores a gesture whose vertical movement dominates', () => {
    const onPageChange = vi.fn()
    renderViewer({ pageIndex: 1, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })

    fireEvent.pointerDown(viewer, { clientX: 120, clientY: 20, isPrimary: true, pointerId: 2 })
    fireEvent.pointerUp(viewer, { clientX: 40, clientY: 100, isPrimary: true, pointerId: 2 })

    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('never requests a page beyond either boundary', () => {
    const onPageChange = vi.fn()
    const view = renderViewer({ pageIndex: 0, onPageChange })
    const viewer = screen.getByRole('region', { name: 'Welcome guide page viewer' })

    fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
    fireEvent.pointerDown(viewer, { clientX: 20, clientY: 20, isPrimary: true, pointerId: 3 })
    fireEvent.pointerUp(viewer, { clientX: 100, clientY: 20, isPrimary: true, pointerId: 3 })

    view.rerender(
      <PageViewer
        group={group}
        pageIndex={2}
        direction="ltr"
        onPageChange={onPageChange}
        onShare={() => undefined}
      />,
    )
    fireEvent.keyDown(viewer, { key: 'ArrowRight' })
    fireEvent.pointerDown(viewer, { clientX: 100, clientY: 20, isPrimary: true, pointerId: 4 })
    fireEvent.pointerUp(viewer, { clientX: 20, clientY: 20, isPrimary: true, pointerId: 4 })

    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('hides loading feedback on load and offers retry after an image error', async () => {
    const user = userEvent.setup()
    renderViewer()
    const image = screen.getByRole('img', { name: 'First welcome page' })

    expect(screen.getByRole('progressbar', { name: 'Loading First welcome page' })).toBeVisible()
    fireEvent.load(image)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    fireEvent.error(image)
    expect(screen.getByText('First welcome page')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry loading First welcome page' }))
    expect(screen.getByRole('progressbar', { name: 'Loading First welcome page' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'First welcome page' })).toHaveAttribute(
      'src',
      '/pages/first.png',
    )
  })

  // Server-rendered pages can finish loading before React attaches onLoad, and
  // that event never arrives late. Without this the opaque loading overlay would
  // cover a perfectly good image for as long as the reader stayed on the page.
  it('clears loading feedback for an image the browser decoded before hydration', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(450)

    renderViewer()

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'First welcome page' })).toBeVisible()
  })

  // The mirror of the case above. A complete image with no intrinsic width is a
  // load that finished and failed, and its onError fired before React attached,
  // so it will never fire again. Reading that as still loading would park the
  // opaque overlay over a broken image forever, with retry out of reach.
  it('offers retry for an image that failed before hydration', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)

    renderViewer()

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry loading First welcome page' })).toBeVisible()
  })

  it('updates only after its controlled page index changes and resets loading for the new source', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const view = renderViewer({ onPageChange })
    const firstImage = screen.getByRole('img', { name: 'First welcome page' })
    fireEvent.load(firstImage)

    await user.click(screen.getByRole('button', { name: 'Go to page 3 of 3' }))
    expect(screen.getByRole('img', { name: 'First welcome page' })).toBeVisible()
    expect(screen.getByText('1 / 3')).toBeVisible()

    view.rerender(
      <PageViewer
        group={group}
        pageIndex={2}
        direction="ltr"
        onPageChange={onPageChange}
        onShare={() => undefined}
      />,
    )

    expect(screen.getByRole('img', { name: 'Third welcome page' })).toHaveAttribute(
      'src',
      '/pages/third.png',
    )
    expect(screen.getByText('3 / 3')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Loading Third welcome page' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Go to page 3 of 3' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
