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

const impeccableContract = `<!-- IMPECCABLE-MINENE-HOME-20260824
THESIS: An attentive co-manager prepares one useful next step before exposing the catalog; refuse the flat launcher grid.
OWN-WORLD: Warm near-white Minene shell, navy Hebrew hierarchy, restrained pink action cues, lifestyle photography, and precise line icons.
STORY: A manager is welcomed, sees one recommended action, scans six practical tools, then reaches the persistent mentor composer.
FIRST VIEWPORT: A personal greeting leads directly into one wide photo-and-copy recommendation; the three-column catalog follows, with chat below.
FORM: User-pinned approved composition; seed MINENE-HOME-20260824.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`

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
      <body>
        <template dangerouslySetInnerHTML={{ __html: impeccableContract }} />
        {children}
      </body>
    </html>
  )
}
