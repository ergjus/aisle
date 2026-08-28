import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Guest, Table } from '../types'
import {
  CHIP_R,
  STAGE_H,
  STAGE_W,
  TRAY,
  ZONES,
  dist,
  rectTableSize,
  seatPos,
  tableFootprint,
  tableRadius,
  trayPos,
} from '../geometry'
import { computeViolations } from '../constraints'
import { groupColors, hashId, initials } from '../utils'
import { SAMPLE } from '../sample'
import { seatEveryone } from '../actions'
import { Button } from '@/components/ui/button'

interface DragState {
  kind: 'chip' | 'table'
  id: string
  x: number
  y: number
  startClient: { x: number; y: number }
  startStage: { x: number; y: number }
  moved: boolean
  snapshotTaken: boolean
  target: string | null // tableId or 'tray'
}

function Chip(props: {
  guest: Guest
  x: number
  y: number
  color: string
  dragging: boolean
  selected: boolean
  violated: boolean
  touchedAt: number | undefined
  staggerMs: number
  whereLabel: string
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  const { guest, x, y, color, dragging, selected, violated, touchedAt, staggerMs, whereLabel } = props
  // A fresh touchedAt remounts the keyed overlays, replaying their one-shot
  // CSS animations. No JS timers: fill-mode ends them, so nothing can stick.
  const flashing = touchedAt !== undefined && Date.now() - touchedAt < 4000

  const cls = ['chip', dragging && 'dragging', selected && 'selected', guest.rsvp === 'pending' && 'rsvp-pending']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        ['--group' as string]: color,
        transitionDelay: dragging ? '0ms' : `${staggerMs}ms`,
      }}
      role="button"
      tabIndex={0}
      aria-label={`${guest.name} — ${whereLabel}${violated ? ' — part of a broken rule' : ''}. Press Enter to edit.`}
      onKeyDown={props.onKeyDown}
      onPointerDown={props.onPointerDown}
    >
      {initials(guest.name)}
      {flashing && <span key={touchedAt} className="pulse-ring" style={{ animationDelay: `${staggerMs}ms` }} />}
      {violated && <span className="viol-dot" title="Part of a violated rule" />}
      <span className="nametag">{guest.name}</span>
      {flashing && (
        <span key={`t${touchedAt}`} className="nametag flash" style={{ animationDelay: `${staggerMs}ms` }}>
          {guest.name}
        </span>
      )}
    </div>
  )
}

