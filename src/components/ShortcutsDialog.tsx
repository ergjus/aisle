import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Everywhere',
    rows: [
      ['⌘ Z', 'Undo — yours or the agent’s'],
      ['⇧ ⌘ Z', 'Redo'],
      ['⌘ B', 'Fold the sidebar away'],
      ['?', 'This sheet'],
      ['Esc', 'Close, clear the selection'],
    ],
  },
  {
    title: 'On the floor plan',
    rows: [
      ['Drag the floor', 'Pan the room'],
      ['⌘ + scroll', 'Zoom at the pointer'],
      ['Double-click the floor', 'Fit the room to the window'],
      ['Shift + click', 'Select several tables or amenities'],
      ['R', 'Rotate the focused table or amenity 15°'],
      ['Alt while dragging', 'Free movement — no grid, no snapping'],
      ['Arrow keys', 'Nudge the focused piece one foot'],
    ],
  },
  {
    title: 'Guests',
    rows: [
      ['Drag a chip', 'Seat, reseat, or send back to the lounge'],
      ['Enter', 'Edit the focused guest or table'],
      ['P', 'Pin a seated guest — the solver and the agent leave them be'],
      ['Hover a rule', 'Spotlight the guests it is about'],
    ],
  },
]

/** The keyboard sheet — every gesture the canvas answers to, in one place. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] rounded-lg p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-hairline px-6 pt-5 pb-4">
          <DialogTitle className="font-heading text-[22px] font-medium">Keyboard &amp; gestures</DialogTitle>
          <DialogDescription>Everything the room answers to without a menu.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 px-6 pt-4 pb-6 sm:grid-cols-[1fr_1fr]">
          {GROUPS.map((group) => (
            <section key={group.title} className={group.rows.length > 5 ? 'sm:row-span-2' : ''}>
              <h3 className="smallcaps mb-1.5 text-[13px] text-ink-soft">{group.title}</h3>
              <dl className="flex flex-col">
                {group.rows.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3 border-t border-hairline/60 py-1.5 first:border-t-0">
                    <dd className="text-[12.5px] text-ink">{what}</dd>
                    <dt className="figures shrink-0 rounded-[3px] border border-hairline bg-parchment/70 px-1.5 py-px text-[10.5px] text-ink-soft">
                      {keys}
                    </dt>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
