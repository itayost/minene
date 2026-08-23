/**
 * Kept apart from require-brand.ts so middleware can import it without pulling
 * next/navigation and the brand registry into the edge bundle.
 */
export const LOGIN_PATH = '/login'
export const LOGOUT_PATH = '/logout'
