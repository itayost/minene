import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RulesApiError } from '../../src/brain/rules-api'
import type { Role } from '../../src/brain/types'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/admin',
}))

const { RolesManager } = await import('../../src/brain/RolesManager')

const ROLES: Role[] = [
  { id: 'role-1', name: 'מנהלת חנות', sortOrder: 10 },
  { id: 'role-2', name: 'מוכרת', sortOrder: 20 },
]

/**
 * The catalogue is owned by the caller now, so the harness owns it too and
 * re-renders when the sheet reports a change -- which is the behaviour that
 * stops the sheet and the do/don't filter drifting apart.
 */
function Harness({ api }: { api: Record<string, unknown> }) {
  const [roles, setRoles] = useState<Role[]>([])
  return (
    <RolesManager
      isOpen
      onClose={vi.fn()}
      onRolesChanged={setRoles}
      roles={roles}
      rolesApi={api as never}
    />
  )
}

function roles(overrides: Partial<Record<string, unknown>> = {}) {
  const api = {
    listRoles: vi.fn(async () => ROLES),
    createRole: vi.fn(async () => ROLES[0] as Role),
    renameRole: vi.fn(async () => ROLES[0] as Role),
    deleteRole: vi.fn(async () => undefined),
    ...overrides,
  }
  render(<Harness api={api} />)
  return { api, user: userEvent.setup() }
}

describe('the org chart, editable', () => {
  it('is a sheet over the list rather than a bar inside it', async () => {
    roles()

    // It used to be a collapsed <details> between the KPI strip and the topic
    // ribbon, with nothing saying what it was -- which is how the owner of the
    // product came to ask what it did.
    expect(await screen.findByRole('dialog', { name: 'תפקידים' })).toBeVisible()
  })

  it('states the consequence of deleting before the button is pressed', async () => {
    roles()

    // Deleting a role is not destructive here: the rules it addressed revert to
    // addressing everyone. But "delete" reads as though it might be, and someone
    // who believes it deletes rules will simply never fix a wrong role.
    expect(await screen.findByText(/אינה מוחקת חוקים/)).toBeVisible()
  })

  it('names the role in the delete control, because the visible label repeats', async () => {
    roles()

    // findBy, not getBy: the sheet opens already open and loads its catalogue
    // asynchronously, where it used to load behind a summary somebody clicked.
    expect(await screen.findByRole('button', { name: 'מחיקת התפקיד מנהלת חנות' })).toBeVisible()
  })

  it('adds a role and reads the list back rather than guessing at it', async () => {
    const { api, user } = roles()
    await user.type(screen.getByLabelText('תפקיד חדש'), 'מחסנאי')
    await user.click(screen.getByRole('button', { name: 'הוספה' }))

    expect(api.createRole).toHaveBeenCalledWith({ name: 'מחסנאי' })
    // Twice: once on mount, once after the write. sort_order is assigned server
    // side, so the order is only knowable by reading it back.
    expect(api.listRoles).toHaveBeenCalledTimes(2)
  })

  it('keeps the duplicate message, which is the one a person can act on', async () => {
    const { user } = roles({
      createRole: vi.fn(async () => {
        throw new RulesApiError('DUPLICATE_ROLE', 409, 'כבר קיים תפקיד בשם הזה')
      }),
    })
    await user.type(screen.getByLabelText('תפקיד חדש'), 'מוכרת')
    await user.click(screen.getByRole('button', { name: 'הוספה' }))

    // Overwriting it with a generic sentence would throw away the only failure
    // here that names its own fix.
    expect(await screen.findByRole('alert')).toHaveTextContent('כבר קיים תפקיד בשם הזה')
  })

  it('says no role is defined yet rather than showing an empty list', async () => {
    roles({ listRoles: vi.fn(async () => []) })

    expect(await screen.findByText('עדיין לא הוגדרו תפקידים.')).toBeVisible()
  })
})
