import Link from 'next/link'
import type { BrandTool } from '../core/brand-types'

type ToolScreenProps = {
  tool: BrandTool
  /**
   * Resolved by the caller, which knows the brand. Absent means the tool has
   * nowhere to go, and no control is rendered rather than a dead one.
   */
  actionHref?: string
}

export function ToolScreen({ tool, actionHref }: ToolScreenProps) {
  return (
    <section className="tool-screen" aria-labelledby={`tool-${tool.id}`}>
      <h1 className="visually-hidden" id={`tool-${tool.id}`}>{tool.label}</h1>
      {tool.note ? <p className="tool-note">{tool.note}</p> : null}
      <ul className="tool-list" role="list">
        {tool.items.map((item, index) => (
          <li className="tool-list__item" key={`${tool.id}-${index}`}>
            <span className="tool-list__bullet" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {tool.action && actionHref ? (
        <Link className="tool-action" href={actionHref}>{tool.action.label}</Link>
      ) : null}
    </section>
  )
}
