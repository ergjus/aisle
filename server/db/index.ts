import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { requireEnv } from '../env'
import * as schema from './schema'

/**
 * Neon over HTTP: every query is one stateless fetch, so serverless instances
 * never hold a Postgres connection open and scaling out can't exhaust the
 * connection limit. Use the pooled connection string (host has `-pooler`).
 */
export const db = drizzle({ client: neon(requireEnv('DATABASE_URL')), schema })
