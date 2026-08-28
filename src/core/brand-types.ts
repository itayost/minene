export type Direction = 'ltr' | 'rtl'

export type PageAsset = { src: string; alt: string }

export type ContentGroup = {
  id: string
  label: string
  icon?: string
  pages: PageAsset[]
}

export type BrandSubject = {
  id: string
  label: string
  icon: string
  cardColor: string
  groups: ContentGroup[]
}

export type BrandTool = {
  id: string
  label: string
  icon: string
  note?: string
  items: string[]
  /**
   * A way out of a preview screen into the tool that actually does the work.
   *
   * `path` is relative to the brand root, because a brand's own id is not
   * something this config should have to repeat. The screen composes it.
   */
  action?: { label: string; path: string }
}

export type BrandTheme = {
  primary: string
  primaryStrong: string
  text: string
  muted: string
  background: string
  surface: string
  /** The fill for a row or card that sits on top of `surface`. */
  surfaceSunken: string
  /** עשה, a proven process, a high rating. Never decoration. */
  positive: string
  border: string
  fontFamily: string
}

export type BrandActionFeedbackLabels = {
  sharedFile: string
  sharedUrl: string
  copied: string
  shareFailed: string
  saved: string
  saveFailed: string
  whatsappOpened: string
  whatsappBlocked: string
  whatsappFailed: string
}

export type BrandManifest = {
  id: string
  name: string
  title: string
  locale: string
  direction: Direction
  logo: PageAsset
  theme: BrandTheme
  labels: {
    home: string
    back: string
    navigation: string
    share: string
    save: string
    whatsapp: string
    feedback: BrandActionFeedbackLabels
  }
  subjects: BrandSubject[]
  tools: BrandTool[]
}

export type ValidationIssue = { path: string; message: string }
