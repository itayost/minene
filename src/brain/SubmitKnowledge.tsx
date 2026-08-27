'use client'

import { useState, type FormEvent } from 'react'
import { RULE_TOPICS } from './topics'
import { useApiErrorHandler } from './use-api-error'
import type { Rule, RuleKind, RulePolarity } from './types'

const FIRST_TOPIC_ID = RULE_TOPICS[0]?.id ?? 'live'

const KINDS: readonly { id: RuleKind; label: string }[] = [
  { id: 'tip', label: 'טיפ' },
  { id: 'process', label: 'תהליך' },
  { id: 'case', label: 'מקרה ותגובה' },
]

const POLARITIES: readonly { id: '' | RulePolarity; label: string }[] = [
  { id: '', label: 'ללא' },
  { id: 'do', label: 'עשה' },
  { id: 'dont', label: 'אל תעשה' },
]

const EMPTY = {
  topicId: FIRST_TOPIC_ID,
  kind: 'tip' as RuleKind,
  text: '',
  response: '',
  subTopic: '',
  polarity: '' as '' | RulePolarity,
}

type Draft = typeof EMPTY
type State = { status: 'idle' | 'saving'; message: string; isError: boolean }

const IDLE: State = { status: 'idle', message: '', isError: false }

export type SubmitKnowledgeApi = {
  submitInternalRule: (input: {
    topicId: string
    text: string
    kind?: RuleKind
    subTopic?: string | null
    polarity?: RulePolarity | null
    response?: string | null
  }) => Promise<Rule>
}

/**
 * "צייד ידע פנימי". The person who knows the trick is usually not the account
 * owner, so this is open to every member of the tenant: the review gate, not the
 * login, is what keeps quality up.
 *
 * Collapsed by default, because it sits above a list people came here to read.
 */
export function SubmitKnowledge({ rulesApi, onSubmitted }: {
  rulesApi: SubmitKnowledgeApi
  onSubmitted?: () => void
}) {
  const handleError = useApiErrorHandler()
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [state, setState] = useState<State>(IDLE)

  const isCase = draft.kind === 'case'
  const set = <K extends keyof Draft>(field: K) => (value: Draft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!draft.text.trim()) {
      setState({ status: 'idle', message: 'נא לכתוב את החוק.', isError: true })
      return
    }
    // rules_response_matches_kind rejects a case with no response at the
    // database level. Checking here too means the person is told which field is
    // missing, in front of the form, rather than the submission failing after a
    // round trip with a constraint name they cannot act on.
    if (isCase && !draft.response.trim()) {
      setState({ status: 'idle', message: 'למקרה צריך גם תגובה: מה עושים כשזה קורה.', isError: true })
      return
    }

    setState({ status: 'saving', message: '', isError: false })
    try {
      await rulesApi.submitInternalRule({
        topicId: draft.topicId,
        text: draft.text.trim(),
        kind: draft.kind,
        subTopic: draft.subTopic.trim() || null,
        polarity: draft.polarity || null,
        // Sent only for a case. A response left behind by a change of mind
        // fails the same constraint from the other direction.
        response: isCase ? draft.response.trim() : null,
      })
      setDraft(EMPTY)
      // Says what happens next, not just that it worked: a submission that
      // vanishes into a review queue with no explanation reads as a bug the
      // first time someone checks the list and cannot find what they added.
      setState({ status: 'idle', message: 'נשלח לאישור. החוק יופיע ברשימה אחרי שהמנהל יאשר אותו.', isError: false })
      onSubmitted?.()
    } catch (error) {
      // null means the handler is already sending them to sign in, so there is
      // nobody left to read a message on this page.
      if (handleError(error)) {
        // The draft is deliberately kept: retyping a paragraph because a request
        // failed is how someone stops contributing at all.
        setState({ status: 'idle', message: 'השליחה נכשלה. נסי שוב.', isError: true })
      }
    }
  }

  const notice = state.message
    ? (
      // role follows the KIND of message, not its position. This one node
      // carries both the confirmation and the failure, and announcing a success
      // as an alert interrupts a screen reader with an urgency it does not have.
      <p className="knowledge-message" role={state.isError ? 'alert' : 'status'}>{state.message}</p>
    )
    : null

  if (!isOpen) {
    return (
      <div className="knowledge-submit">
        <button className="knowledge-submit__open" onClick={() => setIsOpen(true)} type="button">
          הוספת ידע
        </button>
        {notice}
      </div>
    )
  }

  return (
    <form className="knowledge-submit knowledge-submit--open" onSubmit={(event) => void submit(event)}>
      <h3 className="knowledge-submit__title">הוספת ידע</h3>

      <label>
        <span>נושא</span>
        <select onChange={(event) => set('topicId')(event.target.value)} value={draft.topicId}>
          {RULE_TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
        </select>
      </label>

      <label>
        <span>תת־נושא</span>
        <input maxLength={60} onChange={(event) => set('subTopic')(event.target.value)} type="text" value={draft.subTopic} />
      </label>

      <label>
        <span>סוג</span>
        <select onChange={(event) => set('kind')(event.target.value as RuleKind)} value={draft.kind}>
          {KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
        </select>
      </label>

      <label>
        <span>עשה / אל תעשה</span>
        <select onChange={(event) => set('polarity')(event.target.value as '' | RulePolarity)} value={draft.polarity}>
          {POLARITIES.map((item) => <option key={item.id || 'none'} value={item.id}>{item.label}</option>)}
        </select>
      </label>

      <label className="knowledge-submit__wide">
        {/* The label changes with the kind, because for a case this field holds
            the situation rather than the rule. One field doing two jobs has to
            say which one it is doing. */}
        <span>{isCase ? 'המקרה' : 'החוק'}</span>
        <textarea onChange={(event) => set('text')(event.target.value)} rows={3} value={draft.text} />
      </label>

      {isCase ? (
        <label className="knowledge-submit__wide">
          <span>התגובה</span>
          <textarea onChange={(event) => set('response')(event.target.value)} rows={3} value={draft.response} />
        </label>
      ) : null}

      {notice}

      <div className="knowledge-submit__actions">
        <button disabled={state.status === 'saving'} type="submit">
          {state.status === 'saving' ? 'שולחת…' : 'שליחה לאישור'}
        </button>
        <button onClick={() => { setIsOpen(false); setState(IDLE) }} type="button">
          ביטול
        </button>
      </div>
    </form>
  )
}
