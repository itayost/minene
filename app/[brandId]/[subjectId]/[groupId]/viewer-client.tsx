'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useReportPagePosition, useShareTarget } from '../../brand-shell-client'
import { PageViewer } from '../../../../src/components/PageViewer'
import type { BrandManifest, ContentGroup } from '../../../../src/core/brand-types'
import { groupHref } from '../../../../src/core/hrefs'
import { progressEntryKey } from '../../../../src/core/progress'
import { useProgress } from '../../../../src/hooks/use-progress'

type ViewerClientProps = {
  brand: BrandManifest
  subjectId: string
  group: ContentGroup
  pageIndex: number
  hasExplicitPage: boolean
}

export function ViewerClient({
  brand,
  subjectId,
  group,
  pageIndex,
  hasExplicitPage,
}: ViewerClientProps) {
  const router = useRouter()
  const { read, remember } = useProgress(brand.id)
  const { register } = useShareTarget()
  const reportPosition = useReportPagePosition()
  const entryKey = progressEntryKey(subjectId, group.id)
  const restoredEntry = useRef<string | null>(null)

  // An explicit ?page= always wins. Only when it is absent does remembered
  // progress apply, and it replaces rather than pushes so history stays clean.
  // Restoring is a single decision per group, taken on arrival: the ref keeps a
  // later page turn, which makes this run again, from being second-guessed.
  useEffect(() => {
    if (restoredEntry.current === entryKey) return
    restoredEntry.current = entryKey
    if (hasExplicitPage) return

    const remembered = read()[entryKey]
    if (remembered === undefined) return

    const target = Math.max(0, Math.min(group.pages.length - 1, remembered))
    if (target !== pageIndex) router.replace(groupHref(brand.id, subjectId, group.id, target))
  }, [
    brand.id,
    entryKey,
    group.id,
    group.pages.length,
    hasExplicitPage,
    pageIndex,
    read,
    router,
    subjectId,
  ])

  // The header counter lives in the shell, which is rendered by the layout and
  // so has no page of its own to count. The position is reported to it here.
  useEffect(() => {
    reportPosition({ pageIndex, pageCount: group.pages.length })

    return () => reportPosition(null)
  }, [group.pages.length, pageIndex, reportPosition])

  // The share control lives in the shell header, which has no page context.
  // window.location.href is read inside the factory, so it runs at click time.
  useEffect(() => {
    const page = group.pages[pageIndex]
    if (!page) return

    register(() => ({
      brandId: brand.id,
      brandName: brand.name,
      groupId: group.id,
      groupName: group.label,
      page,
      pageIndex,
      currentUrl: window.location.href,
    }))

    return () => register(null)
  }, [brand.id, brand.name, group, pageIndex, register])

  const changePage = (nextIndex: number) => {
    remember(subjectId, group.id, nextIndex)
    // replace, not push: paging through eight pages must leave one history entry
    // so the back control still means "leave this group".
    router.replace(groupHref(brand.id, subjectId, group.id, nextIndex))
  }

  return (
    <PageViewer
      direction={brand.direction}
      group={group}
      pageIndex={pageIndex}
      onPageChange={changePage}
      onShare={() => undefined}
    />
  )
}
