'use client'

import { RULE_TOPICS } from './topics'
import type { RuleKind } from './types'

export type RuleDraft = {
  ruleId: string
  text: string
  kind: RuleKind
  topicId: string
}

/**
 * Corrects a rule's wording and classification before a decision is taken.
 *
 * Editing is deliberately not a review decision: a pending rule stays pending
 * after a correction, so the reviewer still has to approve or reject it. Topic
 * is editable because re-filing a rule the extractor put under the wrong topic
 * is the third correction a reviewer needs, and rejecting it was the only way to
 * do that before.
 */
export function RuleEditSheet({ draft, error, isSaving, onCancel, onChange, onSave }: {
  draft: RuleDraft
  error: string
  isSaving: boolean
  onCancel: () => void
  onChange: (draft: RuleDraft) => void
  onSave: () => void
}) {
  return (
    <div className="action-sheet-layer">
      <button
        aria-label="סגירת עריכה"
        className="action-sheet__backdrop"
        onClick={onCancel}
        type="button"
      />

      <section aria-label="עריכת חוק" className="rule-edit-sheet" dir="rtl">
        <h2 className="rule-edit-sheet__title">עריכת חוק</h2>

        <label className="rule-edit-sheet__field" htmlFor="rule-edit-text">
          <span>נוסח החוק</span>
          <textarea
            className="rule-edit-sheet__textarea"
            id="rule-edit-text"
            onChange={(event) => onChange({ ...draft, text: event.target.value })}
            rows={4}
            value={draft.text}
          />
        </label>

        <div className="rule-edit-sheet__row">
          <label className="rule-edit-sheet__field" htmlFor="rule-edit-topic">
            <span>נושא</span>
            <select
              className="rule-edit-sheet__select"
              id="rule-edit-topic"
              onChange={(event) => onChange({ ...draft, topicId: event.target.value })}
              value={draft.topicId}
            >
              {RULE_TOPICS.map((topic) => (
                <option key={topic.id} value={topic.id}>{topic.title}</option>
              ))}
            </select>
          </label>

          <label className="rule-edit-sheet__field" htmlFor="rule-edit-kind">
            <span>סוג</span>
            <select
              className="rule-edit-sheet__select"
              id="rule-edit-kind"
              onChange={(event) => onChange({ ...draft, kind: event.target.value as RuleKind })}
              value={draft.kind}
            >
              <option value="tip">טיפ</option>
              <option value="process">תהליך</option>
            </select>
          </label>
        </div>

        {error ? <p className="rule-edit-sheet__error" role="alert">{error}</p> : null}

        <div className="rule-edit-sheet__actions">
          <button className="rule-edit-sheet__save" disabled={isSaving} onClick={onSave} type="button">
            שמירה
          </button>
          <button className="rule-edit-sheet__cancel" disabled={isSaving} onClick={onCancel} type="button">
            ביטול
          </button>
        </div>
      </section>
    </div>
  )
}
