import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useStore } from '../store'
import type { Guest, Table, VenueDimensions, VenueFeature, VenueFeatureId } from '../types'
import {
  CHIP_R,
  WALL_MARGIN,
  chipPositions,
  containDelta,
  dist,
  featureBounds,
  featureMinSize,
  feetSize,
  formatFeet,
  ft,
  layoutConflicts,
  outOfRoomItems,
  roomRect,
  seatPos,
  snapStageValue,
  stageSize,
  stageUnitsPerFoot,
  tableBounds,
  tableDropRadius,
  tableSize,
} from '../geometry'
import { agentChipDelay } from '../agentCursor'
import { AgentCursor } from './AgentCursor'
import { AgentQuestion } from './AgentQuestion'
import { Celebration } from './Celebration'
import { ChairGlyph, FeatureArt, TableArt } from './FloorArt'
import { computeViolations } from '../constraints'
import { groupColors, hashId, initials } from '../utils'
import { SAMPLE } from '../sample'
import { seatEveryone } from '../actions'
import { Button } from '@/components/ui/button'

interface DragState {
  kind: 'chip' | 'table' | 'feature' | 'resize-feature' | 'rotate-feature' | 'rotate-table' | 'resize-venue'
  id: string
  x: number
  y: number
  startClient: { x: number; y: number }
  startStage: { x: number; y: number }
  moved: boolean
  snapshotTaken: boolean
  target: string | null // tableId or 'tray' for guest chips
  layoutOrigins?: LayoutOrigin[]
  startAngle?: number
  startRotation?: number
  /** Which wall(s) a resize-venue drag pulls on. */
  axis?: 'x' | 'y' | 'both'
}

/** The camera over the endless canvas: screen-pixel pan offset plus zoom. */
interface ViewState {
  x: number
  y: number
  scale: number
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const MIN_SCALE = 0.05
const MAX_SCALE = 3
/** Auto-fit never zooms a tiny room into a comically huge one. */
const FIT_MAX_SCALE = 1.6
/** Panning always keeps at least this many screen pixels of room visible. */
const PAN_MARGIN = 80

type LayoutKind = 'table' | 'feature'
interface LayoutItem { kind: LayoutKind; id: string }
interface LayoutOrigin extends LayoutItem { x: number; y: number }

const layoutKey = (kind: LayoutKind, id: string) => `${kind}:${id}`

const FEATURE_SHORT_LABELS: Record<VenueFeatureId, string> = {
  entrance: 'Entrance',
  band: 'Band',
  dance_floor: 'Dance',
  bathroom: 'Restroom',
  photo_booth: 'Photos',
  bar: 'Bar',
  buffet: 'Buffet',
  cake_table: 'Cake',
  gift_table: 'Gifts',
}

function Chip(props: {
  guest: Guest
  /** 'stage': positioned via x/y inside the zoomable room. 'flow': a plain flex item in the lounge — no coordinates, no zoom. */
  layout: 'stage' | 'flow'
  x?: number
  y?: number
  /** Stage position to fly in from on mount — set when a chip leaves the lounge for a seat, so it glides instead of teleporting. */
  spawnFrom?: { x: number; y: number }
  color: string
  dragging: boolean
  selected: boolean
  violated: boolean
  /** Spotlit because the user is hovering a rule involving this guest. */
  highlighted?: boolean
  /** The human pinned this seat — the solver and the agent leave it alone. */
  pinned?: boolean
  /** When the human last dropped this chip onto a seat — plays a small settle. */
  landedAt?: number
  touchedAt: number | undefined
  staggerMs: number
  whereLabel: string
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  const { guest, x, y, layout, color, dragging, selected, violated, highlighted, pinned, landedAt, touchedAt, staggerMs, whereLabel } = props
  // A fresh touchedAt remounts the keyed overlays, replaying their one-shot
  // CSS animations. No JS timers: fill-mode ends them, so nothing can stick.
  const flashing = touchedAt !== undefined && Date.now() - touchedAt < 4000
  const justLanded = landedAt !== undefined && Date.now() - landedAt < 1200

  // A chip promoted from the lounge mounts fresh on the stage, so its transform
  // transition has no "from". Render one flushed layout at spawnFrom, then move
  // to the real seat — the transition (and any escort delay) carries it in.
  const [spawnPos, setSpawnPos] = useState(layout === 'stage' ? props.spawnFrom ?? null : null)
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!spawnPos || !rootRef.current) return
    rootRef.current.getBoundingClientRect()
    setSpawnPos(null)
  }, [spawnPos])

  // The lounge's chip row scrolls, and a CSS-positioned nametag popping up
  // above a chip near the top of that scroll area gets clipped by it. Flow
  // chips instead portal their nametag to the body, placed from a measured
  // rect, so it always floats free above everything.
  const isFlow = layout === 'flow'
  const [flowHovered, setFlowHovered] = useState(false)
  const [tagPos, setTagPos] = useState<{ left: number; top: number } | null>(null)
  const showFlowTag = isFlow && (flowHovered || selected || highlighted)

  useEffect(() => {
    if (!showFlowTag || !rootRef.current) {
      setTagPos(null)
      return
    }
    const r = rootRef.current.getBoundingClientRect()
    setTagPos({ left: r.left + r.width / 2, top: r.top })
  }, [showFlowTag])

  const cls = [
    'chip',
    isFlow && 'flow',
    dragging && 'dragging',
    selected && 'selected',
    highlighted && 'rule-glow',
    pinned && 'pinned',
    guest.rsvp === 'pending' && 'rsvp-pending',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      className={cls}
      style={{
        transform: layout === 'stage' ? `translate(${spawnPos?.x ?? x}px, ${spawnPos?.y ?? y}px)` : undefined,
        ['--group' as string]: color,
        transitionDelay: dragging ? '0ms' : `${staggerMs}ms`,
      }}
      role="button"
      data-tour-guest={guest.id}
      tabIndex={0}
      aria-label={`${guest.name} — ${whereLabel}${pinned ? ' — pinned' : ''}${violated ? ' — part of a broken rule' : ''}. Press Enter to edit${!isFlow ? ', P to pin' : ''}.`}
      onKeyDown={props.onKeyDown}
      onPointerDown={props.onPointerDown}
      onPointerEnter={isFlow ? () => setFlowHovered(true) : undefined}
      onPointerLeave={isFlow ? () => setFlowHovered(false) : undefined}
    >
      {initials(guest.name)}
      {flashing && <span key={touchedAt} className="pulse-ring" style={{ animationDelay: `${staggerMs}ms` }} />}
      {justLanded && <span key={`l${landedAt}`} className="chip-settle" />}
      {pinned && <span className="pin" title="Pinned — stays put through Seat Everyone, repairs, and agent moves" />}
      {violated && <span className="viol-dot" title="Part of a violated rule" />}
      {!isFlow && <span className="nametag">{guest.name}</span>}
      {!isFlow && flashing && (
        <span key={`t${touchedAt}`} className="nametag flash" style={{ animationDelay: `${staggerMs}ms` }}>
          {guest.name}
        </span>
      )}
      {isFlow &&
        tagPos &&
        createPortal(
          <span className="nametag-portal" style={{ left: tagPos.left, top: tagPos.top }}>
            {guest.name}
          </span>,
          document.body,
        )}
    </div>
  )
}

/** The lounge footer's height is a screen-pixel size, not a stage one — it
 *  never scales or shifts with zoom. These bound how far it can be resized. */
const LOUNGE_DEFAULT_H = 148
const LOUNGE_MIN_H = 96
const LOUNGE_MAX_H = 420
/** Height while collapsed — just the header bar. */
const LOUNGE_COLLAPSED_H = 34

function readPersistedNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function readPersistedBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

