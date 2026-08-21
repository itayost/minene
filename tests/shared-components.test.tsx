import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BrandNotFound } from '../src/components/BrandNotFound'
import { BrandShell } from '../src/components/BrandShell'
import { HomeScreen } from '../src/components/HomeScreen'
import { PageViewer } from '../src/components/PageViewer'
import { ShareSheet } from '../src/components/ShareSheet'
import { SubjectMenu } from '../src/components/SubjectMenu'
import { ToolScreen } from '../src/components/ToolScreen'
import type { BrowserActionApis, PageActionContext } from '../src/core/page-actions'
import type { Screen } from '../src/core/navigation'
import { demoBrand } from './fixtures/demo-brand'

function SharedComponentHarness() {
  const [currentScreen, setCurrentScreen] = useState<Screen>({ kind: 'home' })

  const openSubject = (subjectId: string) => {
    const subject = demoBrand.subjects.find((candidate) => candidate.id === subjectId)
    if (!subject) return
    setCurrentScreen(
      subject.groups.length === 1
        ? { kind: 'viewer', subjectId, groupId: subject.groups[0]!.id, pageIndex: 0 }
        : { kind: 'menu', subjectId },
    )
  }

  const openGroup = (groupId: string) => {
    if (currentScreen.kind !== 'menu') return
    setCurrentScreen({ kind: 'viewer', subjectId: currentScreen.subjectId, groupId, pageIndex: 0 })
  }

  const goBack = () => setCurrentScreen({ kind: 'home' })
  const changePage = (pageIndex: number) => {
    setCurrentScreen((screen) => screen.kind === 'viewer' ? { ...screen, pageIndex } : screen)
  }
  const subject = currentScreen.kind === 'menu'
    ? demoBrand.subjects.find((candidate) => candidate.id === currentScreen.subjectId)
    : undefined
  const viewerGroup = currentScreen.kind === 'viewer'
    ? demoBrand.subjects
      .find((candidate) => candidate.id === currentScreen.subjectId)
      ?.groups.find((candidate) => candidate.id === currentScreen.groupId)
    : undefined
  const tool = currentScreen.kind === 'tool'
    ? demoBrand.tools.find((candidate) => candidate.id === currentScreen.toolId)
    : undefined

  return (
    <BrandShell
      brand={demoBrand}
      screen={currentScreen}
      onBack={goBack}
      onHome={() => setCurrentScreen({ kind: 'home' })}
      onShare={() => undefined}
      onTool={(toolId) => setCurrentScreen({ kind: 'tool', toolId })}
    >
      {currentScreen.kind === 'home' ? (
        <HomeScreen subjects={demoBrand.subjects} onSubject={openSubject} />
      ) : currentScreen.kind === 'menu' && subject ? (
        <SubjectMenu subject={subject} onGroup={openGroup} />
      ) : currentScreen.kind === 'viewer' && viewerGroup ? (
        <PageViewer
          direction={demoBrand.direction}
          group={viewerGroup}
          pageIndex={currentScreen.pageIndex}
          onPageChange={changePage}
          onShare={() => undefined}
        />
      ) : tool ? (
        <ToolScreen tool={tool} />
      ) : null}
    </BrandShell>
  )
}

function ShareSheetHarness({ openWindow }: { openWindow?: typeof window.open } = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const context: PageActionContext = {
    brandId: demoBrand.id,
    brandName: demoBrand.name,
    groupId: 'group-two',
    groupName: 'Group two',
    page: { src: '/brands/demo/group-two-page.png', alt: 'Group two page' },
    pageIndex: 0,
    currentUrl: 'https://viewer.example/brands/demo/groups/group-two?page=1',
  }
  const browserApis: BrowserActionApis = {
    fetch: async () => new Response('image bytes', { headers: { 'content-type': 'image/png' } }),
    canShare: () => false,
    share: async () => undefined,
    clipboard: undefined,
    createObjectURL: () => 'blob:test-page',
    revokeObjectURL: () => undefined,
    createAnchor: () => Object.assign(document.createElement('a'), { click: () => undefined }),
  }

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Open page actions</button>
      {isOpen ? (
        <ShareSheet
          browserApis={browserApis}
          context={context}
          labels={demoBrand.labels}
          onClose={() => setIsOpen(false)}
          openWindow={openWindow}
        />
      ) : null}
    </>
  )
}

