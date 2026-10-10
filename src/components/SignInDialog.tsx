import { useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requestSignInCode, signInWithCode } from '@/auth/client'

/**
 * Passwordless sign-in: an email, then the 6-digit code we send to it. The
 * first code an address confirms creates its account, so there's no separate
 * sign-up.
 */
export function SignInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault()
    const address = email.trim()
    if (!address) return
    setBusy(true)
    setError(null)
    const failure = await requestSignInCode(address)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    setCode('')
    setStep('code')
  }

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return
    setBusy(true)
    setError(null)
    const failure = await signInWithCode(email.trim(), code)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    onOpenChange(false)
    setStep('email')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] rounded-lg sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="font-heading text-[22px] font-medium">Sign in to Aisle</DialogTitle>
          <DialogDescription>
            {step === 'email'
              ? 'We’ll email you a 6-digit code. New here? The code creates your account.'
              : `We sent a code to ${email.trim()}. It expires in 10 minutes.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'email' ? (
          <form className="flex flex-col gap-3" onSubmit={sendCode}>
            <Input
              type="email"
              autoComplete="email"
              autoFocus
              required
              placeholder="you@example.com"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            {error && <p role="alert" className="text-[12.5px] text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </form>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={confirm}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="123456"
              aria-label="Sign-in code"
              className="figures text-center text-[18px] tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-invalid={error ? true : undefined}
            />
            {error && <p role="alert" className="text-[12.5px] text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <div className="flex justify-between text-[12.5px] text-ink-soft">
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => { setStep('email'); setError(null) }}>
                Use a different email
              </button>
              <button type="button" className="underline-offset-2 hover:underline" disabled={busy} onClick={() => sendCode()}>
                Send a new code
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
