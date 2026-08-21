import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadPage,
  sharePage,
  whatsappUrl,
  type BrowserActionApis,
  type PageActionContext,
} from '../src/core/page-actions'

const context: PageActionContext = {
  brandId: 'demo',
  brandName: 'Demo brand',
  groupId: 'group-two',
  groupName: 'Group two',
  page: { src: '/brands/demo/group-two-page.png', alt: 'Group two page' },
  pageIndex: 0,
  currentUrl: 'https://viewer.example/brands/demo/groups/group-two?page=1',
}

function browserApis(overrides: Partial<BrowserActionApis> = {}): BrowserActionApis {
  return {
    fetch: vi.fn(async () => new Response(new Blob(['image bytes'], { type: 'image/png' }))) as typeof fetch,
    canShare: undefined,
    share: undefined,
    clipboard: undefined,
    createObjectURL: vi.fn(() => 'blob:page-image'),
    revokeObjectURL: vi.fn(),
    createAnchor: () => document.createElement('a'),
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('page actions', () => {
  it('shares the page image when file sharing is supported', async () => {
    const shared: ShareData[] = []
    const apis = browserApis({
      canShare: (data) => Array.isArray(data.files) && data.files.length === 1,
      share: async (data) => { shared.push(data) },
    })

    await expect(sharePage(context, apis)).resolves.toBe('file')

    expect(shared).toHaveLength(1)
    expect(shared[0]?.files?.[0]?.name).toBe('demo-group-two-page-1.png')
  })

  it('shares the current URL when file sharing is unavailable', async () => {
    const shared: ShareData[] = []
    const apis = browserApis({
      canShare: () => false,
      share: async (data) => { shared.push(data) },
    })

    await expect(sharePage(context, apis)).resolves.toBe('url')

    expect(shared).toEqual([{
      title: 'Demo brand: Group two — Group two page',
      text: 'Demo brand: Group two — Group two page',
      url: 'https://viewer.example/brands/demo/groups/group-two?page=1',
    }])
  })

  it('copies the current URL after sharing cannot be completed', async () => {
    const copied: string[] = []
    const apis = browserApis({
      fetch: vi.fn(async () => { throw new Error('offline') }) as typeof fetch,
      share: async () => { throw new Error('share declined') },
      clipboard: { writeText: async (text) => { copied.push(text) } },
    })

    await expect(sharePage(context, apis)).resolves.toBe('copied')

    expect(copied).toEqual(['https://viewer.example/brands/demo/groups/group-two?page=1'])
  })

  it('releases its object URL even when starting the download fails', async () => {
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => { throw new Error('click failed') })
    const revokeObjectURL = vi.fn()
    const apis = browserApis({
      createAnchor: () => anchor,
      revokeObjectURL,
    })

    await expect(downloadPage(context, apis)).rejects.toThrow('click failed')

    expect(anchor.href).toBe('blob:page-image')
    expect(anchor.download).toBe('demo-group-two-page-1.png')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:page-image')
  })

  it('encodes the descriptive page text and current URL for WhatsApp', () => {
    expect(whatsappUrl(context)).toBe(
      'https://wa.me/?text=Demo%20brand%3A%20Group%20two%20%E2%80%94%20Group%20two%20page%0Ahttps%3A%2F%2Fviewer.example%2Fbrands%2Fdemo%2Fgroups%2Fgroup-two%3Fpage%3D1',
    )
  })
})
