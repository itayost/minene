'use client'

import Link from 'next/link'
import { useEffect, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import type { BrandManifest } from '../core/brand-types'
import { toolHref } from '../core/hrefs'
import type { Screen } from '../core/navigation'

/** Where the viewer currently is, reported by the viewer route to the shell. */
export type PagePosition = {
  pageIndex: number
  pageCount: number
}

type BrandShellProps = {
  brand: BrandManifest
  screen: Screen
  children: ReactNode
  modal?: ReactNode
  backHref: string
  homeHref: string
  onShare: () => void
  pagePosition?: PagePosition | null
}

function blockBackgroundClick(event: MouseEvent<HTMLDivElement>) {
  event.preventDefault()
  event.stopPropagation()
}

type ThemeStyle = CSSProperties & {
  '--primary': string
  '--primary-strong': string
  '--text': string
  '--muted': string
  '--background': string
  '--surface': string
  '--surface-sunken': string
  '--positive': string
  '--border': string
  '--font-family': string
}

const homeIcon = (
  <svg aria-hidden="true" viewBox="0 0 23 22">
    <path d="M2 9.5 11.5 2 21 9.5" />
    <path d="M4 8v11a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8" />
  </svg>
)

function findHeaderContent(
  brand: BrandManifest,
  screen: Screen,
  pagePosition: PagePosition | null,
) {
  if (screen.kind === 'home') return { title: '', subtitle: '' }
  if (screen.kind === 'tool') {
    return {
      title: brand.tools.find((tool) => tool.id === screen.toolId)?.label ?? '',
      subtitle: '',
    }
  }

  const subject = brand.subjects.find((candidate) => candidate.id === screen.subjectId)
  if (screen.kind === 'menu') {
    return { title: subject?.label ?? '', subtitle: '' }
  }

  const group = subject?.groups.find((candidate) => candidate.id === screen.groupId)
  // The shell is rendered by the layout, which cannot read the page out of the
  // URL without bailing the whole subtree out of server rendering, so the viewer
  // route reports its position instead. Until it does, the screen still carries
  // an accurate group, and so an accurate total.
  const pageCount = pagePosition?.pageCount ?? group?.pages.length ?? 0
  const pageIndex = pagePosition?.pageIndex ?? screen.pageIndex
  const positionLabel = pageCount > 0 ? `${pageIndex + 1} / ${pageCount}` : ''
  return {
    title: subject?.label ?? '',
    subtitle:
      subject && subject.groups.length > 1 && group
        ? `${group.label} · ${positionLabel}`
        : positionLabel,
  }
}

export function BrandShell({
  brand,
  screen,
  children,
  modal,
  backHref,
  homeHref,
  onShare,
  pagePosition = null,
}: BrandShellProps) {
  // The title comes from generateMetadata, so it is in the served HTML rather
  // than applied after hydration. Only lang and dir are still corrected here.
  useEffect(() => {
    const root = document.documentElement
    const previousLang = root.getAttribute('lang')
    const previousDirection = root.getAttribute('dir')

    root.lang = brand.locale
    root.dir = brand.direction

    return () => {
      if (previousLang === null) root.removeAttribute('lang')
      else root.lang = previousLang

      if (previousDirection === null) root.removeAttribute('dir')
      else root.dir = previousDirection
    }
  }, [brand.direction, brand.locale])

  const themeStyle: ThemeStyle = {
    '--primary': brand.theme.primary,
    '--primary-strong': brand.theme.primaryStrong,
    '--text': brand.theme.text,
    '--muted': brand.theme.muted,
    '--background': brand.theme.background,
    '--surface': brand.theme.surface,
    '--surface-sunken': brand.theme.surfaceSunken,
    '--positive': brand.theme.positive,
    '--border': brand.theme.border,
    '--font-family': brand.theme.fontFamily,
  }
  const isHome = screen.kind === 'home'
  const isModalOpen = modal !== undefined && modal !== null
  const header = findHeaderContent(brand, screen, pagePosition)

  return (
    <div className="app-stage" style={themeStyle}>
      <div className="brand-shell" dir={brand.direction} lang={brand.locale}>
        <div
          className="brand-shell__base"
          aria-hidden={isModalOpen ? true : undefined}
          inert={isModalOpen ? true : undefined}
          onClickCapture={isModalOpen ? blockBackgroundClick : undefined}
        >
          <header
            className={`app-header ${isHome ? 'app-header--home' : 'app-header--inner'}${isHome && brand.id === 'minene' ? ' app-header--minene-home' : ''}`}
          >
            {isHome ? (
              brand.id === 'minene' ? (
                <img className="app-header__home-logo" src={brand.logo.src} alt={brand.logo.alt} />
              ) : (
                <>
                  <span className="app-header__spacer" aria-hidden="true" />
                  <div className="brand-lockup">
                    <img className="brand-lockup__logo" src={brand.logo.src} alt="" />
                    <span className="brand-lockup__name">{brand.name}</span>
                  </div>
                  <span className="app-header__spacer" aria-hidden="true" />
                </>
              )
            ) : (
              <>
                <Link
                  className="icon-button back-button"
                  href={backHref}
                  aria-label={brand.labels.back}
                >
                  <svg aria-hidden="true" viewBox="0 0 11 18">
                    <path d="m1.5 1.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
                <div className="app-header__titles">
                  <div className="app-header__title">{header.title}</div>
                  {header.subtitle ? (
                    <div className="app-header__subtitle">{header.subtitle}</div>
                  ) : null}
                </div>
                {screen.kind === 'viewer' ? (
                  <button
                    className="icon-button share-button"
                    type="button"
                    aria-label={brand.labels.share}
                    onClick={onShare}
                  >
                    <svg aria-hidden="true" viewBox="0 0 18 20">
                      <circle cx="13.5" cy="4.5" r="2.9" />
                      <circle cx="4.5" cy="10" r="2.9" />
                      <circle cx="13.5" cy="15.5" r="2.9" />
                      <path d="m11.1 6-4.1 2.6M7 11.4l4.1 2.6" />
                    </svg>
                  </button>
                ) : (
                  <span className="app-header__spacer" aria-hidden="true" />
                )}
              </>
            )}
          </header>

          <main className="shell-content">{children}</main>
        </div>
        {modal}
      </div>
    </div>
  )
}
