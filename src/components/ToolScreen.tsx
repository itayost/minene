import type { BrandTool } from '../core/brand-types'

type ToolScreenProps = {
  tool: BrandTool
}

export function ToolScreen({ tool }: ToolScreenProps) {
  return (
    <section className="tool-screen" aria-labelledby={`tool-${tool.id}`}>
      <h1 className="visually-hidden" id={`tool-${tool.id}`}>{tool.label}</h1>
      {tool.note ? <p className="tool-note">{tool.note}</p> : null}
      <ul className="tool-list">
        {tool.items.map((item, index) => (
          <li className="tool-list__item" key={`${tool.id}-${index}`}>
            <span className="tool-list__bullet" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
