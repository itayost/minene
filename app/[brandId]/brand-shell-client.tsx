'use client'

import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { BrandShell, type PagePosition } from '../../src/components/BrandShell'
import { ShareSheet } from '../../src/components/ShareSheet'
import type { BrandManifest } from '../../src/core/brand-types'
import type { PageActionContext } from '../../src/core/page-actions'
import { brandHref } from '../../src/core/hrefs'
import { createInitialScreen, parentHref, resolveScreen } from '../../src/core/navigation'

type ShellChannels = {
  /** A route registers a factory. Passing null clears it on unmount. */
  register: (build: (() => PageActionContext) | null) => void
  /** The viewer reports where it is. Passing null clears it on unmount. */
  report: (position: PagePosition | null) => void
}

const ShellChannelsContext = createContext<ShellChannels | null>(null)

function useShellChannels(): ShellChannels {
  const value = useContext(ShellChannelsContext)
  if (!value) throw new Error('The shell channels must be used inside BrandShellClient')
  return value
}

export function useShareTarget(): Pick<ShellChannels, 'register'> {
  return useShellChannels()
}

/** Lets the viewer tell the shell header which page it is showing. */
export function useReportPagePosition(): ShellChannels['report'] {
  return useShellChannels().report
}

function samePosition(current: PagePosition | null, next: PagePosition | null): boolean {
  if (current === null || next === null) return current === next
  return current.pageIndex === next.pageIndex && current.pageCount === next.pageCount
}

export function BrandShellClient({
  brand,
  children,
}: {
  brand: BrandManifest
  children: ReactNode
}) {
  const pathname = usePathname()
  const [build, setBuild] = useState<(() => PageActionContext) | null>(null)
  const [shareContext, setShareContext] = useState<PageActionContext | null>(null)
  const [position, setPosition] = useState<PagePosition | null>(null)

  // A bare setState would call the factory rather than store it, so it is wrapped.
  const register = useCallback((next: (() => PageActionContext) | null) => {
    setBuild(() => next)
  }, [])

  // Reporting the same position again is common, so it is compared by value to
  // keep a re-rendering viewer from re-rendering the whole shell with it.
  const report = useCallback((next: PagePosition | null) => {
    setPosition((current) => (samePosition(current, next) ? current : next))
  }, [])

  const channels = useMemo<ShellChannels>(() => ({ register, report }), [register, report])

  // Nothing else closes the sheet, so leaving the screen would carry it onto the
  // next one. The path is the right boundary: paging only changes the query, and
  // the base is inert while the sheet is open, so no page can turn beneath it.
  useEffect(() => {
    setShareContext(null)
  }, [pathname])

  // The layout cannot read a child segment's params, so the screen comes from the
  // URL through the same pure resolver the route components use.
  //
  // The page position deliberately does not come from the URL here: reading it
  // would require useSearchParams(), which forces this whole subtree behind a
  // Suspense boundary and bails it out of server rendering entirely, silently
  // turning every notFound() and redirect() below this layout into a 200. The
  // viewer route reports its position through the shell channels above instead.
  // Do not reintroduce useSearchParams() here.
  const segments = pathname.split('/').filter(Boolean).slice(1)
  const screen = resolveScreen(brand, segments, null) ?? createInitialScreen()

  return (
    <ShellChannelsContext.Provider value={channels}>
      <BrandShell
        brand={brand}
        screen={screen}
        pagePosition={position}
        backHref={parentHref(brand, screen)}
        homeHref={brandHref(brand.id)}
        onShare={() => setShareContext(build ? build() : null)}
        modal={
          shareContext ? (
            <ShareSheet
              context={shareContext}
              labels={brand.labels}
              onClose={() => setShareContext(null)}
            />
          ) : undefined
        }
      >
        {children}
      </BrandShell>
    </ShellChannelsContext.Provider>
  )
}
