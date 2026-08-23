import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { BrandSubject } from '../core/brand-types'

type HomeScreenProps = {
  subjects: BrandSubject[]
  subjectHref: (subjectId: string) => string
}

type SubjectCardStyle = CSSProperties & { '--card-color': string }

export function HomeScreen({ subjects, subjectHref }: HomeScreenProps) {
  return (
    <div className="home-screen">
      <div className="subject-grid">
        {subjects.map((subject) => (
          <Link
            className="subject-card"
            href={subjectHref(subject.id)}
            key={subject.id}
            style={{ '--card-color': subject.cardColor } as SubjectCardStyle}
          >
            <span className="subject-card__label">{subject.label}</span>
            <img className="subject-card__icon" src={subject.icon} alt="" />
          </Link>
        ))}
      </div>
    </div>
  )
}
