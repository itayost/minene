import '@fontsource-variable/heebo'
import '../src/styles.css'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Multi-brand content viewer',
  description: 'A configurable multi-brand content viewer.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#e9e9ee',
}

/**
 * Next permits <html> only in the root layout, and a root layout cannot read a
 * child segment's params, so per-brand lang and dir cannot be server-rendered
 * here. These are the default brand's values; BrandShell corrects them on the
 * client for any brand that differs, and .brand-shell carries its own dir and
 * lang so the rendered result never depends on that effect.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