export function Canvas() {
  const s = useStore()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const scale = Math.min(box.w / STAGE_W, box.h / STAGE_H)
  const ox = (box.w - STAGE_W * scale) / 2
  const oy = (box.h - STAGE_H * scale) / 2

  const colors = useMemo(() => groupColors(s), [s.guests, s.guestOrder])
  const violations = useMemo(() => computeViolations(s), [s.guests, s.tables, s.seating, s.constraints, s.tableOrder, s.guestOrder])

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

  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {}
    let trayIndex = 0
    for (const id of attending) {
      const seat = s.seating[id]
      if (seat && s.tables[seat.tableId]) {
        pos[id] = seatPos(s.tables[seat.tableId], seat.seat)
      } else {
        pos[id] = trayPos(trayIndex++)
      }
    }
    return pos
  }, [attending, s.seating, s.tables])

  const unseatedCount = attending.filter((id) => !s.seating[id]).length

  const toStage = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale }
  }

  const dropTargetAt = (p: { x: number; y: number }): string | null => {
    for (const tid of s.tableOrder) {
      const t = s.tables[tid]
      if (dist(p, t) <= tableFootprint(t) + 12) return tid
    }
    if (p.x >= TRAY.x && p.x <= TRAY.x + TRAY.w && p.y >= TRAY.y && p.y <= TRAY.y + TRAY.h) return 'tray'
    return null
  }

  const beginDrag = (e: React.PointerEvent, kind: 'chip' | 'table', id: string, stagePos: { x: number; y: number }) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
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
    })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startClient.x
    const dy = e.clientY - d.startClient.y
    const moved = d.moved || Math.hypot(dx, dy) > 5
    if (!moved) return
    const x = d.startStage.x + dx / scale
    const y = d.startStage.y + dy / scale
    if (d.kind === 'table') {
      if (!d.snapshotTaken) s.snapshot('move table')
      const t = s.tables[d.id]
      const half = t ? tableFootprint(t) : 60
      const cx = Math.max(half, Math.min(STAGE_W - half, x))
      const cy = Math.max(half, Math.min(TRAY.y - 40, y))
      s.moveTable(d.id, cx, cy)
      setDrag({ ...d, x: cx, y: cy, moved: true, snapshotTaken: true })
    } else {
      setDrag({ ...d, x, y, moved: true, target: dropTargetAt({ x, y }) })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setDrag(null)
    if (!d.moved) {
      s.setSelection({ kind: d.kind === 'chip' ? 'guest' : 'table', id: d.id, at: { x: e.clientX + 14, y: e.clientY - 8 } })
      return
    }
    if (d.kind === 'chip') {
      const target = dropTargetAt({ x: d.x, y: d.y })
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
        else if (from !== target) s.logActivity('drag', `Seated ${name} at ${s.tables[target]?.name}.`, 'you')
      }
      // No target: the chip glides home on its own.
    } else if (d.moved) {
      s.logActivity('drag', `Moved ${s.tables[d.id]?.name}.`, 'you')
    }
  }

  const empty = s.guestOrder.length === 0 && s.tableOrder.length === 0

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => drag?.kind === 'chip' && setDrag(null)}
    >
      <div
        className="stage"
        style={{ width: STAGE_W, height: STAGE_H, transform: `translate(${ox}px, ${oy}px) scale(${scale})` }}
      >
        <div className="room-frame" />

        {Object.values(ZONES).map((z) => (
          <div
            key={z.id}
            className={`zone zone-${z.id}`}
            style={{ left: z.x, top: z.y, width: z.w, height: z.h }}
          >
            {z.id === 'band' && <span className="glyphs">♪ ♬ ♪</span>}
            <span className="zone-label">{z.label}</span>
          </div>
        ))}

        <div className={`tray${drag?.kind === 'chip' && drag.target === 'tray' ? ' drop-target' : ''}`} style={{ left: TRAY.x, top: TRAY.y, width: TRAY.w, height: TRAY.h }}>
          <span className="tray-label">
            {drag?.kind === 'chip'
              ? 'The lounge — drop here to unseat'
              : `The lounge — not yet seated${unseatedCount > 0 ? ` · ${unseatedCount}` : ''}`}
          </span>
        </div>

        {/* violation lines under chips */}
        <svg className="viol-lines" width={STAGE_W} height={STAGE_H}>
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
          const isRound = t.shape === 'round'
          const r = tableRadius(t)
          const size = isRound ? { w: r * 2, h: r * 2 } : rectTableSize(t)
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
              dropTarget={isTarget}
              dragging={drag?.kind === 'table' && drag.id === tid}
              onPointerDown={(e) => beginDrag(e, 'table', tid, { x: t.x, y: t.y })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                s.setSelection({ kind: 'table', id: tid, at: { x: r.right + 10, y: r.top - 8 } })
              }}
            />
          )
        })}

        {/* empty seat markers */}
        {s.tableOrder.flatMap((tid) => {
          const t = s.tables[tid]
          const occSeats = new Set(
            Object.values(s.seating)
              .filter((a) => a.tableId === tid)
              .map((a) => a.seat),
          )
          return Array.from({ length: t.seats }, (_, i) => {
            if (occSeats.has(i)) return null
            const p = seatPos(t, i)
            return <span key={`${tid}-${i}`} className="seat-dot" style={{ left: p.x, top: p.y }} />
          })
        })}

        {attending.map((id) => {
          const g = s.guests[id]
          const isDragging = drag?.kind === 'chip' && drag.id === id
          const p = isDragging ? { x: drag.x, y: drag.y } : positions[id]
          if (!p) return null
          const touchedAt = s.touched[id]
          const recentTouch = touchedAt && Date.now() - touchedAt < 1500
          return (
            <Chip
              key={id}
              guest={g}
              x={p.x}
              y={p.y}
              color={colors[g.group]}
              dragging={!!isDragging}
              selected={s.selection?.kind === 'guest' && s.selection.id === id}
              violated={violatedGuests.has(id)}
              touchedAt={touchedAt}
              staggerMs={recentTouch ? (hashId(id) % 12) * 30 : 0}
              whereLabel={s.seating[id] ? `at ${s.tables[s.seating[id].tableId]?.name}` : 'in the lounge'}
              onPointerDown={(e) => beginDrag(e, 'chip', id, positions[id])}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                s.setSelection({ kind: 'guest', id, at: { x: r.right + 10, y: r.top - 8 } })
              }}
            />
          )
        })}

        {s.guestOrder.length > 0 && (
          <div className="legend" aria-label="Chart legend">
            {Object.entries(colors).map(([group, color]) => (
              <span className="legend-item" key={group}>
                <span className="legend-swatch" style={{ background: color }} />
                {group}
              </span>
            ))}
            {s.constraints.length > 0 && (
              <span className="legend-item">
                <span className="legend-line" aria-hidden="true" />
                broken rule
              </span>
            )}
          </div>
        )}

        {s.finalized && <div className="ribbon">❦ &nbsp;Finalized — every guest seated, zero drama&nbsp; ❦</div>}

        {violations.length > 0 && !s.finalized && (
          <button
            className="viol-banner"
            onClick={() => seatEveryone('repair')}
            title="Runs the solver in repair mode — fixes every broken rule while moving as few guests as possible"
          >
            ⚠ {violations.length} rule{violations.length === 1 ? '' : 's'} broken · Fix With Minimal Moves
          </button>
        )}

        {!s.agentConnected && !empty && (
          <div className="canvas-hint">
            <span className="spark">✳</span>{' '}
            {unseatedCount > 0
              ? 'Drag guests onto tables, press Seat Everyone — or ask your AI agent'
              : 'This page speaks WebMCP — open it with your AI agent and plan together'}
          </div>
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
  dropTarget: boolean
  dragging: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  const { table, size, occupied, badge, touchedAt, selected, dropTarget, dragging } = props
  const flashing = touchedAt !== undefined && Date.now() - touchedAt < 4000

  const cls = ['table', table.shape, selected && 'selected', dropTarget && 'drop-target']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{
        transform: `translate(${table.x}px, ${table.y}px) translate(-50%, -50%)`,
        width: size.w,
        height: size.h,
        transition: dragging ? 'box-shadow 150ms ease' : 'transform 500ms ease, box-shadow 150ms ease',
        ...(dropTarget
          ? { boxShadow: 'inset 0 0 0 1px rgba(41,36,25,.22), 0 0 0 3px var(--gold-bright), 0 6px 18px rgba(10,16,12,.45)' }
          : {}),
      }}
      role="button"
      tabIndex={0}
      aria-label={`${table.name} — ${occupied} of ${table.seats} seats filled${badge ? `, ${badge} broken rule${badge === 1 ? '' : 's'}` : ''}. Press Enter to edit.`}
      onKeyDown={props.onKeyDown}
      onPointerDown={props.onPointerDown}
    >
      <span className="t-name">{table.name}</span>
      <span className="t-count">
        {occupied} / {table.seats}
      </span>
      {flashing && <span key={touchedAt} className="table-pulse" />}
      {badge ? <span className="t-badge">{badge}</span> : null}
    </div>
  )
}
