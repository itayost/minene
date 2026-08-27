import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RulesApiError } from '../../src/brain/rules-api'
import type { Person, Role } from '../../src/brain/types'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/admin',
}))

const { RolesManager } = await import('../../src/brain/RolesManager')
const { PeopleManager } = await import('../../src/brain/PeopleManager')

const ROLES: Role[] = [
  { id: 'role-1', name: 'מנהלת חנות', sortOrder: 10 },
  { id: 'role-2', name: 'מוכרת', sortOrder: 20 },
]

const openPanel = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByText(name))
}

function roles(overrides: Partial<Record<string, unknown>> = {}) {
  const api = {
    listRoles: vi.fn(async () => ROLES),
    createRole: vi.fn(async () => ROLES[0] as Role),
    renameRole: vi.fn(async () => ROLES[0] as Role),
    deleteRole: vi.fn(async () => undefined),
    ...overrides,
  }
  render(<RolesManager rolesApi={api as never} />)
  return { api, user: userEvent.setup() }
}

describe('the org chart, editable', () => {
  it('stays collapsed on a page whose job is reviewing rules', async () => {
    roles()

    // Opened rarely, so it is a settings panel rather than a section. <details>
    // gives keyboard and screen-reader behaviour a button-plus-state would have
    // to reimplement. Asserted on the element rather than on what is queryable:
    // jsdom keeps a closed <details>'s children in the tree and visible to
    // testing-library, so a presence check here would prove nothing.
    const summary = await screen.findByText('ניהול תפקידים')
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })

  it('states the consequence of deleting before the button is pressed', async () => {
    const { user } = roles()
    await openPanel(user, 'ניהול תפקידים')

    // Deleting a role is not destructive here: the rules it addressed revert to
    // addressing everyone. But "delete" reads as though it might be, and someone
    // who believes it deletes rules will simply never fix a wrong role.
    expect(screen.getByText(/אינה מוחקת חוקים/)).toBeVisible()
  })

  it('names the role in the delete control, because the visible label repeats', async () => {
    const { user } = roles()
    await openPanel(user, 'ניהול תפקידים')

    expect(screen.getByRole('button', { name: 'מחיקת התפקיד מנהלת חנות' })).toBeVisible()
  })

  it('adds a role and reads the list back rather than guessing at it', async () => {
    const { api, user } = roles()
    await openPanel(user, 'ניהול תפקידים')
    await user.type(screen.getByLabelText('תפקיד חדש'), 'מחסנאי')
    await user.click(screen.getByRole('button', { name: 'הוספה' }))

    expect(api.createRole).toHaveBeenCalledWith({ name: 'מחסנאי' })
    // Twice: once on mount, once after the write. sort_order is assigned server
    // side, so the order is only knowable by reading it back.
    expect(api.listRoles).toHaveBeenCalledTimes(2)
  })

  it('keeps the duplicate message, which is the one a person can act on', async () => {
    const { user } = roles({
      createRole: vi.fn(async () => { throw new RulesApiError('DUPLICATE_ROLE', 409, 'כבר קיים תפקיד בשם הזה') }),
    })
    await openPanel(user, 'ניהול תפקידים')
    await user.type(screen.getByLabelText('תפקיד חדש'), 'מוכרת')
    await user.click(screen.getByRole('button', { name: 'הוספה' }))

    // Overwriting it with a generic sentence would throw away the only failure
    // here that names its own fix.
    expect(await screen.findByRole('alert')).toHaveTextContent('כבר קיים תפקיד בשם הזה')
  })

  it('says no role is defined yet rather than showing an empty list', async () => {
    const { user } = roles({ listRoles: vi.fn(async () => []) })
    await openPanel(user, 'ניהול תפקידים')

    expect(await screen.findByText('עדיין לא הוגדרו תפקידים.')).toBeVisible()
  })
})

const PEOPLE: Person[] = [
  { id: 'p1', displayName: 'מאי אורנשטיין', role: 'staff', jobRoleId: 'role-2' },
  { id: 'p2', displayName: null, role: 'owner', jobRoleId: null },
]

function people(overrides: Partial<Record<string, unknown>> = {}) {
  const api = {
    listPeople: vi.fn(async () => PEOPLE),
    updatePerson: vi.fn(async () => PEOPLE[0] as Person),
    ...overrides,
  }
  render(<PeopleManager peopleApi={api as never} rolesApi={{ listRoles: vi.fn(async () => ROLES) } as never} />)
  return { api, user: userEvent.setup() }
}

describe('who works here and what they do', () => {
  it('shows each person’s job, which is what makes a do list personal', async () => {
    const { user } = people()
    await openPanel(user, 'ניהול אנשים')

    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement
    expect(within(row).getByLabelText('תפקיד')).toHaveValue('role-2')
  })

  it('calls an unnamed person unnamed rather than showing their id', async () => {
    const { user } = people()
    await openPanel(user, 'ניהול אנשים')

    // The API leaves display_name null deliberately; the fallback belongs here,
    // and a uuid dressed up as a name is worse than an honest blank.
    expect(await screen.findByText('ללא שם')).toBeVisible()
  })

  it('marks the owner, because the two roles are not interchangeable', async () => {
    const { user } = people()
    await openPanel(user, 'ניהול אנשים')

    expect(await screen.findByText('בעלים')).toBeVisible()
  })

  it('saves a name and a job in one call', async () => {
    const { api, user } = people()
    await openPanel(user, 'ניהול אנשים')
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement
    await user.clear(within(row).getByLabelText('שם'))
    await user.type(within(row).getByLabelText('שם'), 'מאי')
    await user.selectOptions(within(row).getByLabelText('תפקיד'), 'role-1')
    await user.click(within(row).getByRole('button', { name: /שמירה/ }))

    expect(api.updatePerson).toHaveBeenCalledWith({ personId: 'p1', displayName: 'מאי', jobRoleId: 'role-1' })
  })

  it('offers "no job" as a real option rather than as the absence of one', async () => {
    const { user } = people()
    await openPanel(user, 'ניהול אנשים')

    const row = (await screen.findAllByRole('listitem'))[1] as HTMLElement
    expect(within(row).getByLabelText('תפקיד')).toHaveValue('')
    expect(within(row).getByRole('option', { name: 'ללא תפקיד' })).toBeInTheDocument()
  })
})
