'use client'

import { BrainCard } from './BrainCard'
import { RuleVote } from './RuleVote'
import { getTopic } from './topics'
import type { Rule } from './types'

/**
 * One rule, as the floor sees it. Deliberately not the admin table's row: this
 * surface has no star, no status and no source column, because none of those are
 * decisions a person on the floor makes. What it has and the admin table does
 * not is the vote control -- the admin reads the aggregate, the floor produces
 * it.
 */
export function KnowledgeRow({
  rule,
  vote,
  isSaving,
  onVote,
  onClear,
}: {
  rule: Rule
  vote: boolean | undefined
  isSaving: boolean
  onVote: (ruleId: string, isLike: boolean) => void
  onClear: (ruleId: string) => void
}) {
  return (
    <BrainCard
      actions={
        <RuleVote
          isSaving={isSaving}
          onClear={onClear}
          onVote={onVote}
          ruleId={rule.id}
          vote={vote}
        />
      }
      as="li"
      head={
        <>
          <span>{`#${rule.rule_number}`}</span>
          {/* A row whose topic was retired is still a real row with a real
              subject, and a blank badge reads as a bug rather than as an
              unknown topic. */}
          <span>{getTopic(rule.topic_id)?.title ?? rule.topic_id}</span>
          {rule.sub_topic ? (
            <span className="knowledge-row__sub-topic">{rule.sub_topic}</span>
          ) : null}
          {/* An unrated rule shows nothing at all rather than a placeholder: the
              person reading it is the one being asked to rate it, and "טרם דורג"
              beside the buttons that would fix that is noise. */}
          {/* role="img" because a bare span is `generic`, which per ARIA does
              not support an accessible name -- so the score announced nothing
              at all, the opposite of what the label was for. The visible text
              stays aria-hidden and the label carries the long form. */}
          {rule.like_pct != null ? (
            <span
              aria-label={`${rule.like_pct} אחוז לייקים מתוך ${rule.vote_count} מצביעים`}
              className="knowledge-row__score"
              role="img"
            >
              <span aria-hidden="true">{rule.like_pct}%</span>
            </span>
          ) : null}
        </>
      }
    >
      {rule.text}

      {/* A case is a situation plus what to do about it. Rendering only the
          situation prints the incident and withholds the answer. */}
      {rule.kind === 'case' && rule.response ? (
        <p className="knowledge-row__response">
          <span className="knowledge-row__response-label">תגובה:</span> {rule.response}
        </p>
      ) : null}

      {/* Shown as a real link so a reader can judge the claim rather than take
          it on trust, which is the whole reason source_url exists. rel is not
          optional: the href is a URL a language model reported. */}
      {rule.source_url ? (
        <a
          className="knowledge-row__source"
          href={rule.source_url}
          rel="noopener noreferrer"
          target="_blank"
        >
          מקור חיצוני
        </a>
      ) : null}
    </BrainCard>
  )
}
