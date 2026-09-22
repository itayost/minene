'use client'

import type { Counts } from './use-live-counts'

const he = new Intl.NumberFormat('he-IL')

const time = (at: Date) => at.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

/**
 * Three measured numbers and one cap. No projection and no run rate: the
 * product's own rule is that measured overwrites invented, and "on track for"
 * is invented.
 */
export function Counters({
  counts,
  dailyCap,
  stale,
  lastOk,
  onRefresh,
}: {
  counts: Counts | null
  dailyCap: number
  stale: boolean
  lastOk: Date | null
  onRefresh: () => void
}) {
  if (!counts) {
    // `stale` here means the FIRST read failed, not merely that a later one
    // did -- there are no last-good numbers to fall back to yet. Rendering the
    // loading line forever would leave the reader with a permanent spinner and
    // no way out except reloading the page, which is exactly the silent-stop
    // failure mode this instrument's own design argues against.
    if (stale) {
      return (
        <div className="counters" dir="rtl">
          <p className="counters__state" role="status">
            {`לא הצלחנו לטעון את המונים. הקריאה האחרונה שהצליחה: ${lastOk ? time(lastOk) : 'לא הייתה'}`}
          </p>
          <button className="counters__refresh" onClick={onRefresh} type="button">
            רענון
          </button>
        </div>
      )
    }
    return (
      <p className="counters__loading" dir="rtl">
        טוען מונים…
      </p>
    )
  }

  return (
    <div className="counters" dir="rtl">
      <div className="counters__figure">
        <b>{he.format(counts.total)}</b>
        <span>סימולציות עד כה</span>
      </div>
      <div className="counters__figure">
        <b>{he.format(counts.today)}</b>
        <span>נוספו היום</span>
      </div>
      {/* Attempts, not runs: the cap bounds jobs claimed, whatever their
          outcome, because a failed job has already spent its model calls. */}
      <div className="counters__figure">
        <b>{`${he.format(counts.attemptsToday)} מתוך ${he.format(dailyCap)}`}</b>
        <span>ניסיונות היום, מתוך התקרה</span>
      </div>
      <p className="counters__state" role="status">
        {stale
          ? `לא מתעדכן. הקריאה האחרונה שהצליחה: ${lastOk ? time(lastOk) : 'לא הייתה'}`
          : `מתעדכן. עודכן ${lastOk ? time(lastOk) : ''}`}
      </p>
      <button className="counters__refresh" onClick={onRefresh} type="button">
        רענון
      </button>
    </div>
  )
}
