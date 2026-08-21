import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { mineneBrand } from '../src/brands/minene'
import type { BrandManifest } from '../src/core/brand-types'
import { progressStorageKey } from '../src/core/progress'
import { demoBrand } from './fixtures/demo-brand'

class ObservedStorage implements Storage {
  private readonly values = new Map<string, string>()
  reads = 0

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) {
    this.reads += 1
    return this.values.get(key) ?? null
  }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  storedValue(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const multipageDemoBrand: BrandManifest = {
  ...demoBrand,
  subjects: demoBrand.subjects.map((subject) => subject.id !== 'multiple'
    ? subject
    : {
        ...subject,
        groups: subject.groups.map((group) => group.id !== 'group-two'
          ? group
          : {
              ...group,
              pages: [
                { src: '/brands/demo/group-two-page-1.png', alt: 'Group two page one' },
                { src: '/brands/demo/group-two-page-2.png', alt: 'Group two page two' },
                { src: '/brands/demo/group-two-page-3.png', alt: 'Group two page three' },
              ],
            }),
      }),
}

const productionAndDemoRegistry = new Map([
  [mineneBrand.id, mineneBrand],
  [demoBrand.id, demoBrand],
] as const)

function renderDemo(storage: Storage = new ObservedStorage(), brand = demoBrand) {
  return render(<App pathname="/demo" registry={new Map([[brand.id, brand]])} storage={storage} />)
}

describe('App', () => {
  it('resolves the default Minene brand from the browser root pathname', () => {
    window.history.replaceState({}, '', '/')

    render(<App registry={productionAndDemoRegistry} storage={new ObservedStorage()} />)

    expect(screen.getByText('Minene Cockpit')).toBeVisible()
    expect(document.querySelector('.brand-lockup__logo')).toHaveAttribute('alt', '')
    expect(screen.getByRole('button', { name: 'משימות יומיות' })).toBeVisible()
  })

  it('resolves an explicitly selected brand', () => {
    render(<App pathname="/demo" registry={productionAndDemoRegistry} storage={new ObservedStorage()} />)

    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(document.documentElement).toHaveAttribute('lang', 'en-US')
    expect(screen.queryByRole('img', { name: 'Demo brand logo' })).not.toBeInTheDocument()
    expect(document.querySelector('.brand-lockup__logo')).toHaveAttribute('src', '/brands/demo/logo.svg')
    expect(document.querySelector('.brand-lockup__logo')).toHaveAttribute('alt', '')
    expect(screen.getByText('Demo brand')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Multiple subject' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Notes' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Demo destinations' })).toBeVisible()
    expect(document.querySelector('.app-stage')).toHaveStyle('--primary: #246BCE')
  })

  it('renders an unknown brand without a branded shell', () => {
    render(<App pathname="/not-configured" registry={productionAndDemoRegistry} storage={new ObservedStorage()} />)

    expect(screen.getByRole('heading', { name: 'Brand not found' })).toBeVisible()
    expect(screen.getByText(/not-configured/)).toBeVisible()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('renders with fallback progress storage when the localStorage getter throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('storage denied') },
    })

    try {
      render(<App pathname="/demo" registry={productionAndDemoRegistry} />)
      expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
      else Reflect.deleteProperty(window, 'localStorage')
    }
  })

  it('opens a single-group subject directly in its viewer', async () => {
    const user = userEvent.setup()
    renderDemo()

    await user.click(screen.getByRole('button', { name: 'Single subject' }))

    expect(screen.getByRole('region', { name: 'Only group page viewer' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Only page' })).toBeVisible()
  })

  it('opens a multi-group subject through its group chooser', async () => {
    const user = userEvent.setup()
    renderDemo()

    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    expect(screen.getByRole('heading', { name: 'Multiple subject' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: /Group (one|two|three)/ })).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Group two' }))
    expect(screen.getByRole('img', { name: 'Group two page' })).toBeVisible()
  })

  it('supports viewer back navigation and the global home action', async () => {
    const user = userEvent.setup()
    renderDemo()

    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    await user.click(screen.getByRole('button', { name: 'Group one' }))
    await user.click(screen.getByRole('button', { name: 'Return to previous screen' }))
    expect(screen.getByRole('heading', { name: 'Multiple subject' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Return to previous screen' }))
    expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens configured bottom tools and marks the current destination', async () => {
    const user = userEvent.setup()
    renderDemo()

    await user.click(screen.getByRole('button', { name: 'Notes' }))

    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Ideas to discuss')).toBeVisible()
    expect(screen.getByRole('list')).toHaveTextContent('Second idea')
  })

  it('offers page actions only while a viewer is current', async () => {
    const user = userEvent.setup()
    let openedUrl = ''
    const popup = {
      opener: window,
      location: { replace: (url: string | URL) => { openedUrl = String(url) } },
      close: () => undefined,
    }
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window)
    renderDemo(new ObservedStorage(), multipageDemoBrand)

    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Group two' }))
    await user.click(screen.getByRole('button', { name: 'Go to page 3 of 3' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('dialog', { name: 'Group two' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Send with WhatsApp' }))
    expect(decodeURIComponent(openedUrl)).toContain('Demo brand: Group two — Group two page three')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('covers the full branded shell and blocks its controls while page actions are modal', async () => {
    const user = userEvent.setup()
    renderDemo()

    await user.click(screen.getByRole('button', { name: 'Single subject' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))

    const shell = document.querySelector('.brand-shell')
    const shellBase = document.querySelector('.brand-shell__base')
    const overlay = screen.getByTestId('share-sheet-overlay')
    const dialog = screen.getByRole('dialog', { name: 'Only group' })
    expect(shell).not.toBeNull()
    expect(shellBase).not.toBeNull()
    if (!(shellBase instanceof HTMLElement)) throw new Error('Branded shell base was not rendered')
    expect(overlay.parentElement).toBe(shell)
    expect(shell).toContainElement(dialog)
    expect(shellBase).toHaveAttribute('inert')
    expect(shellBase).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(within(shellBase).getByRole('button', { name: 'Home', hidden: true }))
    expect(screen.getByRole('dialog', { name: 'Only group' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('region', { name: 'Only group page viewer' })).toBeVisible()
  })

  it('persists a selected page and restores it after remount without repeated reads', async () => {
    const user = userEvent.setup()
    const storage = new ObservedStorage()
    const firstMount = renderDemo(storage, multipageDemoBrand)

    expect(storage.reads).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    await user.click(screen.getByRole('button', { name: 'Group two' }))
    await user.click(screen.getByRole('button', { name: 'Go to page 3 of 3' }))

    expect(screen.getByRole('img', { name: 'Group two page three' })).toBeVisible()
    await waitFor(() => {
      expect(storage.storedValue(progressStorageKey('demo'))).toBe('{"multiple/group-two":2}')
    })
    expect(storage.reads).toBe(1)

    firstMount.unmount()
    renderDemo(storage, multipageDemoBrand)
    expect(storage.reads).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
    await user.click(screen.getByRole('button', { name: 'Group two' }))
    expect(screen.getByRole('img', { name: 'Group two page three' })).toBeVisible()
    expect(screen.getByText('3 / 3')).toBeVisible()
    expect(storage.reads).toBe(2)
  })
})
