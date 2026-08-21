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
}

export type BrandTheme = {
  primary: string
  primaryStrong: string
  text: string
  muted: string
  background: string
  surface: string
  border: string
  fontFamily: string
}

export type BrandManifest = {
  id: string
  name: string
  title: string
  locale: string
  direction: Direction
  logo: PageAsset
  theme: BrandTheme
  labels: { home: string; share: string; save: string; whatsapp: string }
  subjects: BrandSubject[]
  tools: BrandTool[]
}

export type ValidationIssue = { path: string; message: string }
