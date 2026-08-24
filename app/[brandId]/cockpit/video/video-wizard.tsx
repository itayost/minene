'use client'

import { useState } from 'react'
import {
  describeBrief,
  VIDEO_GOALS,
  VIDEO_LENGTHS,
  VIDEO_STYLES,
  VIDEO_TOPICS,
  type Choice,
  type VideoGoal,
  type VideoLength,
  type VideoStyle,
  type VideoTopic,
} from '../../../../src/cockpit/video-options'

/**
 * All three steps are on one screen rather than three routes. They are one
 * decision with three parts, and the earlier answers matter most at the moment
 * the reader is making the third -- routing would hide them exactly then.
 */
function Step<T extends string | number>({ number, title, hint, options, selected, onSelect }: {
  number: number
  title: string
  hint: string
  options: readonly Choice<T>[]
  selected: T | null
  onSelect: (id: T) => void
}) {
  return (
    <section aria-label={title} className={`wizard-step wizard-step--${number}`}>
      <span aria-hidden="true" className="wizard-step__number">{number}</span>
      <div className="wizard-step__body">
        <h3 className="wizard-step__title">{title}</h3>
        <p className="wizard-step__hint">{hint}</p>
        <div className="wizard-choices" role="group">
          {options.map((option) => (
            <button
              aria-pressed={selected === option.id}
              className="wizard-choice"
              key={String(option.id)}
              onClick={() => onSelect(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

export function VideoWizard() {
  const [topic, setTopic] = useState<VideoTopic | null>(null)
  const [goal, setGoal] = useState<VideoGoal | null>(null)
  const [style, setStyle] = useState<VideoStyle | null>(null)
  const [length, setLength] = useState<VideoLength | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const isComplete = topic !== null && goal !== null && style !== null && length !== null

  return (
    <div className="brain-surface wizard" dir="rtl">
      <header className="wizard__intro">
        <h2 className="wizard__title">יוצרת סרטון וידאו בשלוש לחיצות</h2>
        <p className="wizard__tagline">פשוט. מהיר. אפקטיבי</p>
      </header>

      <Step
        hint="בחרי נושא להדרכה"
        number={1}
        onSelect={setTopic}
        options={VIDEO_TOPICS}
        selected={topic}
        title="על מה הסרטון?"
      />

      <Step
        hint="בחרי את המסר / הפעולה הרצויה"
        number={2}
        onSelect={setGoal}
        options={VIDEO_GOALS}
        selected={goal}
        title="מה אני רוצה שיקרה?"
      />

      {/* The third step carries two choices rather than one, so it is laid out
          as two labelled groups inside a single step. */}
      <section aria-label="איזה סרטון?" className="wizard-step wizard-step--3">
        <span aria-hidden="true" className="wizard-step__number">3</span>
        <div className="wizard-step__body">
          <h3 className="wizard-step__title">איזה סרטון?</h3>
          <p className="wizard-step__hint">בחרי סגנון ואורך</p>

          <div className="wizard-pair">
            <div>
              <h4 className="wizard-pair__label">סגנון</h4>
              <div className="wizard-choices" role="group" aria-label="סגנון">
                {VIDEO_STYLES.map((option) => (
                  <button
                    aria-pressed={style === option.id}
                    className="wizard-choice"
                    key={option.id}
                    onClick={() => setStyle(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h4 className="wizard-pair__label">אורך</h4>
              <div className="wizard-choices" role="group" aria-label="אורך">
                {VIDEO_LENGTHS.map((option) => (
                  <button
                    aria-pressed={length === option.id}
                    className="wizard-choice"
                    key={option.id}
                    onClick={() => setLength(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <button
        className="wizard-submit"
        disabled={!isComplete}
        onClick={() => {
          if (!isComplete) return
          setSummary(describeBrief({ topic, goal, style, length }))
        }}
        type="button"
      >
        <span className="wizard-submit__label">צורו סרטון!</span>
        <span className="wizard-submit__note">בלחיצה אחת</span>
      </button>

      {summary ? (
        <section aria-label="הבחירות שלך" className="wizard-summary" role="status">
          <h3>הבחירות שלך</h3>
          <p>{summary}</p>
          {/* Says plainly that nothing was produced. Implying a render is coming
              would be a promise this screen cannot keep. */}
          <p className="wizard-summary__note">
            הבחירות נשמרו כאן בלבד. יצירת הסרטון עצמו עדיין לא זמינה.
          </p>
        </section>
      ) : null}
    </div>
  )
}
