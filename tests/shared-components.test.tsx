import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BrandNotFound } from '../src/components/BrandNotFound'
import { BrandShell } from '../src/components/BrandShell'
import { HomeScreen } from '../src/components/HomeScreen'
import { PageViewer } from '../src/components/PageViewer'
import { SubjectMenu } from '../src/components/SubjectMenu'
import { ToolScreen } from '../src/components/ToolScreen'
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
    expect(screen.getByRole('button', { name: 'Share' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Return to previous screen' }))
    expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
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
    root.lang = 'fr'
    root.dir = 'rtl'
    document.title = 'Previous title'

    const view = render(<SharedComponentHarness />)

    expect(root).toHaveAttribute('lang', 'en-US')
    expect(root).toHaveAttribute('dir', 'ltr')
    expect(document.title).toBe('Demo content viewer')

    view.unmount()
    expect(root).toHaveAttribute('lang', 'fr')
    expect(root).toHaveAttribute('dir', 'rtl')
    expect(document.title).toBe('Previous title')
  })

  it('renders a useful unknown-brand route', () => {
    render(<BrandNotFound brandId="missing-brand" />)

    expect(screen.getByRole('heading', { name: 'Brand not found' })).toBeVisible()
    expect(screen.getByText(/missing-brand/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the default brand' })).toHaveAttribute('href', '/')
  })
})
