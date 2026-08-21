import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { BrandManifest } from '../core/brand-types'
import type { Screen } from '../core/navigation'

type BrandShellProps = {
  brand: BrandManifest
  screen: Screen
  children: ReactNode
  onBack: () => void
  onHome: () => void
  onShare: () => void
  onTool: (toolId: string) => void
}

type ThemeStyle = CSSProperties & {
  '--primary': string
  '--primary-strong': string
  '--text': string
  '--muted': string
  '--background': string
  '--surface': string
  '--border': string
  '--font-family': string
}

const homeIcon = (
  <svg aria-hidden="true" viewBox="0 0 23 22">
    <path d="M2 9.5 11.5 2 21 9.5" />
    <path d="M4 8v11a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8" />
  </svg>
)

function findHeaderContent(brand: BrandManifest, screen: Screen) {
  if (screen.kind === 'home') return { title: '', subtitle: '' }
  if (screen.kind === 'tool') {
    return { title: brand.tools.find((tool) => tool.id === screen.toolId)?.label ?? '', subtitle: '' }
  }

  const subject = brand.subjects.find((candidate) => candidate.id === screen.subjectId)
  if (screen.kind === 'menu') {
    return { title: subject?.label ?? '', subtitle: '' }
  }

  const group = subject?.groups.find((candidate) => candidate.id === screen.groupId)
  const pageCount = group?.pages.length ?? 0
  const pagePosition = pageCount > 0 ? `${screen.pageIndex + 1} / ${pageCount}` : ''
  return {
    title: subject?.label ?? '',
    subtitle: subject && subject.groups.length > 1 && group
      ? `${group.label} · ${pagePosition}`
      : pagePosition,
  }
}

export function BrandShell({ brand, screen, children, onBack, onHome, onShare, onTool }: BrandShellProps) {
  useEffect(() => {
    const root = document.documentElement
    const previousLang = root.getAttribute('lang')
    const previousDirection = root.getAttribute('dir')
    const previousTitle = document.title

    root.lang = brand.locale
    root.dir = brand.direction
    document.title = brand.title

    return () => {
      if (previousLang === null) root.removeAttribute('lang')
      else root.lang = previousLang

      if (previousDirection === null) root.removeAttribute('dir')
      else root.dir = previousDirection

      document.title = previousTitle
    }
  }, [brand.direction, brand.locale, brand.title])

  const themeStyle: ThemeStyle = {
    '--primary': brand.theme.primary,
    '--primary-strong': brand.theme.primaryStrong,
    '--text': brand.theme.text,
    '--muted': brand.theme.muted,
    '--background': brand.theme.background,
    '--surface': brand.theme.surface,
    '--border': brand.theme.border,
    '--font-family': brand.theme.fontFamily,
  }
  const isHome = screen.kind === 'home'
  const header = findHeaderContent(brand, screen)

  return (
    <div className="app-stage" style={themeStyle}>
      <div className="brand-shell" dir={brand.direction} lang={brand.locale}>
        <div className="status-bar" aria-hidden="true">
          <span>9:41</span>
          <span className="status-bar__icons">
            <svg viewBox="0 0 17 11">
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="4.5" y="5" width="3" height="6" rx="1" />
              <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
              <rect x="13.5" width="3" height="11" rx="1" />
            </svg>
            <svg viewBox="0 0 25 12">
              <rect className="status-bar__battery" x="0.5" y="0.5" width="19" height="11" rx="3" />
              <rect x="2" y="2" width="14" height="8" rx="1.8" />
              <path d="M21.5 4v4a2.2 2.2 0 0 0 0-4Z" />
            </svg>
          </span>
        </div>

        <header className={`app-header ${isHome ? 'app-header--home' : 'app-header--inner'}`}>
          {isHome ? (
            <>
              <span className="app-header__spacer" aria-hidden="true" />
              <div className="brand-lockup">
                <img className="brand-lockup__logo" src={brand.logo.src} alt={brand.logo.alt} />
                <span className="brand-lockup__name">{brand.name}</span>
              </div>
              <span className="app-header__spacer" aria-hidden="true" />
            </>
          ) : (
            <>
              <button className="icon-button back-button" type="button" aria-label={brand.labels.back} onClick={onBack}>
                <svg aria-hidden="true" viewBox="0 0 11 18"><path d="m1.5 1.5 7.5 7.5-7.5 7.5" /></svg>
              </button>
              <div className="app-header__titles">
                <div className="app-header__title">{header.title}</div>
                {header.subtitle ? <div className="app-header__subtitle">{header.subtitle}</div> : null}
              </div>
              <button className="icon-button share-button" type="button" aria-label={brand.labels.share} onClick={onShare}>
                <svg aria-hidden="true" viewBox="0 0 18 20">
                  <circle cx="13.5" cy="4.5" r="2.9" />
                  <circle cx="4.5" cy="10" r="2.9" />
                  <circle cx="13.5" cy="15.5" r="2.9" />
                  <path d="m11.1 6-4.1 2.6M7 11.4l4.1 2.6" />
                </svg>
              </button>
            </>
          )}
        </header>

        <main className="shell-content">{children}</main>

        <nav className="bottom-nav" aria-label={brand.labels.navigation}>
          <button
            className="bottom-nav__action"
            type="button"
            aria-current={isHome ? 'page' : undefined}
            onClick={onHome}
          >
            {homeIcon}
            <span>{brand.labels.home}</span>
          </button>
          {brand.tools.map((tool) => (
            <button
              className="bottom-nav__action"
              key={tool.id}
              type="button"
              aria-current={screen.kind === 'tool' && screen.toolId === tool.id ? 'page' : undefined}
              onClick={() => onTool(tool.id)}
            >
              <img src={tool.icon} alt="" />
              <span>{tool.label}</span>
            </button>
          ))}
        </nav>

        <div className="home-indicator" aria-hidden="true"><span /></div>
      </div>
    </div>
  )
}