export function Canvas() {
  const s = useStore()
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const loungeRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [layoutSelection, setLayoutSelection] = useState<LayoutItem[]>([])
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  /** null = auto-fit: the camera follows the room until the user pans/zooms. */
  const [viewState, setViewState] = useState<ViewState | null>(null)
  const [panning, setPanning] = useState(false)
  const panDrag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const [loungeHeight, setLoungeHeightState] = useState(() => readPersistedNumber('aisle:lounge:height', LOUNGE_DEFAULT_H))
  const [loungeCollapsed, setLoungeCollapsedState] = useState(() => readPersistedBool('aisle:lounge:collapsed', false))
  const [loungeResizing, setLoungeResizing] = useState(false)
  /** The chip the human most recently dropped onto a seat, for its settle animation. */
  const [landed, setLanded] = useState<{ id: string; at: number } | null>(null)
  /** True while the lounge is folded away only because nobody is waiting in it. */
  const autoCollapsed = useRef(false)
  /** -1 so the very first pass counts as a change and folds an empty lounge away. */
  const prevUnseatedCount = useRef(-1)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const setLoungeHeight = (v: number) => {
    const clamped = Math.max(LOUNGE_MIN_H, Math.min(LOUNGE_MAX_H, v))
    setLoungeHeightState(clamped)
    try {
      localStorage.setItem('aisle:lounge:height', String(clamped))
    } catch {
      // Preference simply won't stick.
    }
  }

  // Collapsing by hand is a preference and sticks; collapsing because the
  // lounge ran empty is bookkeeping, and gives way the moment it refills.
  const setLoungeCollapsed = (v: boolean) => {
    autoCollapsed.current = false
    setLoungeCollapsedState(v)
    try {
      localStorage.setItem('aisle:lounge:collapsed', v ? '1' : '0')
    } catch {
      // Preference simply won't stick.
    }
  }

  // The footer's actual on-screen height right now — collapsed pins it to
  // just the header bar, regardless of the resized height underneath.
  const loungeH = loungeCollapsed ? LOUNGE_COLLAPSED_H : loungeHeight

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLayoutSelection([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The room stage only ever frames into the space above the lounge footer —
  // the footer itself is a fixed-height sibling, never part of the zoomed
  // transform, so it can't be pushed around or resized by zooming.
  const roomAvailH = Math.max(0, box.h - loungeH)
  const room = roomRect(s.venueDimensions)
  const stageDims = stageSize(s.venueDimensions)

  const computeFitView = (): ViewState => {
    const pad = 48
    const raw = Math.min((box.w - pad * 2) / room.w, (roomAvailH - pad * 2) / room.h)
    const fit = Math.max(MIN_SCALE, Math.min(FIT_MAX_SCALE, Number.isFinite(raw) && raw > 0 ? raw : 1))
    return {
      x: (box.w - room.w * fit) / 2 - room.x * fit,
      y: (roomAvailH - room.h * fit) / 2 - room.y * fit,
      scale: fit,
    }
  }

  // While un-touched the camera keeps auto-fitting (window resizes, room
  // resizes, lounge drags all re-frame); the first pan or zoom pins it.
  const view = viewState ?? computeFitView()
  const scale = view.scale
  const ox = view.x
  const oy = view.y

  const clampView = (v: ViewState): ViewState => {
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale))
    const clampAxis = (value: number, lo: number, hi: number) =>
      Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), value))
    return {
      scale: clampedScale,
      x: clampAxis(v.x, PAN_MARGIN - (room.x + room.w) * clampedScale, box.w - PAN_MARGIN - room.x * clampedScale),
      y: clampAxis(v.y, PAN_MARGIN - (room.y + room.h) * clampedScale, roomAvailH - PAN_MARGIN - room.y * clampedScale),
    }
  }

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor))
    const k = nextScale / view.scale
    const px = clientX - rect.left
    const py = clientY - rect.top
    setViewState(clampView({ scale: nextScale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }))
  }

  const panBy = (dx: number, dy: number) => {
    setViewState(clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }))
  }

  const zoomStep = (factor: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + box.w / 2, rect.top + roomAvailH / 2, factor)
  }

  // Wheel must be a native non-passive listener: React registers wheel
  // passively, and pinch-zoom (ctrl+wheel) has to preventDefault or the
  // browser zooms the whole page instead of the floor plan.
  const cameraRef = useRef({ zoomAt, panBy })
  cameraRef.current = { zoomAt, panBy }
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : 1
      if (e.ctrlKey || e.metaKey) {
        cameraRef.current.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * 0.0022))
      } else {
        cameraRef.current.panBy(-e.deltaX * unit, -e.deltaY * unit)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const colors = useMemo(() => groupColors(s), [s.guests, s.guestOrder])
  const violations = useMemo(() => computeViolations(s), [s.guests, s.tables, s.seating, s.constraints, s.tableOrder, s.guestOrder, s.venue])

  const violatedGuests = useMemo(() => {
    const set = new Set<string>()
    for (const v of violations) {
      if (v.kind === 'together' || v.kind === 'apart') {
        set.add(v.a)
        set.add(v.b)
      } else if (v.kind === 'zone') {
        set.add(v.guestId)
      }
    }
    return set
  }, [violations])

  const violationsByTable = useMemo(() => {
    const map: Record<string, number> = {}
    const bump = (tid?: string) => {
      if (tid) map[tid] = (map[tid] ?? 0) + 1
    }
    for (const v of violations) {
      if (v.kind === 'overfull') bump(v.tableId)
      else if (v.kind === 'zone') bump(s.seating[v.guestId]?.tableId)
      else {
        bump(s.seating[v.a]?.tableId)
        if (s.seating[v.b]?.tableId !== s.seating[v.a]?.tableId) bump(s.seating[v.b]?.tableId)
      }
    }
    return map
  }, [violations, s.seating])

  const attending = useMemo(
    () => s.guestOrder.filter((id) => s.guests[id].rsvp !== 'no'),
    [s.guestOrder, s.guests],
  )

  // Seated guests live on the zoomable stage; unseated ones live in the fixed
  // lounge footer below it, which zoom never touches.
  const seatedAttending = useMemo(() => attending.filter((id) => s.seating[id]), [attending, s.seating])
  const unseatedAttending = useMemo(() => attending.filter((id) => !s.seating[id]), [attending, s.seating])

  const positions = useMemo(
    () => chipPositions(s),
    [s.guests, s.guestOrder, s.seating, s.tables, s.venueDimensions],
  )

  // Last committed chip world: lets a chip that just left the lounge fly in
  // from where it stood (the tray anchor, just below the room's bottom edge)
  // instead of materializing at its seat.
  const prevChips = useRef<{ positions: Record<string, { x: number; y: number }>; seating: typeof s.seating } | null>(null)
  useEffect(() => {
    prevChips.current = { positions, seating: s.seating }
  })

  const unseatedCount = unseatedAttending.length

  // An empty lounge is a strip of wasted floor, so it folds itself away once
  // the last guest is seated and unfolds the moment someone comes back to it.
  // Only the automatic collapse is undone this way — a hand-collapsed lounge
  // stays collapsed.
  useEffect(() => {
    const before = prevUnseatedCount.current
    prevUnseatedCount.current = unseatedCount
    if (before === unseatedCount) return
    if (unseatedCount === 0) {
      if (loungeCollapsed) return
      autoCollapsed.current = true
      setLoungeCollapsedState(true)
    } else if (before === 0 && autoCollapsed.current) {
      autoCollapsed.current = false
      setLoungeCollapsedState(false)
    }
  }, [unseatedCount, loungeCollapsed])
  const unitsPerFoot = stageUnitsPerFoot(s.venueDimensions)

  // Furniture the pointer is currently moving: the piece under the cursor, the
  // rest of its multi-selection, and — while a wall is being dragged —
  // everything the room is nudging. These follow the pointer exactly; anything
  // else glides, so an agent's placement reads as a move rather than a jump.
  const live = useMemo(() => {
    const ids = new Set<string>()
    if (!drag) return ids
    if (drag.kind === 'resize-venue') {
      for (const id of s.tableOrder) ids.add(layoutKey('table', id))
      for (const feature of Object.values(s.venue)) ids.add(layoutKey('feature', feature.id))
      return ids
    }
    if (drag.kind === 'rotate-table') ids.add(layoutKey('table', drag.id))
    if (drag.kind === 'rotate-feature' || drag.kind === 'resize-feature') ids.add(layoutKey('feature', drag.id))
    for (const item of drag.layoutOrigins ?? []) ids.add(layoutKey(item.kind, item.id))
    return ids
  }, [drag, s.tableOrder, s.venue])

  // One warning list per piece of furniture: what it sits on top of, and
  // whether it has been pushed past a wall. Both read from the shared
  // geometry, so the badges say exactly what the agent's tools report.
  const warnings = useMemo(() => {
    const map = new Map<string, string[]>()
    const add = (key: string, text: string) => map.set(key, [...(map.get(key) ?? []), text])
    for (const c of layoutConflicts(s)) {
      add(layoutKey(c.aKind, c.aId), `overlaps ${c.bLabel}`)
      add(layoutKey(c.bKind, c.bId), `overlaps ${c.aLabel}`)
    }
    for (const item of outOfRoomItems(s)) {
      add(layoutKey(item.kind, item.id), `reaches ${formatFeet(item.overhangFt)} past the wall`)
    }
    return map
  }, [s.tableOrder, s.tables, s.venue, s.venueDimensions])

  const toStage = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale }
  }

  // The lounge is a fixed screen rectangle now (not part of the zoomed
  // stage), so it's hit-tested in real screen pixels, not stage units.
  const overLounge = (clientX: number, clientY: number): boolean => {
    const rect = loungeRef.current?.getBoundingClientRect()
    if (!rect) return false
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  const dropTargetAt = (p: { x: number; y: number }, client: { x: number; y: number }): string | null => {
    if (overLounge(client.x, client.y)) return 'tray'
    for (const tid of s.tableOrder) {
      const t = s.tables[tid]
      if (dist(p, t) <= tableDropRadius(t, s.venueDimensions) + 12) return tid
    }
    return null
  }

  // Dragging the lounge's own top edge — a self-contained gesture with its
  // own window listeners, independent of the chip/table drag state machine.
  const onLoungeResizeStart = (e: React.PointerEvent) => {
    if (loungeCollapsed) return
    e.preventDefault()
    setLoungeResizing(true)
    const startY = e.clientY
    const startH = loungeHeight
    const onMove = (ev: PointerEvent) => setLoungeHeight(startH - (ev.clientY - startY))
    const onUp = () => {
      setLoungeResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const beginDrag = (
    e: React.PointerEvent,
    kind: DragState['kind'],
    id: string,
    stagePos: { x: number; y: number },
    axis?: DragState['axis'],
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    // Resizing the room while the camera auto-fits would re-frame every frame
    // and pull the wall away from the pointer — pin the camera where it is.
    if (kind === 'resize-venue' && viewState === null) setViewState(view)
    let layoutOrigins: LayoutOrigin[] | undefined
    if (kind === 'table' || kind === 'feature') {
      const item = { kind, id } as LayoutItem
      const selected = layoutSelection.some((entry) => layoutKey(entry.kind, entry.id) === layoutKey(kind, id))
      const moving = selected ? layoutSelection : [item]
      if (!e.shiftKey && !selected) setLayoutSelection([item])
      layoutOrigins = moving.map((entry) => {
        const target = entry.kind === 'table' ? s.tables[entry.id] : s.venue[entry.id as VenueFeatureId]
        return { ...entry, x: target.x, y: target.y }
      })
    }
    setDrag({
      kind,
      id,
      x: stagePos.x,
      y: stagePos.y,
      startClient: { x: e.clientX, y: e.clientY },
      startStage: stagePos,
      moved: false,
      snapshotTaken: false,
      target: null,
      layoutOrigins,
      axis,
    })
  }

  const beginRotate = (e: React.PointerEvent, kind: 'rotate-feature' | 'rotate-table', id: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    const table = kind === 'rotate-table' ? s.tables[id] : undefined
    const feature = kind === 'rotate-feature' ? s.venue[id as VenueFeatureId] : undefined
    const target = table ?? feature
    if (!target) return
    const center = table
      ? { x: table.x, y: table.y }
      : { x: feature!.x + feature!.w / 2, y: feature!.y + feature!.h / 2 }
    const pointer = toStage(e.clientX, e.clientY)
    setDrag({
      kind,
      id,
      x: center.x,
      y: center.y,
      startClient: { x: e.clientX, y: e.clientY },
      startStage: center,
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
      startRotation: target.rotation ?? 0,
      moved: false,
      snapshotTaken: false,
      target: null,
    })
  }

  const moveLayout = (d: DragState, rawX: number, rawY: number, bypassSnap: boolean) => {
    const origins = d.layoutOrigins ?? []
    const primary = origins.find((item) => item.kind === d.kind && item.id === d.id)
    if (!primary) return
    let targetX = bypassSnap ? rawX : snapStageValue(rawX, 'x', s.venueDimensions)
    let targetY = bypassSnap ? rawY : snapStageValue(rawY, 'y', s.venueDimensions)
    const primaryFeature = d.kind === 'feature' ? s.venue[d.id as VenueFeatureId] : null
    let centerX = d.kind === 'table' ? targetX : targetX + (primaryFeature?.w ?? 0) / 2
    let centerY = d.kind === 'table' ? targetY : targetY + (primaryFeature?.h ?? 0) / 2
    const movingKeys = new Set(origins.map((item) => layoutKey(item.kind, item.id)))
    const otherCenters: { x: number; y: number }[] = []
    for (const id of s.tableOrder) {
      if (!movingKeys.has(layoutKey('table', id))) otherCenters.push({ x: s.tables[id].x, y: s.tables[id].y })
    }
    for (const feature of Object.values(s.venue)) {
      if (feature.enabled && !movingKeys.has(layoutKey('feature', feature.id))) {
        otherCenters.push({ x: feature.x + feature.w / 2, y: feature.y + feature.h / 2 })
      }
    }
    const nextGuides: { x?: number; y?: number } = {}
    if (!bypassSnap) {
      const alignX = otherCenters.find((point) => Math.abs(point.x - centerX) <= 8)
      const alignY = otherCenters.find((point) => Math.abs(point.y - centerY) <= 8)
      if (alignX) {
        targetX += alignX.x - centerX
        centerX = alignX.x
        nextGuides.x = alignX.x
      }
      if (alignY) {
        targetY += alignY.y - centerY
        centerY = alignY.y
        nextGuides.y = alignY.y
      }
    }
    let deltaX = targetX - primary.x
    let deltaY = targetY - primary.y
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const item of origins) {
      const bounds = item.kind === 'table'
        ? tableBounds({ ...s.tables[item.id], x: item.x, y: item.y }, s.venueDimensions)
        : featureBounds({ ...s.venue[item.id as VenueFeatureId], x: item.x, y: item.y })
      left = Math.min(left, bounds.left)
      top = Math.min(top, bounds.top)
      right = Math.max(right, bounds.right)
      bottom = Math.max(bottom, bounds.bottom)
    }
    // Clamp the whole moving group at once, so a multi-select slides along a
    // wall together instead of the leader tearing free of the rest.
    const contained = containDelta({ left: left + deltaX, top: top + deltaY, right: right + deltaX, bottom: bottom + deltaY }, room)
    deltaX += contained.dx
    deltaY += contained.dy
    if (!d.snapshotTaken) s.snapshot(origins.length > 1 ? 'move selection' : d.kind === 'table' ? 'move table' : 'move venue feature')
    for (const item of origins) {
      if (item.kind === 'table') s.moveTable(item.id, item.x + deltaX, item.y + deltaY)
      else s.updateVenueFeature(item.id as VenueFeatureId, { x: item.x + deltaX, y: item.y + deltaY }, { snapshot: false })
    }
    setGuides(nextGuides)
    setDrag({ ...d, x: primary.x + deltaX, y: primary.y + deltaY, moved: true, snapshotTaken: true })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = panDrag.current
    if (p) {
      const pdx = e.clientX - p.startX
      const pdy = e.clientY - p.startY
      if (!p.moved && Math.hypot(pdx, pdy) > 3) p.moved = true
      if (p.moved) setViewState(clampView({ scale: view.scale, x: p.originX + pdx, y: p.originY + pdy }))
      return
    }
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startClient.x
    const dy = e.clientY - d.startClient.y
    const moved = d.moved || Math.hypot(dx, dy) > 5
    if (!moved) return
    const x = d.startStage.x + dx / scale
    const y = d.startStage.y + dy / scale
    if (d.kind === 'rotate-feature' || d.kind === 'rotate-table') {
      const pointer = toStage(e.clientX, e.clientY)
      const angle = Math.atan2(pointer.y - d.startStage.y, pointer.x - d.startStage.x)
      const degrees = (angle - (d.startAngle ?? angle)) * 180 / Math.PI
      const rawRotation = (d.startRotation ?? 0) + degrees
      const increment = e.altKey ? 1 : e.shiftKey ? 5 : 15
      const rotation = ((Math.round(rawRotation / increment) * increment) % 360 + 360) % 360
      if (!d.snapshotTaken) s.snapshot(d.kind === 'rotate-table' ? 'rotate table' : 'rotate venue feature')
      if (d.kind === 'rotate-table') s.updateTable(d.id, { rotation }, { snapshot: false })
      else s.updateVenueFeature(d.id as VenueFeatureId, { rotation }, { snapshot: false })
      setDrag({ ...d, moved: true, snapshotTaken: true })
    } else if (d.kind === 'table' || d.kind === 'feature') {
      moveLayout(d, x, y, e.altKey)
    } else if (d.kind === 'resize-feature') {
      const feature = s.venue[d.id as VenueFeatureId]
      if (!feature) return
      if (!d.snapshotTaken) s.snapshot('resize venue feature')
      const min = featureMinSize(feature.id, s.venueDimensions)
      const rotation = -((feature.rotation ?? 0) * Math.PI) / 180
      const stageDx = dx / scale
      const stageDy = dy / scale
      const localDx = stageDx * Math.cos(rotation) - stageDy * Math.sin(rotation)
      const localDy = stageDx * Math.sin(rotation) + stageDy * Math.cos(rotation)
      const rawW = d.startStage.x + localDx
      const rawH = d.startStage.y + localDy
      const stepX = unitsPerFoot.x * s.venueDimensions.snapFt
      const stepY = unitsPerFoot.y * s.venueDimensions.snapFt
      const snappedW = e.altKey || stepX <= 0 ? rawW : Math.round(rawW / stepX) * stepX
      const snappedH = e.altKey || stepY <= 0 ? rawH : Math.round(rawH / stepY) * stepY
      const w = Math.max(min.w, Math.min(room.x + room.w - feature.x - WALL_MARGIN, snappedW))
      const h = Math.max(min.h, Math.min(room.y + room.h - feature.y - WALL_MARGIN, snappedH))
      s.updateVenueFeature(feature.id, { w, h }, { snapshot: false })
      setDrag({ ...d, x: w, y: h, moved: true, snapshotTaken: true })
    } else if (d.kind === 'resize-venue') {
      const pointer = toStage(e.clientX, e.clientY)
      if (!d.snapshotTaken) s.snapshot('resize room')
      const step = e.altKey ? 0.5 : 1
      const patch: Partial<VenueDimensions> = {}
      if (d.axis !== 'y') patch.widthFt = Math.round((pointer.x - room.x) / unitsPerFoot.x / step) * step
      if (d.axis !== 'x') patch.lengthFt = Math.round((pointer.y - room.y) / unitsPerFoot.y / step) * step
      s.updateVenueDimensions(patch, { snapshot: false })
      setDrag({ ...d, moved: true, snapshotTaken: true })
    } else {
      setDrag({ ...d, x, y, moved: true, target: dropTargetAt({ x, y }, { x: e.clientX, y: e.clientY }) })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (panDrag.current) {
      // A background press that never moved is a click: clear the selection,
      // exactly as clicking the empty floor always did.
      if (!panDrag.current.moved && e.button === 0) setLayoutSelection([])
      panDrag.current = null
      setPanning(false)
      return
    }
    const d = dragRef.current
    if (!d) return
    setDrag(null)
    setGuides({})
    if (!d.moved) {
      if (d.kind === 'rotate-feature' || d.kind === 'rotate-table') {
        s.snapshot(d.kind === 'rotate-table' ? 'rotate table' : 'rotate venue feature')
        if (d.kind === 'rotate-table') {
          const table = s.tables[d.id]
          if (table) s.updateTable(d.id, { rotation: ((table.rotation ?? 0) + 15) % 360 }, { snapshot: false })
        } else {
          const feature = s.venue[d.id as VenueFeatureId]
          if (feature) s.updateVenueFeature(feature.id, { rotation: ((feature.rotation ?? 0) + 15) % 360 }, { snapshot: false })
        }
      } else if (d.kind === 'table' || d.kind === 'feature') {
        const item = { kind: d.kind, id: d.id } as LayoutItem
        if (e.shiftKey) {
          setLayoutSelection((current) => {
            const exists = current.some((entry) => layoutKey(entry.kind, entry.id) === layoutKey(item.kind, item.id))
            return exists
              ? current.filter((entry) => layoutKey(entry.kind, entry.id) !== layoutKey(item.kind, item.id))
              : [...current, item]
          })
        } else {
          setLayoutSelection([item])
          if (d.kind === 'table') s.setSelection({ kind: 'table', id: d.id, at: { x: e.clientX + 14, y: e.clientY - 8 } })
        }
      } else if (d.kind === 'chip') {
        s.setSelection({ kind: 'guest', id: d.id, at: { x: e.clientX + 14, y: e.clientY - 8 } })
      }
      return
    }
    if (d.kind === 'chip') {
      const target = dropTargetAt({ x: d.x, y: d.y }, { x: e.clientX, y: e.clientY })
      const name = s.guests[d.id]?.name
      if (target === 'tray') {
        if (s.seating[d.id]) {
          s.unseatGuest(d.id)
          s.logActivity('drag', `Sent ${name} back to the lounge.`, 'you')
        }
      } else if (target) {
        const from = s.seating[d.id]?.tableId
        const res = s.seatGuest(d.id, target)
        if (!res.ok && res.error) s.setToast(res.error)
        else {
          setLanded({ id: d.id, at: Date.now() })
          if (from !== target) s.logActivity('drag', `Seated ${name} at ${s.tables[target]?.name}.`, 'you')
        }
      }
      // No target: the chip glides home on its own.
    } else if (d.kind === 'rotate-feature' || d.kind === 'rotate-table') {
      const label = d.kind === 'rotate-table' ? s.tables[d.id]?.name : s.venue[d.id as VenueFeatureId]?.label
      const rotation = d.kind === 'rotate-table' ? s.tables[d.id]?.rotation : s.venue[d.id as VenueFeatureId]?.rotation
      s.logActivity('rotate', `Rotated ${label} to ${Math.round(rotation ?? 0)}°.`, 'you')
    } else if ((d.kind === 'table' || d.kind === 'feature') && d.moved) {
      const count = d.layoutOrigins?.length ?? 1
      const label = d.kind === 'table' ? s.tables[d.id]?.name : s.venue[d.id as VenueFeatureId]?.label
      s.logActivity(d.kind === 'table' ? 'drag' : 'venue', count > 1 ? `Moved ${count} selected layout items.` : `Moved ${label}.`, 'you')
    } else if (d.kind === 'resize-feature' && d.moved) {
      const feature = s.venue[d.id as VenueFeatureId]
      s.logActivity('venue', `Resized ${feature?.label} to ${Math.round(feature?.w ?? 0)} × ${Math.round(feature?.h ?? 0)}.`, 'you')
    } else if (d.kind === 'resize-venue' && d.moved) {
      s.logActivity('venue', `Resized the room to ${formatFeet(s.venueDimensions.widthFt)} × ${formatFeet(s.venueDimensions.lengthFt)}.`, 'you')
    }
  }

  const nudgeVenueSize = (e: React.KeyboardEvent, axis: 'x' | 'y' | 'both') => {
    const step = e.shiftKey ? 5 : 1
    let dw = 0
    let dl = 0
    if (e.key === 'ArrowLeft') dw = -step
    else if (e.key === 'ArrowRight') dw = step
    else if (e.key === 'ArrowUp') dl = -step
    else if (e.key === 'ArrowDown') dl = step
    else return
    e.preventDefault()
    const patch: Partial<VenueDimensions> = {}
    if (axis !== 'y' && dw !== 0) patch.widthFt = s.venueDimensions.widthFt + dw
    if (axis !== 'x' && dl !== 0) patch.lengthFt = s.venueDimensions.lengthFt + dl
    if (Object.keys(patch).length === 0) return
    s.updateVenueDimensions(patch)
    s.logActivity('venue', `Resized the room to ${formatFeet(patch.widthFt ?? s.venueDimensions.widthFt)} × ${formatFeet(patch.lengthFt ?? s.venueDimensions.lengthFt)}.`, 'you')
  }

  const empty = s.guestOrder.length === 0 && s.tableOrder.length === 0

  const onBackgroundTarget = (target: EventTarget) => target === wrapRef.current || target === stageRef.current

  return (
    <div
      className={`canvas-wrap${panning ? ' panning' : ''}`}
      ref={wrapRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => drag?.kind === 'chip' && setDrag(null)}
      onPointerDown={(e) => {
        if (dragRef.current) return
        // Left-drag on the empty floor pans; middle-drag pans from anywhere.
        if (e.button === 1 || (e.button === 0 && onBackgroundTarget(e.target))) {
          e.preventDefault()
          ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
          panDrag.current = { startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y, moved: false }
          setPanning(true)
        }
      }}
      onDoubleClick={(e) => {
        if (onBackgroundTarget(e.target)) setViewState(null)
      }}
    >
      {s.proposal && (
        <div className="proposal-banner" role="status" aria-live="polite">
          <span className="proposal-banner-text">
            <span aria-hidden="true">❦</span> The agent proposes {s.proposal.summary} — {s.proposal.moved} move
            {s.proposal.moved === 1 ? '' : 's'}
          </span>
          <button type="button" className="proposal-keep" onClick={() => s.resolveProposal('keep')}>
            Keep
          </button>
          <button type="button" className="proposal-revert" onClick={() => s.resolveProposal('revert')}>
            Revert
          </button>
        </div>
      )}
      {s.question && (
        <AgentQuestion
          question={s.question}
          belowBanner={Boolean(s.proposal)}
          onAnswer={(answer) => s.answerQuestion(s.question!.id, answer)}
        />
      )}
      <Celebration active={s.finalized} />
      <div className="canvas-zoom-controls" role="group" aria-label="Floor plan zoom">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={scale <= MIN_SCALE * 1.001}
          onClick={() => zoomStep(1 / 1.25)}
        >
          −
        </button>
        <button
          type="button"
          className="zoom-readout"
          title="Zoom to fit the room"
          aria-label={`Zoom to fit. Current zoom ${Math.round(scale * 100)} percent`}
          onClick={() => setViewState(null)}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={scale >= MAX_SCALE * 0.999}
          onClick={() => zoomStep(1.25)}
        >
          +
        </button>
      </div>
      <div
        className="stage"
        ref={stageRef}
        style={{ width: stageDims.w, height: stageDims.h, transform: `translate(${ox}px, ${oy}px) scale(${scale})` }}
      >
        <div
          className={`room-frame${drag?.kind === 'resize-venue' ? ' resizing' : ''}`}
          style={{
            left: room.x,
            top: room.y,
            width: room.w,
            height: room.h,
            ['--grid-x' as string]: `${unitsPerFoot.x * 5}px`,
            ['--grid-y' as string]: `${unitsPerFoot.y * 5}px`,
          }}
        />
        {/* Dimension strings along the top and left walls, lettered the way an
            architect's sheet is — ticks at each end, the measure in the middle. */}
        <svg className="room-dims" width={stageDims.w} height={stageDims.h} aria-hidden="true">
          <line x1={room.x} y1={room.y - 22} x2={room.x + room.w} y2={room.y - 22} />
          <line x1={room.x} y1={room.y - 28} x2={room.x} y2={room.y - 16} />
          <line x1={room.x + room.w} y1={room.y - 28} x2={room.x + room.w} y2={room.y - 16} />
          <text x={room.x + room.w / 2} y={room.y - 27} textAnchor="middle">
            {formatFeet(s.venueDimensions.widthFt)}
          </text>
          <line x1={room.x - 22} y1={room.y} x2={room.x - 22} y2={room.y + room.h} />
          <line x1={room.x - 28} y1={room.y} x2={room.x - 16} y2={room.y} />
          <line x1={room.x - 28} y1={room.y + room.h} x2={room.x - 16} y2={room.y + room.h} />
          <text transform={`translate(${room.x - 27} ${room.y + room.h / 2}) rotate(-90)`} textAnchor="middle">
            {formatFeet(s.venueDimensions.lengthFt)}
          </text>
        </svg>
        {/* The title block, bottom-right of the sheet. */}
        <div className="title-block" style={{ left: room.x + room.w, top: room.y + room.h + 30 }}>
          <span className="title-block-name">
            Aisle <em>floor plan</em>
          </span>
          <span className="title-block-cell">
            <b>Room</b>
            {formatFeet(s.venueDimensions.widthFt)} × {formatFeet(s.venueDimensions.lengthFt)}
          </span>
          <span className="title-block-cell">
            <b>Drawn by</b>
            {s.agentConnected ? 'You & the agent' : 'You'}
          </span>
          <span className="title-block-cell">
            <b>Rev.</b>
            {s.undoStack.length}
          </span>
        </div>
        <button
          type="button"
          className="room-resize-handle edge-e"
          style={{ left: room.x + room.w, top: room.y + room.h / 2, ['--handle-scale' as string]: 1 / scale }}
          aria-label={`Resize the room's width. Drag, or use left and right arrows; currently ${formatFeet(s.venueDimensions.widthFt)} wide.`}
          onPointerDown={(e) => beginDrag(e, 'resize-venue', 'venue', { x: 0, y: 0 }, 'x')}
          onKeyDown={(e) => nudgeVenueSize(e, 'x')}
        >
          <span aria-hidden="true">↔</span>
        </button>
        <button
          type="button"
          className="room-resize-handle edge-s"
          style={{ left: room.x + room.w / 2, top: room.y + room.h, ['--handle-scale' as string]: 1 / scale }}
          aria-label={`Resize the room's length. Drag, or use up and down arrows; currently ${formatFeet(s.venueDimensions.lengthFt)} long.`}
          onPointerDown={(e) => beginDrag(e, 'resize-venue', 'venue', { x: 0, y: 0 }, 'y')}
          onKeyDown={(e) => nudgeVenueSize(e, 'y')}
        >
          <span aria-hidden="true">↕</span>
        </button>
        <button
          type="button"
          className="room-resize-handle corner"
          style={{ left: room.x + room.w, top: room.y + room.h, ['--handle-scale' as string]: 1 / scale }}
          aria-label={`Resize the room. Drag the corner, or use arrow keys; currently ${formatFeet(s.venueDimensions.widthFt)} by ${formatFeet(s.venueDimensions.lengthFt)}. Hold Shift for 5 foot steps.`}
          onPointerDown={(e) => beginDrag(e, 'resize-venue', 'venue', { x: 0, y: 0 }, 'both')}
          onKeyDown={(e) => nudgeVenueSize(e, 'both')}
        >
          <span aria-hidden="true">↘</span>
        </button>
        {drag?.kind === 'resize-venue' && (
          <span className="room-size-readout" style={{ left: room.x + room.w - 14, top: room.y + room.h - 14, ['--handle-scale' as string]: 1 / scale }}>
            {formatFeet(s.venueDimensions.widthFt)} × {formatFeet(s.venueDimensions.lengthFt)}
          </span>
        )}
        <div className="scale-bar" style={{ left: room.x + 18, top: room.y + room.h + 6, width: unitsPerFoot.x * 10 }}>
          <span>10′</span>
        </div>
        {guides.x !== undefined && <span className="alignment-guide vertical" style={{ left: guides.x, top: room.y, height: room.h }} />}
        {guides.y !== undefined && <span className="alignment-guide horizontal" style={{ left: room.x, top: guides.y, width: room.w }} />}
        {layoutSelection.length > 1 && (
          <div className="selection-status" style={{ left: room.x + room.w / 2, top: room.y + 36 }}>
            {layoutSelection.length} selected · drag together · Esc clears
          </div>
        )}

        {Object.values(s.venue).map((feature) =>
          feature.enabled ? (
            <VenueFeatureView
              key={feature.id}
              feature={feature}
              dimensions={s.venueDimensions}
              selected={layoutSelection.some((entry) => layoutKey(entry.kind, entry.id) === layoutKey('feature', feature.id))}
              highlighted={s.ruleHighlight?.zone === feature.id}
              live={live.has(layoutKey('feature', feature.id))}
              warnings={warnings.get(layoutKey('feature', feature.id)) ?? []}
              active={
                (drag?.kind === 'feature' || drag?.kind === 'resize-feature' || drag?.kind === 'rotate-feature') && drag.id === feature.id
                  ? drag.kind
                  : null
              }
              onPointerDown={(e) => beginDrag(e, 'feature', feature.id, { x: feature.x, y: feature.y })}
              onResizePointerDown={(e) => beginDrag(e, 'resize-feature', feature.id, { x: feature.w, y: feature.h })}
              onRotatePointerDown={(e) => beginRotate(e, 'rotate-feature', feature.id)}
              onKeyDown={(e) => {
                if (e.key.toLowerCase() === 'r') {
                  e.preventDefault()
                  s.updateVenueFeature(feature.id, { rotation: ((feature.rotation ?? 0) + 15) % 360 })
                  return
                }
                const xDelta = unitsPerFoot.x * (e.shiftKey ? 0.5 : s.venueDimensions.snapFt || 1)
                const yDelta = unitsPerFoot.y * (e.shiftKey ? 0.5 : s.venueDimensions.snapFt || 1)
                let dx = 0
                let dy = 0
                if (e.key === 'ArrowLeft') dx = -xDelta
                else if (e.key === 'ArrowRight') dx = xDelta
                else if (e.key === 'ArrowUp') dy = -yDelta
                else if (e.key === 'ArrowDown') dy = yDelta
                else return
                e.preventDefault()
                s.updateVenueFeature(feature.id, {
                  x: Math.max(room.x + WALL_MARGIN, Math.min(room.x + room.w - feature.w - WALL_MARGIN, feature.x + dx)),
                  y: Math.max(room.y + WALL_MARGIN, Math.min(room.y + room.h - feature.h - WALL_MARGIN, feature.y + dy)),
                })
              }}
              onResizeKeyDown={(e) => {
                const xDelta = unitsPerFoot.x * (e.shiftKey ? 0.5 : s.venueDimensions.snapFt || 1)
                const yDelta = unitsPerFoot.y * (e.shiftKey ? 0.5 : s.venueDimensions.snapFt || 1)
                const min = featureMinSize(feature.id, s.venueDimensions)
                let dw = 0
                let dh = 0
                if (e.key === 'ArrowLeft') dw = -xDelta
                else if (e.key === 'ArrowRight') dw = xDelta
                else if (e.key === 'ArrowUp') dh = -yDelta
                else if (e.key === 'ArrowDown') dh = yDelta
                else return
                e.preventDefault()
                s.updateVenueFeature(feature.id, {
                  w: Math.max(min.w, Math.min(room.x + room.w - feature.x - WALL_MARGIN, feature.w + dw)),
                  h: Math.max(min.h, Math.min(room.y + room.h - feature.y - WALL_MARGIN, feature.h + dh)),
                })
              }}
              onRotate={() => s.updateVenueFeature(feature.id, { rotation: ((feature.rotation ?? 0) + 15) % 360 })}
            />
          ) : null,
        )}

        {/* violation lines under chips */}
        <svg className="viol-lines" width={stageDims.w} height={stageDims.h}>
          {violations.map((v, i) => {
            if (v.kind !== 'together' && v.kind !== 'apart') return null
            const pa = s.seating[v.a] && positions[v.a]
            const pb = s.seating[v.b] && positions[v.b]
            if (!pa || !pb) return null
            const mx = (pa.x + pb.x) / 2
            const my = (pa.y + pb.y) / 2 - 26
            return <path key={i} d={`M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`} />
          })}
        </svg>

        {s.tableOrder.map((tid) => {
          const t = s.tables[tid]
          const size = tableSize(t, s.venueDimensions)
          const occSeats = new Set(
            Object.values(s.seating)
              .filter((a) => a.tableId === tid)
              .map((a) => a.seat),
          )
          const badge = violationsByTable[tid]
          const touchedAt = s.touched[tid]
          const isTarget = drag?.kind === 'chip' && drag.target === tid
          return (
            <TableView
              key={tid}
              table={t}
              size={size}
              occupied={occSeats.size}
              badge={badge}
              touchedAt={touchedAt}
              selected={s.selection?.kind === 'table' && s.selection.id === tid}
              layoutSelected={layoutSelection.some((entry) => layoutKey(entry.kind, entry.id) === layoutKey('table', tid))}
              warnings={warnings.get(layoutKey('table', tid)) ?? []}
              dropTarget={isTarget}
              live={live.has(layoutKey('table', tid))}
              rotating={drag?.kind === 'rotate-table' && drag.id === tid}
              onPointerDown={(e) => beginDrag(e, 'table', tid, { x: t.x, y: t.y })}
              onRotatePointerDown={(e) => beginRotate(e, 'rotate-table', tid)}
              onRotate={() => s.updateTable(tid, { rotation: ((t.rotation ?? 0) + 15) % 360 })}
              onKeyDown={(e) => {
                if (e.key.toLowerCase() === 'r') {
                  e.preventDefault()
                  s.updateTable(tid, { rotation: ((t.rotation ?? 0) + 15) % 360 })
                  return
                }
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                s.setSelection({ kind: 'table', id: tid, at: { x: r.right + 10, y: r.top - 8 } })
              }}
            />
          )
        })}

        {/* chairs — one per seat, turned to face the table; occupied ones sit
            beneath their guest's chip with the backrest peeking out behind. */}
        {s.tableOrder.flatMap((tid) => {
          const t = s.tables[tid]
          // Positioned by transform, like the table itself, so a chair
          // travels with its table instead of snapping ahead of it.
          const glide = live.has(layoutKey('table', tid)) ? '' : ' glide'
          // While a chip hovers over this table, the chair it would take pulls
          // out a little to say "sit here" — the same seat seatGuest will pick.
          let inviting = -1
          if (drag?.kind === 'chip' && drag.target === tid) {
            const taken = new Set(
              Object.entries(s.seating)
                .filter(([gid, a]) => a.tableId === tid && gid !== drag.id)
                .map(([, a]) => a.seat),
            )
            for (let i = 0; i < t.seats; i++) {
              if (!taken.has(i)) {
                inviting = i
                break
              }
            }
          }
          return Array.from({ length: t.seats }, (_, i) => {
            const p = seatPos(t, i, s.venueDimensions)
            const facing = (Math.atan2(t.y - p.y, t.x - p.x) * 180) / Math.PI
            return (
              <span
                key={`${tid}-${i}`}
                className={`seat-chair${glide}${i === inviting ? ' inviting' : ''}`}
                style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${facing}deg)` }}
              >
                <ChairGlyph />
              </span>
            )
          })
        })}

        {seatedAttending.map((id) => {
          // The actively-dragged chip renders once, in the drag-ghost layer
          // below — so it can cross over the lounge footer without being
          // painted under it.
          if (drag?.kind === 'chip' && drag.id === id) return null
          const g = s.guests[id]
          const p = positions[id]
          if (!p) return null
          const touchedAt = s.touched[id]
          const recentTouch = touchedAt && Date.now() - touchedAt < 1500
          // The agent cursor may be flying over to pick this chip up — hold the
          // chip's departure until the cursor gets there.
          const escortDelay = agentChipDelay(id)
          const prev = prevChips.current
          const spawnFrom = prev && !prev.seating[id] ? prev.positions[id] : undefined
          return (
            <Chip
              key={id}
              guest={g}
              layout="stage"
              x={p.x}
              y={p.y}
              spawnFrom={spawnFrom}
              color={colors[g.group]}
              dragging={false}
              selected={s.selection?.kind === 'guest' && s.selection.id === id}
              violated={violatedGuests.has(id)}
              highlighted={s.ruleHighlight?.guestIds.includes(id)}
              pinned={Boolean(s.pinned[id])}
              landedAt={landed?.id === id ? landed.at : undefined}
              touchedAt={touchedAt}
              staggerMs={escortDelay ?? (recentTouch ? (hashId(id) % 12) * 30 : 0)}
              whereLabel={`at ${s.tables[s.seating[id].tableId]?.name}`}
              onPointerDown={(e) => beginDrag(e, 'chip', id, positions[id])}
              onKeyDown={(e) => {
                if (e.key.toLowerCase() === 'p' && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault()
                  const next = !s.pinned[id]
                  s.pinGuest(id, next)
                  s.logActivity('pin', next ? `Pinned ${g.name} at ${s.tables[s.seating[id].tableId]?.name}.` : `Unpinned ${g.name}.`, 'you')
                  return
                }
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                s.setSelection({ kind: 'guest', id, at: { x: r.right + 10, y: r.top - 8 } })
              }}
            />
          )
        })}

        <AgentCursor />

        {s.finalized && <div className="ribbon">❦ &nbsp;Finalized — every guest seated, zero drama&nbsp; ❦</div>}

        {violations.length > 0 && !s.finalized && (
          <button
            data-tour="violation-banner"
            className="viol-banner"
            onClick={() => seatEveryone('repair')}
            title="Runs the solver in repair mode — fixes every broken rule while moving as few guests as possible"
          >
            ⚠ {violations.length} rule{violations.length === 1 ? '' : 's'} broken · Fix With Minimal Moves
          </button>
        )}

        {empty && (
          <div className="empty-room">
            <h3>The room is empty</h3>
            <p>
              Add guests and tables by hand, or load the sample wedding — 72 guests, 10 tables, and a healthy amount of
              family politics.
            </p>
            <div className="flex justify-center gap-2">
              <Button
                onClick={() => {
                  s.loadSample(SAMPLE)
                  s.logActivity('load sample', 'Loaded the sample wedding: 72 guests, 10 tables, 17 rules.', 'you')
                }}
              >
                Load Sample Wedding
              </Button>
              <Button
                variant="outline"
                className="border-linen-dim/60 bg-transparent text-linen hover:bg-pine-800 hover:text-linen"
                onClick={() => {
                  const t = s.addTable()
                  s.logActivity('add table', `Added ${t.name}.`, 'you')
                }}
              >
                Add a Table
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* The lounge — a fixed footer, sized and positioned in real screen
          pixels, entirely outside the zoomed stage above. Zooming the room
          never moves, grows, or shrinks it. Its own height is user-resizable
          (drag the top edge) and collapsible (the chevron), independent of
          zoom entirely. */}
      <div
        data-tour="lounge"
        ref={loungeRef}
        className={[
          'lounge',
          drag?.kind === 'chip' && drag.target === 'tray' && 'drop-target',
          loungeCollapsed && 'collapsed',
          loungeResizing && 'resizing',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ height: loungeH }}
      >
        <div
          className={`lounge-resize-handle${loungeCollapsed ? ' disabled' : ''}`}
          onPointerDown={onLoungeResizeStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the lounge"
          aria-disabled={loungeCollapsed}
        />
        <div className="lounge-header">
          <button
            type="button"
            className="lounge-collapse-btn"
            aria-expanded={!loungeCollapsed}
            aria-label={loungeCollapsed ? 'Expand the lounge' : 'Collapse the lounge'}
            onClick={() => setLoungeCollapsed(!loungeCollapsed)}
          >
            <ChevronDown className={`lounge-chevron${loungeCollapsed ? ' collapsed' : ''}`} aria-hidden="true" />
            <span className="lounge-label">Lounge</span>
          </button>
          <span className="lounge-meta">
            {drag?.kind === 'chip'
              ? 'Drop to unseat'
              : attending.length === 0
                ? 'No guests yet'
                : unseatedCount === 0
                  ? 'Everyone’s seated'
                  : `${unseatedCount} unseated`}
          </span>
        </div>
        {!loungeCollapsed && (
          <div className="lounge-chips">
            {unseatedAttending
              .filter((id) => !(drag?.kind === 'chip' && drag.id === id))
              .map((id) => {
                const g = s.guests[id]
                const touchedAt = s.touched[id]
                const recentTouch = touchedAt && Date.now() - touchedAt < 1500
                const escortDelay = agentChipDelay(id)
                return (
                  <Chip
                    key={id}
                    guest={g}
                    layout="flow"
                    color={colors[g.group]}
                    dragging={false}
                    selected={s.selection?.kind === 'guest' && s.selection.id === id}
                    violated={violatedGuests.has(id)}
                    highlighted={s.ruleHighlight?.guestIds.includes(id)}
                    touchedAt={touchedAt}
                    staggerMs={escortDelay ?? (recentTouch ? (hashId(id) % 12) * 30 : 0)}
                    whereLabel="in the lounge"
                    onPointerDown={(e) => beginDrag(e, 'chip', id, toStage(e.clientX, e.clientY))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      s.setSelection({ kind: 'guest', id, at: { x: r.right + 10, y: r.top - 8 } })
                    }}
                  />
                )
              })}
            {unseatedAttending.length === 0 && <span className="lounge-empty">Everyone's seated.</span>}
          </div>
        )}
      </div>

      {/* The one actively-dragged chip, drawn in its own layer on top of both
          the stage and the lounge, using the stage's own transform — so it
          glides smoothly across the boundary between the two in either
          direction without disappearing under the lounge's background. */}
      {drag?.kind === 'chip' && s.guests[drag.id] && (
        <div className="drag-ghost-layer" style={{ transform: `translate(${ox}px, ${oy}px) scale(${scale})` }}>
          <Chip
            guest={s.guests[drag.id]}
            layout="stage"
            x={drag.x}
            y={drag.y}
            color={colors[s.guests[drag.id].group]}
            dragging
            selected={s.selection?.kind === 'guest' && s.selection.id === drag.id}
            violated={violatedGuests.has(drag.id)}
            touchedAt={undefined}
            staggerMs={0}
            whereLabel={s.seating[drag.id] ? `at ${s.tables[s.seating[drag.id].tableId]?.name}` : 'in the lounge'}
            onPointerDown={() => {}}
            onKeyDown={() => {}}
          />
        </div>
      )}
    </div>
  )
}

function VenueFeatureView(props: {
  feature: VenueFeature
  dimensions: VenueDimensions
  selected: boolean
  /** Spotlit because the user is hovering a zone rule about this feature. */
  highlighted?: boolean
  /** Layout problems to badge, e.g. "overlaps Table 3", "reaches 2′ past the wall". */
  warnings: string[]
  /** The pointer is moving this amenity right now, so it must not lag behind it. */
  live: boolean
  active: 'feature' | 'resize-feature' | 'rotate-feature' | null
  onPointerDown: (e: React.PointerEvent) => void
  onResizePointerDown: (e: React.PointerEvent) => void
  onRotatePointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onResizeKeyDown: (e: React.KeyboardEvent) => void
  onRotate: () => void
}) {
  const { feature, active } = props
  const measured = feetSize(feature.w, feature.h, props.dimensions)
  // Label density follows the amenity's real size, in feet, like everything else.
  const micro = feature.w < ft(4.5) || feature.h < ft(2.5)
  const compact = micro || feature.w < ft(8.5) || feature.h < ft(4)
  const horizontal = !micro && feature.w >= ft(7) && feature.h < ft(4)
  const densityClass = `${compact ? ' compact' : ''}${micro ? ' micro' : ''}${horizontal ? ' horizontal-content' : ''}`
  return (
    <div
      className={`venue-feature venue-feature-${feature.id}${densityClass}${props.selected ? ' selected' : ''}${props.highlighted ? ' rule-glow' : ''}${props.warnings.length ? ' overlapping' : ''}${props.live ? ' live' : ''}${active ? ` ${active === 'feature' ? 'dragging' : active === 'rotate-feature' ? 'rotating' : 'resizing'}` : ''}`}
      style={{ left: feature.x, top: feature.y, width: feature.w, height: feature.h, transform: `rotate(${feature.rotation ?? 0}deg)` }}
      role="group"
      aria-label={`${feature.label}, ${formatFeet(measured.w)} by ${formatFeet(measured.h)}${props.warnings.length ? `, ${props.warnings.join(', ')}` : ''}`}
    >
      <FeatureArt feature={feature} />
      <button
        type="button"
        className="feature-move-surface"
        aria-label={`Move ${feature.label}. Drag or use arrow keys; hold Shift for fine movement.`}
        onPointerDown={props.onPointerDown}
        onKeyDown={props.onKeyDown}
      >
        <span className="zone-label">{compact ? FEATURE_SHORT_LABELS[feature.id] : feature.label}</span>
        <span className="move-hint" aria-hidden="true">drag to move</span>
      </button>
      <button
        type="button"
        className="resize-handle"
        aria-label={`Resize ${feature.label}. Drag, or use left and right arrows for width and up and down arrows for height.`}
        onPointerDown={props.onResizePointerDown}
        onKeyDown={props.onResizeKeyDown}
      >
        <span aria-hidden="true">↘</span>
      </button>
      <button
        type="button"
        className="rotate-handle"
        aria-label={`Rotate ${feature.label}. Drag to rotate in 15 degree steps; hold Alt for free rotation. Current rotation ${Math.round(feature.rotation ?? 0)} degrees.`}
        onPointerDown={props.onRotatePointerDown}
        onClick={(e) => {
          e.stopPropagation()
          if (e.detail === 0) props.onRotate()
        }}
      >
        <span aria-hidden="true">↻</span>
      </button>
      <span className="size-readout" aria-hidden="true">
        {formatFeet(measured.w)} × {formatFeet(measured.h)} · {Math.round(feature.rotation ?? 0)}°
      </span>
      {props.warnings.length > 0 && <span className="collision-badge" title={cap(props.warnings.join(' · '))}>!</span>}
    </div>
  )
}

function TableView(props: {
  table: Table
  size: { w: number; h: number }
  occupied: number
  badge?: number
  touchedAt?: number
  selected: boolean
  layoutSelected: boolean
  /** Layout problems to badge, e.g. "overlaps Table 3", "reaches 2′ past the wall". */
  warnings: string[]
  dropTarget: boolean
  /** The pointer is moving this table right now, so it must not lag behind it. */
  live: boolean
  rotating: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onRotatePointerDown: (e: React.PointerEvent) => void
  onRotate: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  const { table, size, occupied, badge, touchedAt, selected, layoutSelected, dropTarget, live, rotating } = props
  const flashing = touchedAt !== undefined && Date.now() - touchedAt < 4000

  const cls = ['table', table.shape, (selected || layoutSelected) && 'selected', props.warnings.length && 'overlapping', dropTarget && 'drop-target']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={`table-wrap${selected || layoutSelected ? ' selected' : ''}${rotating ? ' rotating' : ''}${live || rotating ? '' : ' glide'}`}
      style={{
        transform: `translate(${table.x}px, ${table.y}px) translate(-50%, -50%) rotate(${table.rotation ?? 0}deg)`,
        width: size.w,
        height: size.h,
      }}
    >
      <div
        className={cls}
        style={{
          width: size.w,
          height: size.h,
        ...(dropTarget
          ? { boxShadow: 'inset 0 0 0 1px rgba(41,36,25,.22), 0 0 0 3px var(--color-gold-bright), 0 6px 18px rgba(10,16,12,.45)' }
          : {}),
        }}
        role="button"
        tabIndex={0}
        aria-label={`${table.name} — ${occupied} of ${table.seats} seats filled${badge ? `, ${badge} broken rule${badge === 1 ? '' : 's'}` : ''}${props.warnings.length ? `, ${props.warnings.join(', ')}` : ''}. Press Enter to edit; press R to rotate.`}
        onKeyDown={props.onKeyDown}
        onPointerDown={props.onPointerDown}
      >
        <TableArt table={table} size={size} />
        <span className="t-name">{table.name}</span>
        <span className="t-count">
          {occupied} / {table.seats}
        </span>
        {flashing && <span key={touchedAt} className="table-pulse" />}
        {badge ? <span className="t-badge">{badge}</span> : null}
        {props.warnings.length > 0 && <span className="collision-badge" title={cap(props.warnings.join(' · '))}>!</span>}
      </div>
      <button
        type="button"
        className="table-rotate-handle"
        aria-label={`Rotate ${table.name}. Drag to rotate in 15 degree steps; hold Alt for free rotation. Current rotation ${Math.round(table.rotation ?? 0)} degrees.`}
        onPointerDown={props.onRotatePointerDown}
        onClick={(event) => {
          event.stopPropagation()
          if (event.detail === 0) props.onRotate()
        }}
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>
  )
}
