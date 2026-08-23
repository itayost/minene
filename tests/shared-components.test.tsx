import { useState, type ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BrandNotFound } from '../src/components/BrandNotFound'
import { BrandShell } from '../src/components/BrandShell'
import { HomeScreen } from '../src/components/HomeScreen'
import { PageViewer } from '../src/components/PageViewer'
import { ShareSheet } from '../src/components/ShareSheet'
import { SubjectMenu } from '../src/components/SubjectMenu'
import { ToolScreen } from '../src/components/ToolScreen'
import { brandHref, groupHref, subjectHref } from '../src/core/hrefs'
import type { BrowserActionApis, PageActionContext } from '../src/core/page-actions'
import { parentHref, type Screen } from '../src/core/navigation'
import { demoBrand } from './fixtures/demo-brand'

type HarnessProps = {
  initialScreen?: Screen
  modal?: ReactNode
}

function SharedComponentHarness({ initialScreen = { kind: 'home' }, modal }: HarnessProps = {}) {
  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen)

  // The group chooser now links straight to the group route. Screens
  // otherwise come from the URL, so the harness is handed one rather than
  // clicking its way there.
  const changePage = (pageIndex: number) => {
    setCurrentScreen((current) => current.kind === 'viewer' ? { ...current, pageIndex } : current)
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
      backHref={parentHref(demoBrand, currentScreen)}
      homeHref={brandHref(demoBrand.id)}
      modal={modal}
      onShare={() => undefined}
    >
      {currentScreen.kind === 'home' ? (
        <HomeScreen
          subjects={demoBrand.subjects}
          subjectHref={(subjectId) => subjectHref(demoBrand.id, subjectId)}
        />
      ) : currentScreen.kind === 'menu' && subject ? (
        <SubjectMenu
          subject={subject}
          groupHref={(groupId) => groupHref(demoBrand.id, subject.id, groupId)}
        />
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

describe('HomeScreen', () => {
  it('renders one link per subject pointing at its route', () => {
    render(<HomeScreen subjects={demoBrand.subjects} subjectHref={(id) => `/demo/${id}`} />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(demoBrand.subjects.length)
    expect(links[0]).toHaveAttribute('href', `/demo/${demoBrand.subjects[0]!.id}`)
    expect(links[0]).toHaveTextContent(demoBrand.subjects[0]!.label)
  })

  it('applies each subject card colour', () => {
    render(<HomeScreen subjects={demoBrand.subjects} subjectHref={(id) => `/demo/${id}`} />)

    const first = screen.getAllByRole('link')[0]!
    expect(first.getAttribute('style')).toContain(demoBrand.subjects[0]!.cardColor)
  })
})

describe('shared branded components', () => {
  it('renders the subject menu screen with links to each group route', () => {
    render(<SharedComponentHarness initialScreen={{ kind: 'menu', subjectId: 'multiple' }} />)

    expect(screen.getByRole('heading', { name: 'Multiple subject' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Group two' }))
      .toHaveAttribute('href', '/demo/multiple/group-two')
  })

  it('uses the brand accessibility labels for shell navigation', () => {
    render(<SharedComponentHarness initialScreen={{ kind: 'menu', subjectId: 'multiple' }} />)

    expect(screen.getByRole('navigation', { name: 'Demo destinations' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Return to previous screen' })).toBeVisible()
  })

  it('points the back link at the parent route of the current screen', () => {
    render(<SharedComponentHarness
      initialScreen={{ kind: 'viewer', subjectId: 'multiple', groupId: 'group-two', pageIndex: 0 }}
    />)

    expect(screen.getByRole('link', { name: 'Return to previous screen' }))
      .toHaveAttribute('href', '/demo/multiple')
  })

  it('presents the brand lockup with a decorative logo on the home screen', () => {
    const { container } = render(<SharedComponentHarness />)

    const logo = container.querySelector('.brand-lockup__logo')
    expect(logo).toHaveAttribute('src', demoBrand.logo.src)
    expect(logo).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img', { name: demoBrand.logo.alt })).not.toBeInTheDocument()
    expect(screen.getByText(demoBrand.name)).toBeVisible()
  })

  it('publishes the brand theme as custom properties on the stage', () => {
    const { container } = render(<SharedComponentHarness />)

    expect(container.querySelector('.app-stage')).toHaveStyle('--primary: #246BCE')
  })

  it('exposes home, share, and configured bottom-tool controls', () => {
    render(<SharedComponentHarness />)

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/demo')
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()

    for (const tool of demoBrand.tools) {
      expect(screen.getByRole('link', { name: tool.label }))
        .toHaveAttribute('href', `/demo/tools/${tool.id}`)
    }
  })

  it('marks the current bottom-tool destination and renders its screen', () => {
    render(<SharedComponentHarness initialScreen={{ kind: 'tool', toolId: 'notes' }} />)

    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.getByText('Ideas to discuss')).toBeVisible()
    expect(screen.getByRole('list')).toHaveTextContent('First idea')
  })

  it('keeps tool items exposed as a list to assistive technologies', () => {
    render(<SharedComponentHarness initialScreen={{ kind: 'tool', toolId: 'notes' }} />)

    expect(screen.getByRole('list')).toHaveAttribute('role', 'list')
  })

  it('applies and restores the brand document metadata', () => {
    const root = document.documentElement
    const originalLang = root.getAttribute('lang')
    const originalDirection = root.getAttribute('dir')
    root.lang = 'fr'
    root.dir = 'rtl'

    try {
      const view = render(<SharedComponentHarness />)

      expect(root).toHaveAttribute('lang', 'en-US')
      expect(root).toHaveAttribute('dir', 'ltr')

      view.unmount()
      expect(root).toHaveAttribute('lang', 'fr')
      expect(root).toHaveAttribute('dir', 'rtl')
    } finally {
      if (originalLang === null) root.removeAttribute('lang')
      else root.lang = originalLang
      if (originalDirection === null) root.removeAttribute('dir')
      else root.dir = originalDirection
    }
  })

  it('renders the modal beside the shell base and makes the base inert', () => {
    const { container } = render(<SharedComponentHarness
      modal={<div data-testid="test-modal">Page actions</div>}
    />)

    const shell = container.querySelector('.brand-shell')
    const shellBase = container.querySelector('.brand-shell__base')
    const modal = screen.getByTestId('test-modal')
    if (!(shellBase instanceof HTMLElement)) throw new Error('Branded shell base was not rendered')

    expect(modal.parentElement).toBe(shell)
    expect(shellBase).toHaveAttribute('inert')
    expect(shellBase).toHaveAttribute('aria-hidden', 'true')

    // An unblocked anchor behind the modal would navigate away from it.
    const homeLink = within(shellBase).getByRole('link', { name: 'Home', hidden: true })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    homeLink.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('renders a useful unknown-brand route', () => {
    render(<BrandNotFound brandId="missing-brand" />)

    expect(screen.getByRole('heading', { name: 'Brand not found' })).toBeVisible()
    expect(screen.getByText(/missing-brand/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the default brand' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
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