describe('shared branded components', () => {
  it('opens a multi-group subject and one of its groups', async () => {
    const user = userEvent.setup()
    render(<SharedComponentHarness />)

    expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))

    expect(screen.getByRole('heading', { name: 'Multiple subject' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Group two' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Group two' }))
    expect(screen.getByRole('img', { name: 'Group two page' })).toBeVisible()
    expect(screen.getByText('Group two · 1 / 1')).toBeVisible()
  })

  it('uses the brand accessibility labels for shell navigation', async () => {
    const user = userEvent.setup()
    render(<SharedComponentHarness />)

    expect(screen.getByRole('navigation', { name: 'Demo destinations' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    expect(screen.getByRole('button', { name: 'Return to previous screen' })).toBeVisible()
  })

  it('exposes home, share, and configured bottom-tool controls', async () => {
    const user = userEvent.setup()
    render(<SharedComponentHarness />)

    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Notes' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Return to previous screen' }))
    expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.getByText('Ideas to discuss')).toBeVisible()
    expect(screen.getByRole('list')).toHaveTextContent('First idea')

    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps tool items exposed as a list to assistive technologies', async () => {
    const user = userEvent.setup()
    render(<SharedComponentHarness />)

    await user.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByRole('list')).toHaveAttribute('role', 'list')
  })

  it('applies and restores the brand document metadata', () => {
    const root = document.documentElement
    const originalLang = root.getAttribute('lang')
    const originalDirection = root.getAttribute('dir')
    const originalTitle = document.title
    root.lang = 'fr'
    root.dir = 'rtl'
    document.title = 'Previous title'

    try {
      const view = render(<SharedComponentHarness />)

      expect(root).toHaveAttribute('lang', 'en-US')
      expect(root).toHaveAttribute('dir', 'ltr')
      expect(document.title).toBe('Demo content viewer')

      view.unmount()
      expect(root).toHaveAttribute('lang', 'fr')
      expect(root).toHaveAttribute('dir', 'rtl')
      expect(document.title).toBe('Previous title')
    } finally {
      if (originalLang === null) root.removeAttribute('lang')
      else root.lang = originalLang
      if (originalDirection === null) root.removeAttribute('dir')
      else root.dir = originalDirection
      document.title = originalTitle
    }
  })

  it('renders a useful unknown-brand route', () => {
    render(<BrandNotFound brandId="missing-brand" />)

    expect(screen.getByRole('heading', { name: 'Brand not found' })).toBeVisible()
    expect(screen.getByText(/missing-brand/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the default brand' })).toHaveAttribute('href', '/')
  })

  it('focuses page sharing, announces completion, and returns focus after Escape', async () => {
    const user = userEvent.setup()
    render(<ShareSheetHarness />)
    const trigger = screen.getByRole('button', { name: 'Open page actions' })

    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Group two' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Share' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('status')).toHaveTextContent('Shared a link to the page')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes the page action sheet when its overlay is selected', async () => {
    const user = userEvent.setup()
    render(<ShareSheetHarness />)

    await user.click(screen.getByRole('button', { name: 'Open page actions' }))
    await user.click(screen.getByTestId('share-sheet-overlay'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports an error when WhatsApp is blocked by the browser', async () => {
    const user = userEvent.setup()
    render(<ShareSheetHarness openWindow={() => null} />)

    await user.click(screen.getByRole('button', { name: 'Open page actions' }))
    await user.click(screen.getByRole('button', { name: 'Send with WhatsApp' }))

    expect(screen.getByRole('status')).toHaveTextContent('WhatsApp popup was blocked')
  })

  it('does not report a false WhatsApp warning after a context opens successfully', async () => {
    const user = userEvent.setup()
    const popup = {
      opener: window,
      location: { replace: () => undefined },
      close: () => undefined,
    }
    render(<ShareSheetHarness openWindow={() => popup as unknown as Window} />)

    await user.click(screen.getByRole('button', { name: 'Open page actions' }))
    await user.click(screen.getByRole('button', { name: 'Send with WhatsApp' }))

    expect(screen.getByRole('status')).toHaveTextContent('Opened WhatsApp')
    expect(screen.getByRole('status')).not.toHaveTextContent('⚠')
  })

  it('reports a localized WhatsApp navigation failure', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const popup = {
      opener: window,
      location: { replace: () => { throw new Error('denied') } },
      close,
    }
    render(<ShareSheetHarness openWindow={() => popup as unknown as Window} />)

    await user.click(screen.getByRole('button', { name: 'Open page actions' }))
    await user.click(screen.getByRole('button', { name: 'Send with WhatsApp' }))

    expect(screen.getByRole('status')).toHaveTextContent('Could not open WhatsApp')
    expect(close).toHaveBeenCalledOnce()
  })

  it('announces a localized save outcome', async () => {
    const user = userEvent.setup()
    render(<ShareSheetHarness />)

    await user.click(screen.getByRole('button', { name: 'Open page actions' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent('Saved the page image')
  })
})
