'use client'

import { useRef } from 'react'
import { BottomSheet } from './BottomSheet'
import { RULE_TOPICS } from './topics'
import type { Role, RuleKind, RulePolarity } from './types'

export type RuleDraft = {
  ruleId: string
  text: string
  kind: RuleKind
  topicId: string
  /** Empty string, not null: these are form values until they are saved. */
  subTopic: string
  polarity: '' | RulePolarity
  response: string
  roleIds: string[]
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
export function RuleEditSheet({ draft, error, isSaving, onCancel, onChange, onSave, roles }: {
  draft: RuleDraft
  error: string
  isSaving: boolean
  onCancel: () => void
  onChange: (draft: RuleDraft) => void
  onSave: () => void
  roles: readonly Role[]
}) {
  const isCase = draft.kind === 'case'
  const textRef = useRef<HTMLTextAreaElement>(null)

  const toggleRole = (roleId: string) => {
    const next = draft.roleIds.includes(roleId)
      ? draft.roleIds.filter((id) => id !== roleId)
      : [...draft.roleIds, roleId]
    onChange({ ...draft, roleIds: next })
  }

  return (
    <BottomSheet
      initialFocusRef={textRef}
      label="עריכת חוק"
      onDismiss={onCancel}
      openKey={draft.ruleId}
    >
        <h2 className="rule-edit-sheet__title">עריכת חוק</h2>

        <label className="rule-edit-sheet__field" htmlFor="rule-edit-text">
          <span>נוסח החוק</span>
          <textarea
            className="rule-edit-sheet__textarea"
            id="rule-edit-text"
            onChange={(event) => onChange({ ...draft, text: event.target.value })}
            ref={textRef}
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
              {/* A rule filed under a retired topic, or one the extractor
                  invented, is still a real rule. Without an option of its own
                  the select silently displays the first entry instead, and a
                  reviewer who only fixed a typo rewrote the subject too --
                  updateRule always sends topic_id. */}
              {RULE_TOPICS.some((topic) => topic.id === draft.topicId) ? null : (
                <option value={draft.topicId}>{draft.topicId}</option>
              )}
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
              <option value="case">מקרה</option>
            </select>
          </label>
        </div>

        <div className="rule-edit-sheet__row">
          <label className="rule-edit-sheet__field" htmlFor="rule-edit-sub-topic">
            <span>תת־נושא</span>
            <input
              className="rule-edit-sheet__select"
              id="rule-edit-sub-topic"
              maxLength={60}
              onChange={(event) => onChange({ ...draft, subTopic: event.target.value })}
              type="text"
              value={draft.subTopic}
            />
          </label>

          <label className="rule-edit-sheet__field" htmlFor="rule-edit-polarity">
            <span>עשה / אל תעשה</span>
            <select
              className="rule-edit-sheet__select"
              id="rule-edit-polarity"
              onChange={(event) => onChange({ ...draft, polarity: event.target.value as '' | RulePolarity })}
              value={draft.polarity}
            >
              <option value="">ללא</option>
              <option value="do">עשה</option>
              <option value="dont">אל תעשה</option>
            </select>
          </label>
        </div>

        {/* rules_response_matches_kind requires one, and refuses one on any
            other kind. A reviewer who can reclassify a rule as a case with no
            way to answer it has made the row unsaveable. */}
        {isCase ? (
          <label className="rule-edit-sheet__field" htmlFor="rule-edit-response">
            <span>התגובה</span>
            <textarea
              className="rule-edit-sheet__textarea"
              id="rule-edit-response"
              onChange={(event) => onChange({ ...draft, response: event.target.value })}
              rows={3}
              value={draft.response}
            />
          </label>
        ) : null}

        {roles.length ? (
          <fieldset className="rule-edit-sheet__roles">
            <legend>תפקידים</legend>
            {/* "No rows" in rule_roles is the default and it means everyone. An
                empty set of checkboxes reads as "nobody" unless it says so. */}
            <p className="rule-edit-sheet__hint">בלי סימון, החוק חל על כל התפקידים.</p>
            {roles.map((role) => (
              <label key={role.id}>
                <input
                  checked={draft.roleIds.includes(role.id)}
                  onChange={() => toggleRole(role.id)}
                  type="checkbox"
                />
                <span>{role.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {error ? <p className="rule-edit-sheet__error" role="alert">{error}</p> : null}

        <div className="rule-edit-sheet__actions">
          <button className="rule-edit-sheet__save" disabled={isSaving} onClick={onSave} type="button">
            שמירה
          </button>
          <button className="rule-edit-sheet__cancel" disabled={isSaving} onClick={onCancel} type="button">
            ביטול
          </button>
        </div>
    </BottomSheet>
  )
}
