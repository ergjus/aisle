import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

/**
 * Applies server/db/migrations to DATABASE_URL over Neon's HTTP API, so it
 * runs anywhere HTTPS does (laptops, CI, sandboxes) with no Postgres port.
 */
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
await migrate(drizzle({ client: neon(url) }), { migrationsFolder: 'server/db/migrations' })
console.log('Migrations applied.')
