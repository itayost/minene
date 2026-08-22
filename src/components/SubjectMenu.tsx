import type { BrandSubject } from '../core/brand-types'

type SubjectMenuProps = {
  subject: BrandSubject
  onGroup: (groupId: string) => void
}

export function SubjectMenu({ subject, onGroup }: SubjectMenuProps) {
  return (
    <section className="subject-menu" aria-labelledby={`subject-menu-${subject.id}`}>
      <header className="subject-menu__heading">
        <img className="subject-menu__mark" src={subject.icon} alt="" />
        <h1 id={`subject-menu-${subject.id}`}>{subject.label}</h1>
        <span className="subject-menu__underline" aria-hidden="true" />
      </header>

      <div className="subject-menu__groups">
        {subject.groups.map((group) => (
          <button className="group-card" key={group.id} onClick={() => onGroup(group.id)} type="button">
            <span className="group-card__icon-wrap" aria-hidden="true">
              <img className="group-card__icon" src={group.icon ?? subject.icon} alt="" />
            </span>
            <span className="group-card__label">{group.label}</span>
            <span className="group-card__arrow" aria-hidden="true">
              <svg viewBox="0 0 12 20">
                <path d="m2.5 2 7 8-7 8" />
              </svg>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
