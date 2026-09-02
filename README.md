# ❦ Aisle

**A wedding seating chart that you and your AI agent plan together — live, on the same canvas.**

- 🔗 **Live app:** [aisle-ergjus-projects.vercel.app](https://aisle-ergjus-projects.vercel.app)
- 🎬 **Demo video:** _add the 3-minute YouTube link here before submitting_
- 🧩 Built on [WebMCP](https://github.com/webmachinelearning/webmcp) for **The WebMCP Challenge** (OpenAI)
- 📄 [MIT licensed](LICENSE) · no backend, no login — state lives in your browser

---

Seating a wedding is a two-brain problem.

- **Your agent** is good at the machine half: satisfying 17 constraints at once, importing 80 guests from a spreadsheet, re-tiering the whole room when a table disappears, and remembering every rule you've stated so far.
- **You** are good at the human half: family politics, vibes, taste. You veto, you drag people back, you know *why* Aunt Marta cannot be within a champagne-glass throw of Uncle Dario.

Aisle puts both hands on the same chart. You talk to your agent — *"seat everyone, keep the exes apart, Grandma away from the speakers"* — and the room **visibly rearranges itself**: a little agent cursor walks across the canvas, picks each guest chip up and carries it to its new seat, narrating its plan in a speech bubble. Then you drag someone somewhere spicier by hand, the violation lines light up, the drama meter climbs toward *Full telenovela*, and you say *"fix what I just broke"* — and the agent repairs it, moving as few guests as possible.

Neither of you could do this alone. That's the point.

## Why WebMCP

A seating chart is exactly the kind of task that falls apart when the agent and the human work in separate windows. Copy-pasting a guest list into a chat and getting a numbered list back loses the room: the distances, the sightlines, the fact that Table 4 is under the speakers. And a chat transcript is not something you can hand a caterer.

WebMCP lets the page itself hand the agent the same verbs the human has:

- **Shared state, not a shared transcript.** The agent doesn't describe a seating chart, it *edits the one you're looking at*. Every tool call moves real chips on the real canvas, and lands in the same undo stack your ⌘Z walks.
- **The page teaches the agent its own rules.** Zone constraints ("near the dance floor") are computed from real table geometry in feet. The agent never has to guess what "near" means — `explain_seating` tells it, in the same terms it tells you.
- **The toolset is state.** Tools appear and vanish as the room changes, so the agent's own capability list tells it what phase of the work it's in — `finalize_chart` literally does not exist until the chart is perfect.
- **The handoff runs both ways.** `propose_arrangement` blocks the agent's tool call on a human click. `ask_human` puts a question card on the chart and *waits for your answer*. `export_chart` composes the document and stops at the Print button — the one thing an agent can't press.
- **Your hand is law.** Pin a seat (press **P** on a chip) and the solver arranges the room *around* it; the agent's own seating tools refuse to move a pinned guest and say so. `get_recent_activity` lets the agent read what you did by hand since it last looked, so it reacts to your moves instead of overwriting them.

No API keys, no server, no bespoke integration. Open the page in an agent-enabled browser and the wedding planner is already a tool surface.

## Try it in 90 seconds

1. Open the [live app](https://aisle-ergjus-projects.vercel.app) in an agent-enabled browser (see [Testing with an agent](#testing-with-an-agent)).
2. First visit? A short **welcome guide** asks about your venue and builds a personalized room. Or skip it and click **Load Sample Wedding** — 72 guests, 10 tables, and 17 rules including a divorce, an ex-couple, a neighborly fence war, and a grandmother who hates loud speakers.
3. Ask your agent: *"Seat everyone. Keep the exes apart and put Grandma far from the band."*
4. Watch the room arrange itself, with a plain-language explanation of every trade-off.
5. Drag Sam Whitfield onto Jordan's table. Watch the violation line appear and the drama meter rise.
6. Ask: *"Fix any problems I just caused."* → *"Repaired the chart, moving only 1 guest."*
7. Ask: *"propose a bolder arrangement."* The room plays it out live under a gold **Keep / Revert** banner — and the agent's tool call **waits for your verdict**, then reports which way you ruled.
8. Drag Grandma Rosa to the table you want and press **P** to pin her. Ask: *"reseat the whole room."* Everyone else moves; she doesn't — and if the agent tries `seat_guest` on her, the tool tells it that seat is yours.
9. Ask: *"ask me which side the Pembertons should sit on before you move them."* A question card lands on the chart with the agent's options as buttons; its tool call **waits for your click**, then continues with your answer.
10. When every guest is seated and no rules are broken, a `finalize_chart` tool **appears out of nowhere** — ask your agent to finalize, and petals fall.
11. Say *"prepare the printed seating document — title it June & Ravi."* The **export studio opens on screen, already composed**: a to-scale floor plan, per-table cards, an A–Z guest directory, and a catering summary, paginated with a live preview. You press **Print · Save as PDF** — the one button an agent can't press.

No login, no backend. State lives in your browser's localStorage.

## The WebMCP tools

Aisle registers its tools through `document.modelContext.registerTool(tool, { signal })` — the current spec — and unregisters by aborting each tool's `AbortSignal`, with fallbacks for the deprecated `navigator.modelContext` alias, `unregisterTool()` on Chrome 146–150, and `provideContext({ tools })` on older drafts. Every tool has a `title`, a natural-language description, and a JSON Schema; read-only tools carry `readOnlyHint` (so agent surfaces can auto-approve them) and `untrustedContentHint` (their replies echo guest names and notes that people typed). Guests and tables are addressed by **fuzzy name** — agents say `"Grandma"` or `"Table 4"`, and ambiguity comes back as a helpful error listing candidates.

**41 tools in total.** Click the **agent's place card** in the masthead to browse every one of them, live, with its current registration state — and a list of things to try saying.

### Always registered (26)

| Tool | What it does |
| --- | --- |
| `share_plan` | *"I'll seat both families first, then sort out the two feuds."* The agent's plan appears as a speech bubble on its cursor and in the shared activity feed, so multi-step work is legible while it happens |
| `ask_human` | A question with 2–4 options lands on the chart as a card; **the tool call waits** (up to ~90 s) for your click or typed reply and returns it. For decisions that are yours: which side Grandma sits on, whether the kids get their own table |
| `point_at` | The cursor flies to up to three named guests, tables, or amenities and hovers there with a note — *"this is the table under the speakers"* — changing nothing |
| `get_recent_activity` | The shared activity feed, newest first, each line marked *human* or *agent* — so the agent can ask "what did they do since I last looked?" and react to it |
| `wrap_up` | The closing summary. The cursor announces it and steps off the canvas until the next request |
| `get_seating_chart` | Full room state: tables + occupants, unseated, constraints with status, violations, drama score |
| `update_venue` / `update_venue_dimensions` | The floor plan itself: room size in real feet, and nine amenities (entrance, dance floor, band, restrooms, photo booth, bar, buffet, cake table, gifts) shown/hidden, placed, resized, rotated — with overlap warnings |
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

### Registered only while tables exist (12)

| Tool | What it does |
| --- | --- |
| `seat_guest` / `unseat_guest` / `swap_guests` | Seat-level operations; a full table fails with the list of tables that still have space, and a **pinned** guest fails with *"that seat is theirs to change, not yours"* |
| `pin_guest` / `unpin_guest` | Pin a seated guest so the solver and every seating tool leave them exactly where they are. Humans pin with **P**; the room summary lists who is pinned |
| `auto_arrange` | The solver. `mode: "full"` redesigns the room; `mode: "repair"` fixes violations while moving as few guests as possible. Pinned seats stay put in both. Returns a plain-language explanation of what it honored and what it couldn't |
| `propose_arrangement` | `auto_arrange` as a **question**: the arrangement plays out live under a Keep/Revert banner, and the tool call **blocks until the human decides** (or ~30s pass), then reports the verdict. Any further edit quietly adopts a pending proposal; undo rejects it |
| `update_table` / `remove_table` | Rename, resize, reshape, rotate, reposition in real feet, remove — the table glides to its new spot rather than jumping, and displaced guests go politely back to the lounge |
| `clear_seating` / `list_unseated` / `list_violations` | Bulk reset and read tools for reasoning before acting |

### Registered while the chart has anything in it (2)

| Tool | What it does |
| --- | --- |
| `export_chart` | Composes the **printed seating document** — to-scale floor plan, table cards, A–Z directory, catering summary — and opens the export studio on screen pre-filled with the agent's masthead (title, date, venue), paper size, and section choices. The human reviews the live page preview and presses *Print · Save as PDF*: a real human-agent handoff, because the print button is the one thing an agent can't press |
| `get_chart_document` | The same chart as portable data — a per-table Markdown list for pasting into an email, or CSV (one row per guest) for a spreadsheet |

### Registered only while the chart is perfect (1)

| Tool | What it does |
| --- | --- |
| `finalize_chart` | Exists **only** when every attending guest is seated and zero rules are violated. Locks the chart and returns a formatted per-table list with dietary summary. Drag someone into trouble and the tool unregisters itself |

That last one is the dynamic-registration story in miniature: the *toolset itself* tells the agent what state the app is in.

## Human controls stay first-class

Everything the agent can do, you can do by hand on the same state — and everything you can do by hand, it can do too. The two sets are kept level on purpose:

- **Drag** any guest chip between tables and the lounge; drag tables around the room (zone rules like "near the dance floor" are computed from real table positions, so moving a table can genuinely fix — or cause — a violation). While you hover a chip over a table, the chair it would take pulls out to meet it.
- **Pin** a seat with **P** (or *Pin seat* in the guest card). A pushpin appears on the chip; *Seat Everyone*, repairs, and the agent all arrange the room around it.
- **Click** any chip or table to edit details in place — or Tab to it and press Enter; the canvas is keyboard-accessible. Press **?** for the full sheet of keys and gestures.
- **The sidebar** carries the same five jobs the tools do — **Venue** (room size in feet, amenities toggled and placed), **Tables** (add, reshape, resize, rotate), **Guests** (groups, RSVP, dietary, notes, bulk import), **House rules**, and **Activity**. Collapse it with ⌘B when you want the whole canvas.
- **Import a spreadsheet.** Drop an `.xlsx`, `.xlsm`, `.csv`, `.tsv`, or plain text file onto the Guests section and the header row is mapped for you — same code path as the agent's `import_guests`.
- **Seat Everyone** runs the same solver the agent uses, straight from the header; when rules break, a **"⚠ N rules broken · Fix With Minimal Moves"** banner appears on the chart and repairs the room in one click.
- **Undo/redo** every change, yours or the agent's (⌘Z / ⇧⌘Z — the veto button).
- **Rule on proposals** — when the agent uses `propose_arrangement`, the room rearranges live under a gold **Keep / Revert** banner and the agent literally waits for your click. Reverting glides everyone back; pressing ⌘Z counts as a revert; simply continuing to work adopts the proposal.
- **Answer its questions** — `ask_human` puts a card on the chart with the agent's options as buttons (and a box for your own words). Pick one and its tool call continues; skip it and the agent is told the decision is its own.
- Violated rules draw animated dashed lines between the offending guests, badge the table, and feed the **drama meter** (*Serene → Simmering → Full telenovela*); a legend on the chart decodes the group colors.
- Actions stream into a shared activity feed — the agent's entries in gold, yours labeled *You* — and everything the agent touches glows for a moment with a name tag, so bulk rearrangements stay legible.

The chart is a real seating planner without any agent at all — with a visible hint inviting you to bring one.

## The look

Aisle is set like wedding stationery laid over an architect's sheet, not like a dashboard. The chrome is ivory paper with a grain to it; the working text is **Karla**, the headings **Cormorant Garamond** and **EB Garamond**, and every number — feet, seat counts, tool names — is lettered in **IBM Plex Mono**, the way dimensions are on a drawing. The masthead reads like the top of a printed program: wordmark, a dateline of what's on the chart, a brass drama gauge, and a **place card set for the agent** that lights gold while it works. The floor plan has dimension strings along its walls and a title block in the corner (*Drawn by: You & the agent · Rev. 14*). Amenities are drawn top-down in gold ink — parquet on the dance floor, a bar with its stools, a cake in tiers — and every chair faces its table.

Motion is spent where it means something: the agent cursor carries chips and speaks in a real speech bubble; a chair pulls out when your chip hovers over it; a dropped chip settles with a soft ring; and petals fall exactly once, when the chart is finalized. Reduced-motion users get none of it and lose nothing.

## The welcome guide

First-time visitors get a short questionnaire instead of an empty room: pick a venue shape (**Ballroom**, **Garden / Tent**, **Restaurant / Private room**, or **Custom**), confirm the room's real dimensions in feet, choose how many tables and of what shape, and say what you care about most — family harmony, dance-floor energy, or easy arrivals. Aisle lays out a personalized venue with the amenities that fit, seats it with the sample wedding, and hands you a **three-step challenge** built around your answer:

1. **Seat the room** with Seat Everyone, honoring all 17 rules.
2. **Create a little tension** — drag the one guest whose rule your priority is about.
3. **Repair with restraint** — watch *Fix With Minimal Moves* disturb as few seats as possible.

The guide watches real state, not clicks, so you can wander off and do it your own way; it notices when you're done. Edit the chart out from under it (delete the guest it was about, remove the rule) and it pauses politely rather than breaking. **Welcome guide** in the header replays it any time.

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
aisle.call('share_plan', { plan: "I'll seat both families, then fix the feuds." })
aisle.call('auto_arrange', { mode: 'full' })    // watch the room arrange itself
aisle.call('seat_guest', { guest: 'Sam', table: 'Table 4' })
aisle.call('auto_arrange', { mode: 'repair' })
aisle.call('propose_arrangement', { mode: 'full' })  // Keep/Revert banner appears; the call waits for your verdict
aisle.call('explain_seating', { guest: 'Grandma' })
aisle.call('pin_guest', { guest: 'Grandma' })      // now seat_guest / auto_arrange leave her be
aisle.call('ask_human', { question: 'Which side should the Pembertons sit on?', options: ["Bride's", "Groom's"] })  // waits for your click
aisle.call('point_at', { targets: ['Table 4', 'band'], note: 'This table is under the speakers.' })
aisle.call('get_recent_activity', { who: 'human' })
aisle.call('export_chart', { title: 'June & Ravi', paper: 'letter' })  // opens the print studio, composed
aisle.call('wrap_up', { summary: 'Everyone is seated and both feuds are resolved.' })
```

## Running locally

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # static build in dist/
npm test        # 122 tests across 14 files (Vitest + Testing Library)
```

Vite + React 19 + TypeScript + Zustand, styled with Tailwind CSS 4 and shadcn/ui components (Base UI primitives) over a warm ivory/pine/gold token system. No backend; deploys as a static site (this repo auto-deploys to Vercel on push).

The tests cover the parts that would be miserable to verify by hand: the tool layer and its dynamic registration, proposal and question lifecycles under concurrency, pinned seats through the solver and the agent's tools, the geometry and zone bands, spreadsheet parsing, export pagination, the onboarding challenge state machine, and the sidebar's interaction details.

## Where things live

```
src/
  webmcp/tools.ts        every tool definition, JSON Schemas, and the registration diff
  webmcp/adapter.ts      navigator/document/window.modelContext detection + fallbacks
  store.ts               single Zustand store: chart state, undo/redo, activity feed
  solver.ts              the seating solver (full + minimal-repair modes)
  constraints.ts         rule evaluation, violations, drama score
  geometry.ts            real-feet room math, table/amenity footprints, zone bands
  actions.ts             shared human/agent actions, so both paths are one path
  agentCursor.ts         turns each mutation's diff into cursor choreography
  components/            Canvas, FloorArt, Sidebar, Header (masthead), AgentQuestion,
                         Celebration, Editors, ExportDialog, ToolsPage, ShortcutsDialog
  onboarding/            welcome questionnaire, personalized venue planner, challenge
  import/                .xlsx/.csv/.tsv reader (hand-rolled ZIP + XML, zero deps)
  export/                print document model, pagination, and the SVG floor plan
```

## How the interesting parts work

- **The solver** (`src/solver.ts`) — union-find clusters must-sit-together groups, seeds them greedily (most-constrained first), then hill-climbs with a seeded RNG over moves and swaps against a score that weighs hard rules (30 pts), zone preferences (12), group cohesion, and — in repair mode — a small penalty per displaced guest, which is what makes *"fix my mess"* move one person instead of reshuffling the room. Pinned guests go down first and are excluded from every move and swap, and a pinned guest's sit-together partner is drawn to their table. It narrates its result in plain language, including what it couldn't satisfy and why.
- **Zone rules** (`src/geometry.ts`) — "near the dance floor" means the guest's table is in the closest ~third of the distance range across all tables, so the rules stay meaningful as tables are dragged around.
- **The living chart** (`src/components/Canvas.tsx`) — every guest is one absolutely-positioned chip in a single coordinate space (tables *and* the unseated lounge), so any state change animates as a pure CSS transform glide, with a stable per-chip stagger for bulk moves. Agent-touched chips get one-shot CSS pulse animations on keyed overlay elements — no timers, nothing to get stuck.
- **The agent cursor** (`src/agentCursor.ts`) — each tool call's before/after diff is turned into a small performance: approach, grab, carry, drop. The chip itself is held back with a transition delay so the cursor visibly *carries* the guest, and `share_plan` / `wrap_up` give that cursor a voice, so a fifty-move rearrangement reads as work being done rather than a screen flicker.
- **Dynamic registration** (`src/webmcp/tools.ts`) — a store subscription recomputes the toolset signature (`hasTables`, `hasContent`, `canFinalize`) on every state change and diffs registrations, so tools appear and vanish as the room evolves. The in-app toolbox page renders the same catalog, showing exactly which tools are live and what unlocks the rest.
- **Tool calls that wait for people** (`propose_arrangement`, `ask_human`) — every mutating tool already holds its reply until the cursor choreography finishes; proposals and questions extend the same mechanism to a *human decision*: the reply stays open until Keep/Revert or an answer (or times out politely into a pending note). The lifecycles are honest under concurrency — any new snapshot adopts a proposal, undo rejects it, a second question is refused while one is waiting — and that logic is unit-tested.
- **Spreadsheet import with zero dependencies** (`src/import/`) — an `.xlsx` is a ZIP of XML, and browsers already ship the inflate half in `DecompressionStream`, so Aisle walks the archive's central directory itself and reads only the parts it needs. Header rows are matched by meaning, so name/group/RSVP/dietary columns can arrive in any order.
- **The export document** (`src/export/`) — the printed chart is modeled as plain data first: deterministic pagination from measured constants (unit-tested, no browser needed), then rendered twice from the same model — scaled down as the dialog's live preview and full-size for the browser's print pipeline, so what you preview is exactly what prints. The floor plan is one generated SVG: real-feet scale, dimension strings, hatched dance floor, seats colored by guest group.

## License

[MIT](LICENSE)
