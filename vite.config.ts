import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Serves api/agent.ts under `npm run dev`, the way Vercel serves it in
 * production, so the hosted agent works locally with a key in .env.local.
 */
function hostedAgentDev(): Plugin {
  return {
    name: 'aisle-hosted-agent-dev',
    configureServer(server) {
      server.middlewares.use('/api/agent', async (req, res) => {
        try {
          const mod = (await server.ssrLoadModule('/api/agent.ts')) as Record<string, (r: Request) => Promise<Response>>
          const handler = req.method ? mod[req.method] : undefined
          if (!handler) {
            res.statusCode = 405
            res.end()
            return
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const request = new Request(`http://localhost${req.originalUrl ?? '/api/agent'}`, {
            method: req.method,
            headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          })
          const response = await handler(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        } catch (err) {
          server.config.logger.error(`[agent] ${err instanceof Error ? err.stack : String(err)}`)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'The local agent function crashed; see the dev server log.' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Hand the agent's server-side settings to the function without exposing
  // them to the client bundle (only VITE_-prefixed vars reach the browser).
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of [
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'ANTHROPIC_BASE_URL',
    'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID',
    'ANTHROPIC_IDENTITY_TOKEN', 'ANTHROPIC_IDENTITY_TOKEN_FILE', 'VERCEL_OIDC_TOKEN',
    'AISLE_AGENT_MODEL', 'AISLE_AGENT_EFFORT',
  ]) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }
  return {
    plugins: [react(), tailwindcss(), hostedAgentDev()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
