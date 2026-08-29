'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { NOT_WIRED } from './not-wired'

type HomeTool = {
  title: string
  /** What the card does. Eight titles alone are eight guesses. */
  subtitle: string
  icon: string
  /* Set only for tools that have a screen to go to. The rest render as
     buttons that say they are not connected yet. */
  href?: string
}

/**
 * The home catalog.
 *
 * Titles are spans rather than headings: a button's content model is phrasing
 * content, so an h3 inside one is invalid, and as controls their names are
 * already announced. The section's own h2 carries the outline.
 */
export function ToolsGrid({ tools }: { tools: readonly HomeTool[] }) {
  const [notice, setNotice] = useState('')

  return (
    <>
      <ul className="cockpit-tools__grid" role="list">
        {tools.map((tool) => {
          const inner = (
            <>
              <span className="cockpit-tool__icon">
                <Image alt="" height={56} src={tool.icon} width={56} />
              </span>
              <span className="cockpit-tool__title">{tool.title}</span>
              <span className="cockpit-tool__subtitle">{tool.subtitle}</span>
            </>
          )

          return (
            <li key={tool.title}>
              {tool.href ? (
                <Link className="cockpit-tool" href={tool.href}>
                  {inner}
                </Link>
              ) : (
                <button className="cockpit-tool" onClick={() => setNotice(NOT_WIRED)} type="button">
                  {inner}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <p aria-live="polite" className="cockpit-tools__notice">
        {notice}
      </p>
    </>
  )
}
