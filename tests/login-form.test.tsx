import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('../src/auth/supabase-browser', () => ({
  createBrowserSupabase: () => ({ auth: { signInWithPassword: vi.fn() } }),
}))

const { LoginForm } = await import('../app/login/login-form')

describe('the login form', () => {
  it('posts rather than gets, so a credential cannot reach the URL', () => {
    render(<LoginForm next={null} />)

    // Submission is handled in JS, but before hydration -- a slow bundle, a
    // chunk that fails to load -- the browser submits natively. A form with no
    // method defaults to GET, which puts the named password field in the query
    // string and from there into history, server logs and referrer headers.
    // This shipped without a method and leaked a real password that way.
    const form = screen.getByRole('button', { name: 'כניסה' }).closest('form')
    expect(form).toHaveAttribute('method', 'post')
  })
})
