import { auth, type Session } from './auth'

/** The signed-in user's session for this request, or null. */
export async function getSession(request: Request): Promise<Session | null> {
  return auth.api.getSession({ headers: request.headers })
}

/**
 * For API functions that need an account: the session, or a 401 response to
 * return as-is.
 *
 *   const session = await requireSession(request)
 *   if (session instanceof Response) return session
 */
export async function requireSession(request: Request): Promise<Session | Response> {
  const session = await getSession(request)
  if (session) return session
  return new Response(JSON.stringify({ error: 'Sign in to use this.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
