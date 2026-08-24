'use client'

import Link from 'next/link'
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

type StepNumber = 1 | 2 | 3 | 4
type ChoiceLayout = 'chips' | 'cards'
type ChoiceIcon = 'bolt' | 'briefcase' | 'star' | 'clock'

const STYLE_ICONS: Record<VideoStyle, ChoiceIcon> = {
  encouraging: 'star',
  energetic: 'bolt',
  professional: 'briefcase',
}

function Icon({ name }: { name: ChoiceIcon }) {
  if (name === 'bolt') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z" />
      </svg>
    )
  }

  if (name === 'briefcase') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M9 7V5h6v2M4 7h16v12H4V7Zm0 5h16M10 12v2h4v-2" />
      </svg>
    )
  }

  if (name === 'star') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function choiceLabel<T>(options: readonly Choice<T>[], selected: T | null): string | null {
  if (selected === null) return null
  return options.find((option) => option.id === selected)?.label ?? null
}

function Step<T extends string | number>({
  number,
  title,
  hint,
  summaryLabel,
  options,
  selected,
  active,
  available,
  layout = 'chips',
  iconFor,
  onOpen,
  onSelect,
}: {
  number: StepNumber
  title: string
  hint: string
  summaryLabel: string
  options: readonly Choice<T>[]
  selected: T | null
  active: boolean
  available: boolean
  layout?: ChoiceLayout
  iconFor?: (id: T) => ChoiceIcon
  onOpen: () => void
  onSelect: (id: T) => void
}) {
  const selectedLabel = choiceLabel(options, selected)
  const state = active ? 'active' : selectedLabel ? 'complete' : 'locked'
  const panelId = `wizard-step-${number}-panel`
  const headerLabel = selectedLabel && !active
    ? `שלב ${number}, ${summaryLabel}: ${selectedLabel}, עריכה`
    : `שלב ${number}, ${title}`

  return (
    <section className={`wizard-step wizard-step--${number}`} data-state={state}>
      <button
        aria-controls={panelId}
        aria-current={active ? 'step' : undefined}
        aria-expanded={active}
        aria-label={headerLabel}
        className="wizard-step__header"
        disabled={!available}
        onClick={onOpen}
        type="button"
      >
        <span aria-hidden="true" className="wizard-step__badge">
          {selectedLabel && !active ? (
            <svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg>
          ) : number}
        </span>

        <span className="wizard-step__copy">
          <strong>{selectedLabel && !active ? `${summaryLabel}: ${selectedLabel}` : title}</strong>
          <span>{active ? hint : selectedLabel ? 'הבחירה נשמרה' : 'ייפתח לאחר הבחירה הקודמת'}</span>
        </span>

        <span className="wizard-step__action">
          {selectedLabel && !active ? 'עריכה' : active ? `שלב ${number}` : 'בהמשך'}
        </span>
      </button>

      {active ? (
        <div className="wizard-step__panel" id={panelId}>
          <div
            aria-label={title}
            className={`wizard-choices wizard-choices--${layout}`}
            role="group"
          >
            {options.map((option) => {
              const isSelected = selected === option.id
              const icon = iconFor?.(option.id)

              return (
                <button
                  aria-pressed={isSelected}
                  className="wizard-choice"
                  key={String(option.id)}
                  onClick={() => onSelect(option.id)}
                  type="button"
                >
                  {icon ? <span className="wizard-choice__icon"><Icon name={icon} /></span> : null}
                  <span className="wizard-choice__label">{option.label}</span>
                  <span aria-hidden="true" className="wizard-choice__check">
                    <svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function VideoWizard({ backHref }: { backHref: string }) {
  const [topic, setTopic] = useState<VideoTopic | null>(null)
  const [goal, setGoal] = useState<VideoGoal | null>(null)
  const [style, setStyle] = useState<VideoStyle | null>(null)
  const [length, setLength] = useState<VideoLength | null>(null)
  const [activeStep, setActiveStep] = useState<StepNumber>(1)
  const [summary, setSummary] = useState<string | null>(null)

  const selections = [
    choiceLabel(VIDEO_TOPICS, topic),
    choiceLabel(VIDEO_GOALS, goal),
    choiceLabel(VIDEO_STYLES, style),
    choiceLabel(VIDEO_LENGTHS, length),
  ].filter((selection): selection is string => selection !== null)
  const completedSteps = [topic !== null, goal !== null, style !== null, length !== null]
  const completedCount = selections.length
  const remainingCount = 4 - completedCount
  const isComplete = remainingCount === 0

  const choose = <T,>(setter: (value: T) => void, nextStep: StepNumber, value: T) => {
    setter(value)
    setSummary(null)
    setActiveStep(nextStep)
  }

  return (
    <div className="brain-surface wizard" dir="rtl">
      {/* Its own way back. The shell cannot supply one: resolveScreen does not
          recognise this path, so the header falls back to home chrome with no
          back control, which would leave the browser button as the only exit. */}
      <Link className="wizard__back" href={backHref}>
        <svg aria-hidden="true" viewBox="0 0 11 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m1.5 1.5 7.5 7.5-7.5 7.5" />
        </svg>
        <span>חזרה</span>
      </Link>

      <header className="wizard__intro">
        <h2 className="wizard__title">יוצרות סרטון הדרכה</h2>
        <p className="wizard__tagline">4 בחירות קצרות, ואת מוכנה</p>
        <p aria-live="polite" className="wizard__progress-copy">שלב {activeStep} מתוך 4</p>
        <div
          aria-label={`${completedCount} מתוך 4 בחירות הושלמו`}
          aria-valuemax={4}
          aria-valuemin={0}
          aria-valuenow={completedCount}
          className="wizard-progress"
          role="progressbar"
        >
          {([1, 2, 3, 4] as const).map((step) => (
            <span
              aria-hidden="true"
              className="wizard-progress__dot"
              data-state={step === activeStep ? 'active' : completedSteps[step - 1] ? 'complete' : 'upcoming'}
              key={step}
            >
              {completedSteps[step - 1] && step !== activeStep ? '✓' : step}
            </span>
          ))}
        </div>
      </header>

      <div className="wizard__steps">
        <Step
          active={activeStep === 1}
          available
          hint="על מה תרצי שהסרטון ידבר?"
          number={1}
          onOpen={() => setActiveStep(1)}
          onSelect={(value) => choose(setTopic, 2, value)}
          options={VIDEO_TOPICS}
          selected={topic}
          summaryLabel="נושא"
          title="בחרי נושא"
        />

        <Step
          active={activeStep === 2}
          available={topic !== null}
          hint="מה תרצי שהצוות יעשה אחרי הצפייה?"
          number={2}
          onOpen={() => setActiveStep(2)}
          onSelect={(value) => choose(setGoal, 3, value)}
          options={VIDEO_GOALS}
          selected={goal}
          summaryLabel="מטרה"
          title="מה תרצי שיקרה?"
        />

        <Step
          active={activeStep === 3}
          available={goal !== null}
          hint="בחרי את האופי של הסרטון"
          iconFor={(value) => STYLE_ICONS[value]}
          layout="cards"
          number={3}
          onOpen={() => setActiveStep(3)}
          onSelect={(value) => choose(setStyle, 4, value)}
          options={VIDEO_STYLES}
          selected={style}
          summaryLabel="סגנון"
          title="בחרי סגנון"
        />

        <Step
          active={activeStep === 4}
          available={style !== null}
          hint="קצר וממוקד עובד הכי טוב"
          iconFor={() => 'clock'}
          layout="cards"
          number={4}
          onOpen={() => setActiveStep(4)}
          onSelect={(value) => choose(setLength, 4, value)}
          options={VIDEO_LENGTHS}
          selected={length}
          summaryLabel="אורך"
          title="בחרי אורך"
        />
      </div>

      {summary ? (
        <section aria-label="הבחירות שלך" className="wizard-summary" role="status">
          <h3>הבריף שלך מוכן</h3>
          <p>{summary}</p>
          <p className="wizard-summary__note">
            הבחירות נשמרו כאן בלבד. יצירת הסרטון עצמו עדיין לא זמינה.
          </p>
        </section>
      ) : null}

      <div className="wizard__actions">
        {selections.length > 0 ? (
          <p aria-label="סיכום הבחירות" className="wizard-brief">{selections.join(' · ')}</p>
        ) : null}

        <button
          className="wizard-submit"
          disabled={!isComplete}
          onClick={() => {
            if (topic === null || goal === null || style === null || length === null) return
            setSummary(describeBrief({ topic, goal, style, length }))
          }}
          type="button"
        >
          <span className="wizard-submit__label">
            {isComplete ? 'צרי סרטון' : 'השלימי את הבחירות'}
          </span>
          {!isComplete ? (
            <span className="wizard-submit__note">נשארו {remainingCount} בחירות</span>
          ) : null}
        </button>
      </div>
    </div>
  )
}
