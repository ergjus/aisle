import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { selectCore, useStore } from '../store'
import { LONG_LINK_CHARS, buildShareUrl } from '../share/codec'
import { loadExportOptions } from '../export/options'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * "Share link…" — a read-only link to the chart for family, a client, the
 * venue, or the caterer. The chart travels inside the link's fragment, so
 * nothing is uploaded anywhere; notes stay out unless the sender opts in.
 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const core = useStore(useShallow(selectCore))
  const logActivity = useStore((state) => state.logActivity)
  const [title, setTitle] = useState(() => loadExportOptions().eventTitle)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const linkRef = useRef<HTMLTextAreaElement>(null)

  const noteCount =
    core.guestOrder.filter((id) => core.guests[id].notes?.trim()).length +
    core.constraints.filter((c) => c.note?.trim()).length

  useEffect(() => {
    let live = true
    setCopied(false)
    buildShareUrl(core, { includeNotes, title }).then(
      (url) => {
        if (!live) return
        setLink(url)
        setFailed(false)
      },
      () => {
        if (!live) return
        setLink(null)
        setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [core, includeNotes, title])

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // No clipboard permission: select the text so ⌘C finishes the job.
      linkRef.current?.focus()
      linkRef.current?.select()
      return
    }
    setCopied(true)
    logActivity('share', `Copied a view-only share link${includeNotes ? ' (notes included)' : ''}.`, 'you')
  }

  const long = link !== null && link.length > LONG_LINK_CHARS

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-none gap-0 rounded-lg p-0 sm:max-w-none">
        <DialogHeader className="border-b border-hairline px-6 py-4">
          <DialogTitle className="text-[20px]">Share a view-only link</DialogTitle>
          <DialogDescription>
            For family, a client, the venue, or the caterer. They see the floor plan and every seat, can look up their
            own, and can print — but can’t change your chart.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="share-title">Title on the shared chart</Label>
            <Input
              id="share-title"
              value={title}
              placeholder="e.g. June & Ravi"
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <label className="-mx-2 flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent">
            <Checkbox
              className="mt-0.5"
              checked={includeNotes}
              onCheckedChange={(checked) => setIncludeNotes(checked === true)}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">Include private notes</span>
              <span className="block text-xs text-muted-foreground">
                {noteCount > 0
                  ? `${noteCount} guest or rule note${noteCount === 1 ? '' : 's'} — things like “recently divorced” are left out unless you tick this.`
                  : 'No guest or rule notes on this chart.'}
              </span>
            </span>
          </label>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="share-link">Link</Label>
              <span className={cn('figures text-[11px]', long ? 'text-brick' : 'text-ink-soft')}>
                {link ? `${link.length.toLocaleString('en-US')} characters` : failed ? '' : 'Building…'}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <textarea
                id="share-link"
                ref={linkRef}
                readOnly
                rows={3}
                value={link ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="figures min-w-0 flex-1 resize-none rounded-md border border-hairline bg-parchment/50 px-2.5 py-2 text-[11.5px] leading-snug break-all text-ink outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <Button size="sm" className="h-8 px-3" onClick={copy} disabled={!link}>
                {copied ? (
                  <Check data-icon="inline-start" className="size-3.5" aria-hidden="true" />
                ) : (
                  <Copy data-icon="inline-start" className="size-3.5" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {failed && (
              <p className="text-[12px] text-brick" role="alert">
                This browser couldn’t build the link. Try Print instead, or another browser.
              </p>
            )}
            {long && (
              <p className="rounded-md border border-brick/30 bg-brick/5 px-2.5 py-1.5 text-[12px] leading-snug text-brick" role="status">
                This link is very long. Some messengers and email apps cut links off past about{' '}
                {LONG_LINK_CHARS.toLocaleString('en-US')} characters — send it somewhere that keeps long links whole, or
                share the printed document instead.
              </p>
            )}
          </div>

          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            Nothing is uploaded: the whole chart is packed into the link itself, after the #. It’s a snapshot — after
            more edits, send a fresh link.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
