import { auth } from '../../server/auth'

/** Every Better Auth endpoint under /api/auth/* (sign-in codes, sessions, sign-out). */
export function GET(request: Request): Promise<Response> {
  return auth.handler(request)
}

export function POST(request: Request): Promise<Response> {
  return auth.handler(request)
}
