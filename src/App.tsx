import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrandNotFound } from './components/BrandNotFound'
import { BrandShell } from './components/BrandShell'
import { HomeScreen } from './components/HomeScreen'
import { PageViewer } from './components/PageViewer'
import { ShareSheet } from './components/ShareSheet'
import { SubjectMenu } from './components/SubjectMenu'
import { ToolScreen } from './components/ToolScreen'
import { brandRegistry, resolveBrandId } from './core/brand-registry'
import type { BrandManifest, ContentGroup } from './core/brand-types'
import {
  createInitialScreen,
  reduceNavigation,
  type NavigationAction,
  type Screen,
} from './core/navigation'
import type { PageActionContext } from './core/page-actions'
import {
  progressEntryKey,
  readProgress,
  writeProgress,
  type ProgressMap,
} from './core/progress'

type AppProps = {
  pathname?: string
  registry?: ReadonlyMap<string, BrandManifest>
  storage?: Storage
}

type ApplicationState = {
  screen: Screen
  progress: ProgressMap
  progressRevision: number
}

type CurrentViewer = {
  group: ContentGroup
  context: PageActionContext
}

function viewerFor(brand: BrandManifest, screen: Screen): CurrentViewer | undefined {
  if (screen.kind !== 'viewer') return undefined

  const subject = brand.subjects.find((candidate) => candidate.id === screen.subjectId)
  const group = subject?.groups.find((candidate) => candidate.id === screen.groupId)
  const page = group?.pages[screen.pageIndex]
  if (!subject || !group || !page) return undefined

  return {
    group,
    context: {
      brandId: brand.id,
      brandName: brand.name,
      groupId: group.id,
      groupName: group.label,
      page,
      pageIndex: screen.pageIndex,
      currentUrl: window.location.href,
    },
  }
}

function contentFor(
  brand: BrandManifest,
  screen: Screen,
  viewer: CurrentViewer | undefined,
  onSubject: (subjectId: string) => void,
  onGroup: (subjectId: string, groupId: string) => void,
  onPageChange: (pageIndex: number) => void,
  onShare: () => void,
): ReactNode {
  if (screen.kind === 'home') {
    return <HomeScreen subjects={brand.subjects} onSubject={onSubject} />
  }

  if (screen.kind === 'menu') {
    const subject = brand.subjects.find((candidate) => candidate.id === screen.subjectId)
    return subject
      ? <SubjectMenu subject={subject} onGroup={(groupId) => onGroup(subject.id, groupId)} />
      : <HomeScreen subjects={brand.subjects} onSubject={onSubject} />
  }

  if (screen.kind === 'viewer' && viewer) {
    return (
      <PageViewer
        direction={brand.direction}
        group={viewer.group}
        pageIndex={screen.pageIndex}
        onPageChange={onPageChange}
        onShare={onShare}
      />
    )
  }

  if (screen.kind === 'tool') {
    const tool = brand.tools.find((candidate) => candidate.id === screen.toolId)
    return tool
      ? <ToolScreen tool={tool} />
      : <HomeScreen subjects={brand.subjects} onSubject={onSubject} />
  }

  return <HomeScreen subjects={brand.subjects} onSubject={onSubject} />
}

function BrandApplication({ brand, storage }: { brand: BrandManifest; storage: Storage }) {
  const [application, setApplication] = useState<ApplicationState>(() => ({
    screen: createInitialScreen(),
    progress: readProgress(storage, brand.id),
    progressRevision: 0,
  }))
  const [isShareOpen, setIsShareOpen] = useState(false)
  const progressRef = useRef(application.progress)
  progressRef.current = application.progress

  useEffect(() => {
    if (application.progressRevision === 0) return
    writeProgress(storage, brand.id, progressRef.current)
  }, [application.progressRevision, brand.id, storage])

  const navigate = (action: NavigationAction) => {
    setIsShareOpen(false)
    setApplication((current) => ({
      ...current,
      screen: reduceNavigation(brand, current.screen, action, current.progress),
    }))
  }

  const selectPage = (pageIndex: number) => {
    setIsShareOpen(false)
    setApplication((current) => {
      const screen = reduceNavigation(
        brand,
        current.screen,
        { type: 'page-select', pageIndex },
        current.progress,
      )
      if (screen.kind !== 'viewer') return { ...current, screen }

      const progress = {
        ...current.progress,
        [progressEntryKey(screen.subjectId, screen.groupId)]: screen.pageIndex,
      }
      return {
        screen,
        progress,
        progressRevision: current.progressRevision + 1,
      }
    })
  }

  const viewer = viewerFor(brand, application.screen)
  const openShare = () => {
    if (viewer) setIsShareOpen(true)
  }
  const currentContent = contentFor(
    brand,
    application.screen,
    viewer,
    (subjectId) => navigate({ type: 'open-subject', subjectId }),
    (subjectId, groupId) => navigate({ type: 'open-group', subjectId, groupId }),
    selectPage,
    openShare,
  )

  return (
    <>
      <BrandShell
        brand={brand}
        screen={application.screen}
        onBack={() => navigate({ type: 'back' })}
        onHome={() => navigate({ type: 'home' })}
        onShare={openShare}
        onTool={(toolId) => navigate({ type: 'open-tool', toolId })}
      >
        {currentContent}
        {isShareOpen && viewer ? (
          <ShareSheet
            context={viewer.context}
            labels={brand.labels}
            onClose={() => setIsShareOpen(false)}
          />
        ) : null}
      </BrandShell>
    </>
  )
}

export function App({
  pathname = window.location.pathname,
  registry = brandRegistry,
  storage = window.localStorage,
}: AppProps) {
  const brandId = resolveBrandId(pathname)
  const brand = registry.get(brandId)

  if (!brand) return <BrandNotFound brandId={brandId} />
  return <BrandApplication key={brand.id} brand={brand} storage={storage} />
}
