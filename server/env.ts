/** A server-side setting that must be present; fails loudly on first use. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. See .env.example.`)
  return value
}
