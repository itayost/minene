'use client'

import { useState, type FormEvent } from 'react'
import { RULE_TOPICS } from './topics'
import { useApiErrorHandler } from './use-api-error'

const FIRST_TOPIC_ID = RULE_TOPICS[0]?.id ?? 'live'

type Outcome =
  | { phase: 'idle' }
  | { phase: 'hunting' }
  | { phase: 'done'; ruleCount: number }
  | { phase: 'empty' }
  | { phase: 'failed'; message: string }

export type ExternalHuntApi = {
  huntExternal: (input: { topicId: string; subTopic?: string | null }) => Promise<unknown>
}

/**
 * "צייד ידע חיצוני": ask the system to go and look on the web for best practices
 * on a topic, instead of waiting for a document to arrive.
 *
 * Its own section rather than a third mode on the upload form, because it is the
 * one ingestion path that creates no document: there is nothing to name, nothing
 * to store, and nothing to appear in the documents list afterwards. The findings
 * go straight to the approval lobby, each carrying the page it came from.
 */
export function ExternalHunt({ rulesApi }: { rulesApi: ExternalHuntApi }) {
  const handleError = useApiErrorHandler()
  const [topicId, setTopicId] = useState(FIRST_TOPIC_ID)
  const [subTopic, setSubTopic] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ phase: 'idle' })

  const isBusy = outcome.phase === 'hunting'

  const hunt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setOutcome({ phase: 'hunting' })

    try {
      const result = await rulesApi.huntExternal({ topicId, subTopic: subTopic.trim() || null }) as
        { rules?: unknown[] } | null
      const ruleCount = result?.rules?.length ?? 0
      setOutcome(ruleCount === 0 ? { phase: 'empty' } : { phase: 'done', ruleCount })
    } catch (error) {
      const message = handleError(error)
      if (message) setOutcome({ phase: 'failed', message: 'החיפוש נכשל. נסי שוב מאוחר יותר.' })
    }
  }

  return (
    <section aria-label="חיפוש ידע חיצוני" className="external-hunt" dir="rtl">
      <h2>צייד ידע חיצוני</h2>
      <p className="upload-page__intro">
        חיפוש ברשת אחר שיטות עבודה מומלצות בנושא שתבחרי. כל המלצה נשמרת עם קישור למקור וממתינה
        לאישור בלובי.
      </p>

      <form className="upload-page__form" onSubmit={(event) => void hunt(event)}>
        <label htmlFor="hunt-topic">נושא</label>
        <select
          disabled={isBusy}
          id="hunt-topic"
          onChange={(event) => setTopicId(event.target.value)}
          value={topicId}
        >
          {RULE_TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
        </select>

        <label htmlFor="hunt-sub-topic">תת־נושא (לא חובה)</label>
        <input
          disabled={isBusy}
          id="hunt-sub-topic"
          maxLength={60}
          onChange={(event) => setSubTopic(event.target.value)}
          placeholder="לדוגמה: אזור הקופה"
          type="text"
          value={subTopic}
        />

        <button disabled={isBusy} type="submit">חיפוש ברשת</button>
      </form>

      {outcome.phase === 'hunting' ? (
        <p className="upload-page__status" role="status">מחפשת ברשת… זה עשוי לקחת כמה שניות.</p>
      ) : null}
      {outcome.phase === 'done' ? (
        <p className="upload-page__status" role="status">
          {`נמצאו ${outcome.ruleCount} המלצות חדשות, הממתינות לאישור בלובי.`}
        </p>
      ) : null}
      {/* Zero findings is a success with nothing to add, so it is a status
          rather than an alert. And it says WHY: "לא נמצא כלום" reads as a broken
          search when the real cause is almost always that everything found was
          already in the knowledge base. */}
      {outcome.phase === 'empty' ? (
        <p className="upload-page__status" role="status">
          לא נמצאו המלצות חדשות. ייתכן שכל מה שנמצא כבר קיים אצלך. נסי תת־נושא ממוקד יותר.
        </p>
      ) : null}
      {outcome.phase === 'failed' ? (
        <p className="upload-page__error" role="alert">{outcome.message}</p>
      ) : null}
    </section>
  )
}
