import type { CSSProperties } from 'react'
import type { BrandSubject } from '../core/brand-types'

type HomeScreenProps = {
  subjects: BrandSubject[]
  onSubject: (subjectId: string) => void
}

type SubjectCardStyle = CSSProperties & { '--card-color': string }

export function HomeScreen({ subjects, onSubject }: HomeScreenProps) {
  return (
    <div className="home-screen">
      <div className="subject-grid">
        {subjects.map((subject) => (
          <button
            className="subject-card"
            key={subject.id}
            onClick={() => onSubject(subject.id)}
            style={{ '--card-color': subject.cardColor } as SubjectCardStyle}
            type="button"
          >
            <span className="subject-card__label">{subject.label}</span>
            <img className="subject-card__icon" src={subject.icon} alt="" />
          </button>
        ))}
      </div>
    </div>
  )
}
