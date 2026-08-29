import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrandManifest, ContentGroup } from '../src/core/brand-types'
import { progressStorageKey } from '../src/core/progress'
import { demoBrand } from './fixtures/demo-brand'

// The viewer route is the only screen that pages, so it is also the only one
// that needs a router. Both hooks come from next/navigation, which has no
// provider outside a Next render, so it is stood in for here.
const navigation = vi.hoisted(() => ({
  pathname: '/demo/multiple/group-two',
  replace: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
}))

const { BrandShellClient } = await import('../app/[brandId]/brand-shell-client')
const { ViewerClient } = await import('../app/[brandId]/[subjectId]/[groupId]/viewer-client')

const EIGHT_PAGE_GROUP: ContentGroup = {
  id: 'group-two',
  label: 'Group two',
  icon: '/brands/demo/group-two.svg',
  pages: Array.from({ length: 8 }, (_, index) => ({
    src: `/brands/demo/group-two-page-${index + 1}.png`,
    alt: `Group two page ${index + 1}`,
  })),
}

// A local widening of the shared fixture: every demo group holds a single page,
// and a counter that is stuck on the first page cannot be caught by one of those.
const eightPageBrand: BrandManifest = {
  ...demoBrand,
  subjects: demoBrand.subjects.map((subject) =>
    subject.id === 'multiple'
      ? {
          ...subject,
          groups: subject.groups.map((group) =>
            group.id === EIGHT_PAGE_GROUP.id ? EIGHT_PAGE_GROUP : group,
          ),
        }
      : subject,
  ),
}

function viewerTree({ pageIndex = 0, hasExplicitPage = false } = {}) {
  return (
    <BrandShellClient brand={eightPageBrand}>
      <ViewerClient
        brand={eightPageBrand}
        subjectId="multiple"
        group={EIGHT_PAGE_GROUP}
        pageIndex={pageIndex}
        hasExplicitPage={hasExplicitPage}
      />
    </BrandShellClient>
  )
}

function renderViewer(props: { pageIndex?: number; hasExplicitPage?: boolean } = {}) {
  return render(viewerTree(props))
}

function headerSubtitle() {
  return document.querySelector('.app-header__subtitle')?.textContent ?? ''
}

beforeEach(() => {
  navigation.pathname = '/demo/multiple/group-two'
  navigation.replace.mockReset()
  navigation.push.mockReset()
})

describe('viewer route', () => {
  it('shows the page the viewer is on in the shell header, not the first page', () => {
    renderViewer({ pageIndex: 3, hasExplicitPage: true })

    expect(headerSubtitle()).toBe('Group two · 4 / 8')
  })

  it('follows the viewer as it pages', async () => {
    const user = userEvent.setup()
    const { rerender } = renderViewer({ pageIndex: 0 })

    expect(headerSubtitle()).toBe('Group two · 1 / 8')

    await user.click(screen.getByRole('button', { name: 'Go to page 6 of 8' }))
    // The URL is the source of the page, so the route hands the new one back.
    expect(navigation.replace).toHaveBeenCalledWith('/demo/multiple/group-two?page=6')
    rerender(viewerTree({ pageIndex: 5, hasExplicitPage: true }))

    expect(headerSubtitle()).toBe('Group two · 6 / 8')
  })

  it('remembers the page it moved to', async () => {
    const user = userEvent.setup()
    renderViewer({ pageIndex: 0 })

    await user.click(screen.getByRole('button', { name: 'Go to page 3 of 8' }))

    expect(window.localStorage.getItem(progressStorageKey('demo'))).toBe('{"multiple/group-two":2}')
  })

  it('never pushes a page turn, so back still leaves the group', async () => {
    const user = userEvent.setup()
    renderViewer({ pageIndex: 0 })

    await user.click(screen.getByRole('button', { name: 'Go to page 3 of 8' }))

    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('restores remembered progress when the URL names no page', () => {
    window.localStorage.setItem(progressStorageKey('demo'), '{"multiple/group-two":4}')

    renderViewer({ pageIndex: 0 })

    expect(navigation.replace).toHaveBeenCalledWith('/demo/multiple/group-two?page=5')
  })

  // Restore is a single decision per group, and the only piece of this route
  // whose correctness lives in effect ordering rather than in a pure function.
  // The effect re-runs whenever the viewer re-renders, both before the replace
  // it asked for lands and after, and neither run may navigate a second time.
  it('restores once for a group, however often the effect runs', () => {
    window.localStorage.setItem(progressStorageKey('demo'), '{"multiple/group-two":4}')

    const { rerender } = renderViewer({ pageIndex: 0 })
    expect(navigation.replace).toHaveBeenCalledWith('/demo/multiple/group-two?page=5')

    // A re-render while the requested page is still in flight, then the props
    // that replace actually produces.
    rerender(viewerTree({ pageIndex: 0 }))
    rerender(viewerTree({ pageIndex: 4, hasExplicitPage: true }))

    expect(navigation.replace).toHaveBeenCalledTimes(1)
  })

  it('leaves an explicit page alone even when another one is remembered', () => {
    window.localStorage.setItem(progressStorageKey('demo'), '{"multiple/group-two":4}')

    renderViewer({ pageIndex: 1, hasExplicitPage: true })

    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('clamps a remembered page that no longer exists', () => {
    window.localStorage.setItem(progressStorageKey('demo'), '{"multiple/group-two":99}')

    renderViewer({ pageIndex: 0 })

    expect(navigation.replace).toHaveBeenCalledWith('/demo/multiple/group-two?page=8')
  })

  it('stays put when the remembered page is the one already open', () => {
    window.localStorage.setItem(progressStorageKey('demo'), '{"multiple/group-two":0}')

    renderViewer({ pageIndex: 0 })

    expect(navigation.replace).not.toHaveBeenCalled()
  })
})

describe('the shell share sheet', () => {
  it('opens over the viewer with the current page', async () => {
    const user = userEvent.setup()
    renderViewer({ pageIndex: 3, hasExplicitPage: true })

    await user.click(screen.getByRole('button', { name: demoBrand.labels.share }))

    expect(screen.getByRole('dialog', { name: 'Group two' })).toBeVisible()
  })

  it('closes when the route changes, rather than following it', async () => {
    const user = userEvent.setup()
    const { rerender } = renderViewer({ pageIndex: 3, hasExplicitPage: true })

    await user.click(screen.getByRole('button', { name: demoBrand.labels.share }))
    expect(screen.getByRole('dialog', { name: 'Group two' })).toBeVisible()

    navigation.pathname = '/demo'
    rerender(<BrandShellClient brand={eightPageBrand}>{null}</BrandShellClient>)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('drops the counter when the viewer leaves, so the next group is not counted by it', () => {
    const { rerender } = renderViewer({ pageIndex: 3, hasExplicitPage: true })

    navigation.pathname = '/demo/single/only-group'
    rerender(<BrandShellClient brand={eightPageBrand}>{null}</BrandShellClient>)

    expect(headerSubtitle()).toBe('1 / 1')
  })
})
