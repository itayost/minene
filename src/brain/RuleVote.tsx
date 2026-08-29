'use client'

/**
 * Three states, not two. `vote` is true (liked), false (disliked) or undefined
 * (has not voted), and pressing the side already chosen withdraws the vote
 * rather than re-casting it: a vote you cannot take back is a vote people stop
 * casting honestly.
 *
 * Withdrawing is not the same as switching sides, which is why this is two
 * toggles rather than a three-position control: a cleared vote leaves the
 * denominator, a dislike stays in it.
 */
export function RuleVote({
  ruleId,
  vote,
  isSaving,
  onVote,
  onClear,
}: {
  ruleId: string
  vote: boolean | undefined
  isSaving: boolean
  onVote: (ruleId: string, isLike: boolean) => void
  onClear: (ruleId: string) => void
}) {
  const press = (next: boolean) => {
    if (vote === next) onClear(ruleId)
    else onVote(ruleId, next)
  }

  return (
    <div aria-label="דירוג החוק" className="rule-vote" role="group">
      <button
        // aria-pressed, not a checked radio: these are toggles, and a radio
        // group cannot express "neither chosen" once a choice has been made.
        aria-label={vote === true ? 'ביטול הלייק' : 'הוסיפי לייק'}
        aria-pressed={vote === true}
        className="rule-vote__button"
        data-direction="up"
        disabled={isSaving}
        onClick={() => press(true)}
        type="button"
      >
        <ThumbIcon />
      </button>
      <button
        aria-label={vote === false ? 'ביטול הדיסלייק' : 'סימון שהחוק לא עובד'}
        aria-pressed={vote === false}
        className="rule-vote__button"
        data-direction="down"
        disabled={isSaving}
        onClick={() => press(false)}
        type="button"
      >
        <ThumbIcon />
      </button>
    </div>
  )
}

/**
 * One thumb, pointing up. The down button rotates it in CSS off
 * data-direction, so both buttons stay one shape and the pair cannot drift
 * apart visually.
 */
function ThumbIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M7 10.5v9h-3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4.2-7a1.6 1.6 0 0 1 2.9 1.2l-.7 3.6h4.4a2 2 0 0 1 2 2.4l-1.2 6a2 2 0 0 1-2 1.6H7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}
