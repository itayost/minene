'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { BrandShell } from '../../src/components/BrandShell'
import { ShareSheet } from '../../src/components/ShareSheet'
import type { BrandManifest } from '../../src/core/brand-types'
import type { PageActionContext } from '../../src/core/page-actions'
import { brandHref } from '../../src/core/hrefs'
import { createInitialScreen, parentHref, resolveScreen } from '../../src/core/navigation'

type ShareTarget = {
  /** A route registers a factory. Passing null clears it on unmount. */
  register: (build: (() => PageActionContext) | null) => void
}

const ShareTargetContext = createContext<ShareTarget | null>(null)

export function useShareTarget(): ShareTarget {
  const value = useContext(ShareTargetContext)
  if (!value) throw new Error('useShareTarget must be used inside BrandShellClient')
  return value
}

export function BrandShellClient({ brand, children }: { brand: BrandManifest; children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [build, setBuild] = useState<(() => PageActionContext) | null>(null)
  const [shareContext, setShareContext] = useState<PageActionContext | null>(null)

  // A bare setState would call the factory rather than store it, so it is wrapped.
  const register = useCallback((next: (() => PageActionContext) | null) => {
    setBuild(() => next)
  }, [])

  const shareTarget = useMemo<ShareTarget>(() => ({ register }), [register])

  // The layout cannot read a child segment's params, so the screen comes from the
  // URL through the same pure resolver the route components use.
  const segments = pathname.split('/').filter(Boolean).slice(1)
  const screen = resolveScreen(brand, segments, searchParams.get('page')) ?? createInitialScreen()

  return (
    <ShareTargetContext.Provider value={shareTarget}>
      <BrandShell
        brand={brand}
        screen={screen}
        backHref={parentHref(brand, screen)}
        homeHref={brandHref(brand.id)}
        onShare={() => setShareContext(build ? build() : null)}
        modal={shareContext ? (
          <ShareSheet
            context={shareContext}
            labels={brand.labels}
            onClose={() => setShareContext(null)}
          />
        ) : undefined}
      >
        {children}
      </BrandShell>
    </ShareTargetContext.Provider>
  )
}
