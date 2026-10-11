import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Server-side settings handed to the API functions in dev, never to the client bundle. */
const SERVER_ENV = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'BETTER_AUTH_TRUSTED_ORIGINS',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
]

/**
 * Serves api/auth/[...all].ts under `npm run dev`, the way Vercel serves it in
 * production, so sign-in works locally with settings in .env.local.
 */
function authDev(): Plugin {
  return {
    name: 'aisle-auth-dev',
    configureServer(server) {
      server.middlewares.use('/api/auth', async (req, res) => {
        try {
          const mod = (await server.ssrLoadModule('/api/auth/[...all].ts')) as Record<string, (r: Request) => Promise<Response>>
          const handler = req.method ? mod[req.method] : undefined
          if (!handler) {
            res.statusCode = 405
            res.end()
            return
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.originalUrl ?? '/api/auth'}`, {
            method: req.method,
            headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          })
          const response = await handler(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => {
            if (key !== 'set-cookie') res.setHeader(key, value)
          })
          const cookies = response.headers.getSetCookie()
          if (cookies.length) res.setHeader('set-cookie', cookies)
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          server.config.logger.error(`[auth] ${err instanceof Error ? err.stack : String(err)}`)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'The local auth function crashed; see the dev server log.' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of SERVER_ENV) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }
  return {
    plugins: [react(), tailwindcss(), authDev()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
