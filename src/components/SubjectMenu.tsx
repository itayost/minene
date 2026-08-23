import Link from 'next/link'
import type { BrandSubject } from '../core/brand-types'

type SubjectMenuProps = {
  subject: BrandSubject
  groupHref: (groupId: string) => string
}

export function SubjectMenu({ subject, groupHref }: SubjectMenuProps) {
  return (
    <section className="subject-menu" aria-labelledby={`subject-menu-${subject.id}`}>
      <header className="subject-menu__heading">
        <img className="subject-menu__mark" src={subject.icon} alt="" />
        <h1 id={`subject-menu-${subject.id}`}>{subject.label}</h1>
        <span className="subject-menu__underline" aria-hidden="true" />
      </header>

      <div className="subject-menu__groups">
        {subject.groups.map((group) => (
          <Link className="group-card" href={groupHref(group.id)} key={group.id}>
            <span className="group-card__icon-wrap" aria-hidden="true">
              <img className="group-card__icon" src={group.icon ?? subject.icon} alt="" />
            </span>
            <span className="group-card__label">{group.label}</span>
            <span className="group-card__arrow" aria-hidden="true">
              <svg viewBox="0 0 12 20">
                <path d="m2.5 2 7 8-7 8" />
              </svg>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
