import type { PageAsset } from './brand-types'

export type PageActionContext = {
  brandId: string
  brandName: string
  groupId: string
  groupName: string
  page: PageAsset
  pageIndex: number
  currentUrl: string
}

export type BrowserActionApis = {
  fetch: typeof fetch
  canShare?: (data: ShareData) => boolean
  share?: (data: ShareData) => Promise<void>
  clipboard?: Pick<Clipboard, 'writeText'>
  createObjectURL: (object: Blob | MediaSource) => string
  revokeObjectURL: (url: string) => void
  createAnchor: () => HTMLAnchorElement
}

function browserActionApis(): BrowserActionApis {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    canShare: navigator.canShare?.bind(navigator),
    share: navigator.share?.bind(navigator),
    clipboard: navigator.clipboard,
    createObjectURL: URL.createObjectURL.bind(URL),
    revokeObjectURL: URL.revokeObjectURL.bind(URL),
    createAnchor: () => document.createElement('a'),
  }
}

function actionDescription({ brandName, groupName, page }: PageActionContext) {
  return `${brandName}: ${groupName} — ${page.alt}`
}

function pageFilename({ brandId, groupId, pageIndex }: PageActionContext) {
  return `${brandId}-${groupId}-page-${pageIndex + 1}.png`
}

async function fetchPage(page: PageAsset, apis: BrowserActionApis) {
  const response = await apis.fetch(page.src)
  if (!response.ok) throw new Error(`Could not fetch page image (${response.status})`)
  return response.blob()
}

function errorFrom(error: unknown) {
  return error instanceof Error ? error : new Error('Page action failed')
}

/** Shares the image when possible, followed by URL and clipboard fallbacks. */
export async function sharePage(context: PageActionContext, injectedApis = browserActionApis()): Promise<'file' | 'url' | 'copied'> {
  const description = actionDescription(context)
  let lastError: Error | undefined

  try {
    const blob = await fetchPage(context.page, injectedApis)
    const image = new File([blob], pageFilename(context), { type: blob.type || 'image/png' })
    const fileData: ShareData = { files: [image], title: description, text: description, url: context.currentUrl }

    if (injectedApis.canShare?.(fileData) && injectedApis.share) {
      await injectedApis.share(fileData)
      return 'file'
    }
  } catch (error) {
    lastError = errorFrom(error)
  }

  if (injectedApis.share) {
    try {
      await injectedApis.share({ title: description, text: description, url: context.currentUrl })
      return 'url'
    } catch (error) {
      lastError = errorFrom(error)
    }
  }

  if (injectedApis.clipboard) {
    try {
      await injectedApis.clipboard.writeText(context.currentUrl)
      return 'copied'
    } catch (error) {
      lastError = errorFrom(error)
    }
  }

  throw lastError ?? new Error('No page sharing action is available')
}

/** Downloads the current image and always releases the temporary object URL. */
export async function downloadPage(context: PageActionContext, injectedApis = browserActionApis()): Promise<void> {
  const blob = await fetchPage(context.page, injectedApis)
  const objectUrl = injectedApis.createObjectURL(blob)

  try {
    const anchor = injectedApis.createAnchor()
    anchor.href = objectUrl
    anchor.download = pageFilename(context)
    anchor.click()
  } finally {
    injectedApis.revokeObjectURL(objectUrl)
  }
}

export function whatsappUrl(context: PageActionContext) {
  return `https://wa.me/?text=${encodeURIComponent(`${actionDescription(context)}\n${context.currentUrl}`)}`
}
