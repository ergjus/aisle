# ❦ Aisle

**A wedding seating chart that you and your AI agent plan together — live, on the same canvas.**

🔗 **Live:** [aisle-ergjus-projects.vercel.app](https://aisle-ergjus-projects.vercel.app) · Built on [WebMCP](https://github.com/webmachinelearning/webmcp) for the OpenAI WebMCP Challenge · MIT licensed

---

Seating a wedding is a two-brain problem.

- **Your agent** is good at the machine half: satisfying 17 constraints at once, importing 80 guests from a pasted list, re-tiering the whole room when a table disappears, and remembering every rule you've stated so far.
- **You** are good at the human half: family politics, vibes, taste. You veto, you drag people back, you know *why* Aunt Marta cannot be within a champagne-glass throw of Uncle Dario.

Aisle puts both hands on the same chart. You talk to your agent — *"seat everyone, keep the exes apart, Grandma away from the speakers"* — and the room **visibly rearranges itself**: chips glide between tables with a candlelight pulse on everything the agent touched, so you can follow exactly what changed. Then you drag someone somewhere spicier by hand, the violation lines light up, the drama meter climbs toward *Full telenovela*, and you say *"fix what I just broke"* — and the agent repairs it, moving as few guests as possible.

Neither of you could do this alone. That's the point.

## Try it in 90 seconds

1. Open the [live app](https://aisle-ergjus-projects.vercel.app) in an agent-enabled browser (see [Testing with an agent](#testing-with-an-agent)).
2. Click **Load Sample Wedding** — 72 guests, 10 tables, and 17 rules including a divorce, an ex-couple, a neighborly fence war, and a grandmother who hates loud speakers.
3. Ask your agent: *"Seat everyone. Keep the exes apart and put Grandma far from the band."*
4. Watch the room arrange itself, with a plain-language explanation of every trade-off.
5. Drag Sam Whitfield onto Jordan's table. Watch the violation line appear and the drama meter rise.
6. Ask: *"Fix any problems I just caused."* → *"Repaired the chart, moving only 1 guest."*
7. Ask: *"propose a bolder arrangement."* The room plays it out live under a gold **Keep / Revert** banner — and the agent's tool call **waits for your verdict**, then reports which way you ruled.
8. When every guest is seated and no rules are broken, a `finalize_chart` tool **appears out of nowhere** — ask your agent to finalize, and get a caterer-ready seating list.
9. Say *"prepare the printed seating document — title it June & Ravi."* The **export studio opens on screen, already composed**: a to-scale floor plan, per-table cards, an A–Z guest directory, and a catering summary, paginated with a live preview. You press **Print · Save as PDF** — the one button an agent can't press.

No login, no backend. State lives in your browser's localStorage.

## The WebMCP tools

Aisle registers its tools through `navigator.modelContext` (with fallbacks for `document.modelContext` / `window.modelContext` across preview builds, and `provideContext` for older drafts). Every tool has a natural-language description and a JSON Schema; read-only tools carry `readOnlyHint` annotations. Guests and tables are addressed by **fuzzy name** — agents say `"Grandma"` or `"Table 4"`, and ambiguity comes back as a helpful error listing candidates.

**Always registered (23):**

| Tool | What it does |
| --- | --- |
| `get_seating_chart` | Full room state: tables + occupants, unseated, constraints with status, violations, drama score |
| `update_venue` / `update_venue_dimensions` | The floor plan itself: room size in real feet, and nine amenities (dance floor, band, bar, buffet…) shown/hidden, placed, resized, rotated — with overlap warnings |
| `list_guests` | Roster with group, RSVP, dietary, notes; filter by unseated/group/RSVP |
| `explain_seating` | *Why is she there?* One guest's seat, tablemates, group context, and every rule involving them with live status — including how near/far their table actually is from the dance floor, band, or entrance |
| `save_checkpoint` / `restore_checkpoint` | Named save points over the whole chart. The agent checkpoints before a bold experiment; if the human hates the result, one call puts everything back — and the restore itself is undoable |
| `add_guest` / `update_guest` / `remove_guest` | Guest management; setting RSVP "no" frees the seat |
| `import_guests` | Bulk import from spreadsheet rows (CSV/TSV, header row read and its columns mapped in any order), from one-guest-per-line text, or from JSON |
| `add_group` / `remove_group` | Name a party before anyone is in it; drop one once it's empty |
| `add_table` | Add a table (2–16 seats, round or banquet) in an open spot — or a whole row of them with `count`, as one undoable step |
| `add_constraint` | `must_sit_together`, `must_sit_apart`, or near/far rules for the dance floor, band, and entrance |
| `remove_constraint` / `list_constraints` | Manage rules by id or by guest |
| `undo` / `redo` | The same history the human's ⌘Z walks, agent edits and theirs alike; `steps` walks back several at once |
| `reset_chart` | Clears the room, exactly as the header's Reset does. Refuses without `confirm: true`, so it can only follow an explicit request |
| `load_sample_wedding` | The demo wedding, one call away |

**Registered only while tables exist (10):**

| Tool | What it does |
| --- | --- |
| `seat_guest` / `unseat_guest` / `swap_guests` | Seat-level operations; a full table fails with the list of tables that still have space |
| `auto_arrange` | The solver. `mode: "full"` redesigns the room; `mode: "repair"` fixes violations while moving as few guests as possible. Returns a plain-language explanation of what it honored and what it couldn't |
| `propose_arrangement` | `auto_arrange` as a **question**: the arrangement plays out live under a Keep/Revert banner, and the tool call **blocks until the human decides** (or ~30s pass), then reports the verdict. Any further edit quietly adopts a pending proposal; undo rejects it |
| `update_table` / `remove_table` | Rename, resize, reshape, rotate, reposition in real feet, remove — the table glides to its new spot rather than jumping, and displaced guests go politely back to the lounge |
| `clear_seating` / `list_unseated` / `list_violations` | Bulk reset and read tools for reasoning before acting |

**Registered while the chart has anything in it (2):**

| Tool | What it does |
| --- | --- |
| `export_chart` | Composes the **printed seating document** — to-scale floor plan, table cards, A–Z directory, catering summary — and opens the export studio on screen pre-filled with the agent's masthead (title, date, venue), paper size, and section choices. The human reviews the live page preview and presses *Print · Save as PDF*: a real human-agent handoff, because the print button is the one thing an agent can't press |
| `get_chart_document` | The same chart as portable data — a per-table Markdown list for pasting into an email, or CSV (one row per guest) for a spreadsheet |

**Registered only while the chart is perfect (1):**

| Tool | What it does |
| --- | --- |
| `finalize_chart` | Exists **only** when every attending guest is seated and zero rules are violated. Locks the chart and returns a formatted per-table list with dietary summary. Drag someone into trouble and the tool unregisters itself |

That last one is the dynamic-registration story in miniature: the *toolset itself* tells the agent what state the app is in.

## Human controls stay first-class

Everything the agent can do, you can do by hand on the same state — and everything you can do by hand, it can do too. The two sets are kept level on purpose:

- **Drag** any guest chip between tables and the lounge; drag tables around the room (zone rules like "near the dance floor" are computed from real table positions, so moving a table can genuinely fix — or cause — a violation).
- **Click** any chip or table to edit details in place — or Tab to it and press Enter; the canvas is keyboard-accessible.
- **Seat Everyone** runs the same solver the agent uses, straight from the header; when rules break, a **"⚠ N rules broken · Fix With Minimal Moves"** banner appears on the chart and repairs the room in one click.
- **Undo/redo** every change, yours or the agent's (⌘Z — the veto button).
- **Rule on proposals** — when the agent uses `propose_arrangement`, the room rearranges live under a gold **Keep / Revert** banner and the agent literally waits for your click. Reverting glides everyone back; pressing ⌘Z counts as a revert; simply continuing to work adopts the proposal.
- Violated rules draw animated dashed lines between the offending guests, badge the table, and feed the **drama meter** (*Serene → Simmering → Full telenovela*); a legend on the chart decodes the group colors.
- Actions stream into a shared activity feed — the agent's entries in gold, yours labeled *You* — and everything the agent touches glows for a moment with a name tag, so bulk rearrangements stay legible.

The chart is a real seating planner without any agent at all — with a visible hint inviting you to bring one.

## The deliverable: a printed seating document

**Export…** opens a studio-style composer for the document you'd actually pin up at the venue: a masthead with the couple's names, date, and a Final/Working-draft stamp; a **to-scale vector floor plan** (dimension strings, 5′ grid, scale bar, seats colored by guest group); per-table seating cards with dietary superscripts; an A–Z **"find your seat" directory**; and a catering & dietary summary for the kitchen. Sections are toggleable with a live page preview (Letter or A4), and it prints through the browser — so *Save as PDF* is one keystroke, with Markdown and CSV alongside.

The same composer is a tool: an agent calls `export_chart` with a title, date, venue, and section list, and the studio **opens on the human's screen already composed** — the human just reviews the preview and presses Print. Planning ends with a real artifact, made by both of you.

## Testing with an agent

**Chrome (early preview):** WebMCP ships behind a flag from Chrome 146. Enable `chrome://flags/#enable-webmcp-for-testing`, restart, open the live URL, and use a WebMCP-capable agent surface (e.g. Gemini in Chrome, or an extension that consumes `navigator.modelContext`). The current API has moved between releases — Aisle detects `document.modelContext`, `navigator.modelContext`, and `window.modelContext`, prefers incremental `registerTool`/`unregisterTool`, and falls back to `provideContext({tools})` on older drafts.

**ChatGPT browser / Atlas:** open the live URL and ask the agent to plan the wedding; Aisle's tools appear as page tools.

**No agent? No problem.** The exact same tool layer is exposed in the DevTools console:

```js
aisle.tools()                                   // list currently registered tools
aisle.call('load_sample_wedding', {})
aisle.call('auto_arrange', { mode: 'full' })    // watch the room arrange itself
aisle.call('seat_guest', { guest: 'Sam', table: 'Table 4' })
aisle.call('auto_arrange', { mode: 'repair' })
aisle.call('propose_arrangement', { mode: 'full' })  // Keep/Revert banner appears; the call waits for your verdict
aisle.call('explain_seating', { guest: 'Grandma' })
aisle.call('export_chart', { title: 'June & Ravi', paper: 'letter' })  // opens the print studio, composed
```

## Running locally

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # static build in dist/
```

Vite + React 18 + TypeScript + Zustand, styled with Tailwind CSS 4 and shadcn/ui components (Base UI primitives) over a warm ivory/pine/gold token system. No backend; deploys as a static site (this repo auto-deploys to Vercel on push).

## How the interesting parts work

- **The solver** (`src/solver.ts`) — union-find clusters must-sit-together groups, seeds them greedily (most-constrained first), then hill-climbs with a seeded RNG over moves and swaps against a score that weighs hard rules (30 pts), zone preferences (12), group cohesion, and — in repair mode — a small penalty per displaced guest, which is what makes *"fix my mess"* move one person instead of reshuffling the room. It narrates its result in plain language, including what it couldn't satisfy and why.
- **Zone rules** (`src/geometry.ts`) — "near the dance floor" means the guest's table is in the closest ~third of the distance range across all tables, so the rules stay meaningful as tables are dragged around.
- **The living chart** (`src/components/Canvas.tsx`) — every guest is one absolutely-positioned chip in a single coordinate space (tables *and* the unseated lounge), so any state change animates as a pure CSS transform glide, with a stable per-chip stagger for bulk moves. Agent-touched chips get one-shot CSS pulse animations on keyed overlay elements — no timers, nothing to get stuck.
- **Dynamic registration** (`src/webmcp/tools.ts`) — a store subscription recomputes the toolset signature (`hasTables`, `hasContent`, `canFinalize`) on every state change and diffs registrations, so tools appear and vanish as the room evolves.
- **Tool calls that wait for people** (`propose_arrangement`) — every mutating tool already holds its reply until the cursor choreography finishes; proposals extend the same mechanism to a *human decision*: the reply stays open until Keep/Revert (or times out politely into a pending note). The proposal's lifecycle is honest under concurrency — any new snapshot adopts it, undo rejects it — and that logic is unit-tested.
- **The export document** (`src/export/`) — the printed chart is modeled as plain data first: deterministic pagination from measured constants (unit-tested, no browser needed), then rendered twice from the same model — scaled down as the dialog's live preview and full-size for the browser's print pipeline, so what you preview is exactly what prints. The floor plan is one generated SVG: real-feet scale, dimension strings, hatched dance floor, seats colored by guest group.

## License

[MIT](LICENSE)
