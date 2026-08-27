import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuleEditSheet, type RuleDraft } from '../../src/brain/RuleEditSheet'
import type { Role } from '../../src/brain/types'
import { makeRule } from '../fixtures/rule'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/lobby',
}))
vi.mock('../../src/auth/supabase-browser', () => ({ createBrowserSupabase: () => ({}) }))

const ROLES: Role[] = [
  { id: 'role-1', name: 'מנהלת חנות', sortOrder: 10 },
  { id: 'role-2', name: 'מוכרת', sortOrder: 20 },
]

const DRAFT: RuleDraft = {
  ruleId: 'rule-1',
  text: 'לחייך',
  kind: 'tip',
  topicId: 'store',
  subTopic: '',
  polarity: '',
  response: '',
  roleIds: [],
}

function sheet(overrides: Partial<RuleDraft> = {}) {
  const onChange = vi.fn()
  const draft = { ...DRAFT, ...overrides }
  render(
    <RuleEditSheet
      draft={draft}
      error=""
      isSaving={false}
      onCancel={vi.fn()}
      onChange={onChange}
      onSave={vi.fn()}
      roles={ROLES}
    />,
  )
  return { onChange, user: userEvent.setup() }
}

describe('correcting every axis a rule has', () => {
  it('offers a case as a kind, not only a tip and a process', async () => {
    const { onChange, user } = sheet()
    await user.selectOptions(screen.getByLabelText('סוג'), 'case')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'case' }))
  })

  it('asks for a response only once the rule is a case', () => {
    sheet({ kind: 'tip' })
    expect(screen.queryByLabelText('התגובה')).toBeNull()
  })

  it('asks for the response as soon as it is one', () => {
    sheet({ kind: 'case' })

    // rules_response_matches_kind requires it, and a reviewer who can reclassify
    // a rule as a case with no way to answer it has made the row unsaveable.
    expect(screen.getByLabelText('התגובה')).toBeVisible()
  })

  it('lets a wrong sub-topic be corrected', async () => {
    const { onChange, user } = sheet()
    await user.type(screen.getByLabelText('תת־נושא'), 'ק')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ subTopic: 'ק' }))
  })

  it('lets a rule be marked as a prohibition', async () => {
    const { onChange, user } = sheet()
    await user.selectOptions(screen.getByLabelText('עשה / אל תעשה'), 'dont')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ polarity: 'dont' }))
  })
})

describe('the edit sheet as a sheet', () => {
  it('closes on Escape, like every other sheet', async () => {
    const onCancel = vi.fn()
    render(
      <RuleEditSheet
        draft={DRAFT}
        error=""
        isSaving={false}
        onCancel={onCancel}
        onChange={vi.fn()}
        onSave={vi.fn()}
        roles={ROLES}
      />,
    )
    await userEvent.setup().keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalled()
  })

  it('puts focus on the rule text when it opens', () => {
    render(
      <RuleEditSheet
        draft={DRAFT}
        error=""
        isSaving={false}
        onCancel={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        roles={ROLES}
      />,
    )

    // The field a reviewer came to correct, not the topic select above it.
    expect(screen.getByLabelText('נוסח החוק')).toHaveFocus()
  })
})

describe('who a rule is addressed to', () => {
  it('checks the roles it already addresses', () => {
    sheet({ roleIds: ['role-2'] })

    expect(screen.getByRole('checkbox', { name: 'מוכרת' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'מנהלת חנות' })).not.toBeChecked()
  })

  it('sends the whole intended set, not the one that changed', async () => {
    const { onChange, user } = sheet({ roleIds: ['role-2'] })
    await user.click(screen.getByRole('checkbox', { name: 'מנהלת חנות' }))

    // setRuleRoles replaces rather than merges, so what this sends IS the final
    // state. An additive payload could never uncheck one.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ roleIds: ['role-2', 'role-1'] }))
  })

  it('says what checking nothing means, rather than leaving it to be guessed', () => {
    sheet()

    // "No rows" in the join table is the default, and it means everyone. An
    // empty set of checkboxes reads as "nobody" unless it says otherwise.
    expect(screen.getByText(/כל התפקידים/)).toBeVisible()
  })
})

const rulesApi = vi.hoisted(() => ({
  listPendingRules: vi.fn(),
  updateRule: vi.fn(),
  approveRule: vi.fn(),
  rejectRule: vi.fn(),
  loadKpis: vi.fn(),
  huntExternal: vi.fn(),
}))
const documentsApi = vi.hoisted(() => ({
  uploadDocument: vi.fn(),
  saveConversation: vi.fn(),
  extractRules: vi.fn(),
  listRecentDocuments: vi.fn(async () => ({ rows: [], hasMore: false })),
}))
vi.mock('../../src/brain/documents-api', async (o) => ({
  ...(await o<Record<string, unknown>>()), createDocumentsApi: () => documentsApi,
}))
const rolesApi = vi.hoisted(() => ({ listRoles: vi.fn(), listRuleRoles: vi.fn(), setRuleRoles: vi.fn() }))

vi.mock('../../src/brain/rules-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRulesApi: () => rulesApi,
}))
vi.mock('../../src/brain/roles-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRolesApi: () => rolesApi,
}))

const { IngestClient } = await import('../../app/[brandId]/tools/brain/ingest/ingest-client')

describe('saving a correction from the queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rulesApi.listPendingRules.mockResolvedValue({ rows: [makeRule({ text: 'לחייך' })], nextCursor: null })
    rulesApi.loadKpis.mockResolvedValue({ knowledgeItems: 0, qualityItems: 0, growthPercent: null })
    rulesApi.updateRule.mockResolvedValue(makeRule({ text: 'לחייך' }))
    rolesApi.listRoles.mockResolvedValue(ROLES)
    rolesApi.listRuleRoles.mockResolvedValue(new Map([['rule-1', ['role-2']]]))
    rolesApi.setRuleRoles.mockResolvedValue(['role-2'])
  })

  it('writes every axis the reviewer can see', async () => {
    render(<IngestClient tenantId="t-1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'עריכה: לחייך' }))
    await user.selectOptions(screen.getByLabelText('עשה / אל תעשה'), 'do')
    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(rulesApi.updateRule).toHaveBeenCalledWith(expect.objectContaining({
      ruleId: 'rule-1', polarity: 'do', subTopic: 'קבלת פנים', response: null,
    })))
  })

  it('writes the role assignment alongside the rule itself', async () => {
    render(<IngestClient tenantId="t-1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'עריכה: לחייך' }))
    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    // rule_roles is a separate table, so it takes a separate call. Both belong
    // to the one correction the reviewer just made.
    await waitFor(() => expect(rolesApi.setRuleRoles).toHaveBeenCalledWith({ ruleId: 'rule-1', roleIds: ['role-2'] }))
  })

  it('clears a sub-topic to nothing rather than to an empty string', async () => {
    render(<IngestClient tenantId="t-1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'עריכה: לחייך' }))
    await user.clear(screen.getByLabelText('תת־נושא'))
    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    // The column is nullable text. '' would be a sub-topic named the empty
    // string, which sorts and filters as a real value.
    await waitFor(() => expect(rulesApi.updateRule).toHaveBeenCalledWith(expect.objectContaining({ subTopic: null })))
  })
})
