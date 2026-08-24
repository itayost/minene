'use client'

import type { TenantKpis } from './types'

export type KpiState =
  | { status: 'loading' }
  | { status: 'error' }
  | ({ status: 'ready' } & TenantKpis)

export function KpiCards({ state }: { state: KpiState }) {
  if (state.status === 'error') {
    return <p className="kpi-cards__error" role="alert">לא הצלחנו לטעון את הנתונים</p>
  }

  const loading = state.status === 'loading'
  const value = (n: number) => (loading ? '—' : String(n))

  // growthPercent is null when there is no prior seven-day baseline, which is
  // the normal state for a tenant in its first fortnight. Rendering it as "חדש"
  // rather than 0% avoids falsely claiming flat growth.
  const growth = loading || state.status !== 'ready'
    ? '—'
    : state.growthPercent === null ? 'חדש' : `${state.growthPercent}%`

  return (
    <dl className="kpi-cards" dir="rtl">
      <div className="kpi-card">
        <dt>פריטי ידע</dt>
        <dd>{state.status === 'ready' ? value(state.knowledgeItems) : '—'}</dd>
      </div>
      <div className="kpi-card">
        <dt>פריטי איכות</dt>
        <dd>{state.status === 'ready' ? value(state.qualityItems) : '—'}</dd>
      </div>
      <div className="kpi-card">
        <dt>גידול שבועי</dt>
        <dd>{growth}</dd>
      </div>
    </dl>
  )
}
