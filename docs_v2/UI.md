# Breakwater v2 — UI Specification

**Version:** 2.0 · **Status:** Normative
**Principle:** *Only what we want to show is on screen.* Numbers, icons, color and position carry meaning. Words appear only where someone must act or where the agent explains a step.

---

## 1. Visual system

### 1.1 Typography
| Use | Family | Weight | Size / line-height |
|---|---|---|---|
| UI text | **Inter Variable** (`@fontsource-variable/inter`) | 400 / 500 / 600 | 14/20 base |
| Labels, table headers | Inter | 500, letter-spacing 0.02em | 12/16, `--ink-3` |
| Section titles | Inter | 600 | 16/24 |
| Page title (case name) | Inter | 600 | 20/28 |
| Key money (money strip, KPIs) | Inter, `font-variant-numeric: tabular-nums` | 600 | 22/28 |
| Table money | Inter tabular-nums, right-aligned | 500 | 14/20 |
| Times, codes, quotes | **IBM Plex Mono** (already installed) | 400 | 12/16 |
Remove IBM Plex Sans. No other fonts.

### 1.2 Color tokens (light only; `:root` CSS variables, mirrored in Tailwind theme)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#F6F7F9` | App background |
| `--surface` | `#FFFFFF` | Panels |
| `--surface-2` | `#F2F4F7` | Hover, table stripes, inactive tabs |
| `--border` | `#E4E7EC` | 1 px borders (no shadows except popovers) |
| `--ink` | `#101828` | Primary text, numbers |
| `--ink-2` | `#475467` | Secondary text |
| `--ink-3` | `#98A2B3` | Labels, placeholders |
| `--navy` | `#0B1F3A` | Brand mark, vessel marker, primary button |
| `--agent` | `#1D4ED8` | Agent activity: live dot, NOW card border, links |
| `--pos` | `#067647` | Verified, recovered, approved |
| `--neg` | `#B42318` | Disputed, invalid, excluded money |
| `--warn` | `#B54708` | Waiting on people, time bars, demurrage |
| `--memory` | `#6941C6` | Memory: ✦ NEW, "Used memory" chips |
| `--laytime` | `#CBD5E1` | Laytime band on the timeline |
| `--demurrage` | `#F5B544` | Demurrage band |
Status color always comes with an icon or word (never color alone).

### 1.3 Spacing, shape, motion
- 4 px grid. Panel padding 16. Gutters 16. Radius 8 (panels), 6 (buttons/chips), 999 (pills).
- Borders, not shadows. Popovers and menus use one shadow: `0 8px 24px rgba(16,24,40,.12)`.
- Motion: row insert 200 ms slide+fade; step insert 150 ms fade; clock jump 1,200 ms ease-in-out (vessel marker and playhead interpolate); ✦ NEW pulses twice. `prefers-reduced-motion` → no animation, instant jumps.

### 1.4 Iconography
`lucide-react` only, 16 px, stroke 1.75. Fixed meanings:
`◌` working (`Loader`, animated) · `✓` done (`Check`) · `?` waiting on a person (`CircleHelp`) · `!` needs review (`AlertTriangle`) · `✦` memory (`Sparkles`) · `⏳` time bar (`Hourglass`) · `⚡` disruption (`Zap`) · `🔒` locked period (`Lock`).

### 1.5 Formats
- Money: `$122,150` (no cents when whole); negative `−$17,000` (U+2212); deltas as chips `−$12,000` (neg) / `+$12,000` (warn).
- Time: `30 Oct 12:00` everywhere. **"UTC" appears once: in the top-bar clock.** Local times appear only inside document quotes.
- Durations: `122 h`, `30 h 00 m` only when minutes ≠ 0.
- Distances: `24.0 nm`.
- Counterparties: short names (`Nordhavn`, `Hansa`). Legal names only inside documents.

---

## 2. Copy rules (enforced by `scripts/copy-lint.ts` + E2E)

1. No subtitles under headings. No explanatory paragraphs. No helper text under inputs (use placeholders ≤ 24 chars).
2. Exactly one `SIM` badge (top bar). The words "synthetic", "simulated", "demo", "fixture", "mock" never appear outside the Proof tab.
3. Each financial metric appears **once** per view. Distinct metrics or ledger records may have equal dollar values (user clarification, 2026-10-24: e.g. the Recoverable KPI and a case recovery can both be $27,000). E2E checks metric/record identity, not formatted-value equality; popovers are excluded.
4. Agent step titles ≤ 60 chars and verb-first ("Checked NOR against AIS"). Notes ≤ 80 chars. Ask questions ≤ 140 chars.
5. Banned anywhere in UI copy: "AI-powered", "intelligent", "seamless", "leverage", "robust", "magic", "simply", "please note", "as an AI", "workflow" (in visible copy), lorem ipsum.
6. No IDs in visible text except business codes where needed (`DC-2026-0412` in the room header tooltip only). Convex IDs, correlation IDs, token counts, model names: Proof tab or hover only.
7. Never show raw JSON. Payloads render as sentences or small key/value rows.
8. Labels use nouns; buttons use verbs (`Approve $122,150`, `Link to hold`, `Submit`).

The copy linter fails the gate on: JSX text literals > 80 chars; banned terms; more than one `SIM` occurrence in `src/components/shell`.

---

## 3. Shell

- **No sidebar.** Two pages share one top bar (56 px, `--surface`, bottom border).
- Top bar, left → right:
  - `≋ Breakwater` (navy wordmark) · `Meridian Commodities` (ink-2).
  - On the Voyage Room only: `← Desk` and the case title.
  - Clock (center): `Sat 24 Oct 2026 · 00:00 UTC` + state pill (`Idle` / `Running` / `Held · Controller`); when held: `▶ Let time pass` (ghost button).
  - Right: `⚡ New disruption` (Desk only, primary navy; disabled with tooltip "Disruption in progress" when active) · `Acting as` select (Observer, Dana Ruiz · Ops, Marcus Hale · Controller, Priya Shah · Trader) · `SIM` badge · `⋯` menu (`Reset demo` with confirm dialog).
- Primary viewport **1440×900**: no page scroll on either page. 1920×1080 scales up with the same proportions. ≥ 1280 supported. < 1024: read-only stacked layout.

---

## 4. Desk (`/`)

~~~text
┌ top bar ───────────────────────────────────────────────────────────────────────────┐
├────────────┬────────────┬─────────────┬──────────────┬──────────────────────────────┤
│ We owe     │ Recoverable│ Net this Q  │ Time bars    │ Periods                      │  72 px KPI strip
│ $412,300   │ $268,900   │ −$96,400    │ 2 ⏳ < 7 days │ Sep 🔒 · Oct open · Nov open │
├────────────┴────────────┴─────────────┴──────────────┴─────┬────────────────────────┤
│ Cases   Books   Proof                                       │ Waiting on people      │
│─────────────────────────────────────────────────────────────│ Ops 1 · Controller 0 · │
│ Vessel           Owner → Cargo      Status        Owe  Recover  Net  ⏳  │ Trader 0 │
│ ◌ Aster Vale     Nordhavn → Hansa   Checking NOR… $0  $0  $0 —     │ ? Kestrel  16d  $9,000 │
│   Rotterdam                                                          │   Confirm customs hold │
│ ? Kestrel        Thalassa → Litoral Waiting · Ops  $36,000 …         │────────────────────────│
│   Santos                                                             │ Learned                │
│ ✓ Halden Star    Okeanos → Al-Noor  Awaiting invoice …               │ ✦ Check customs portal │
│ ▸ 32 closed                                                          │   first · Active       │
└─────────────────────────────────────────────────────────────┴────────────────────────┘
                                  main: 1fr                          rail: 360 px
~~~
Wireframe values are illustrative; every rendered value comes from backend queries.

### 4.1 KPI strip (one bordered strip, 5 cells, label 12 px / value 22 px)
| Cell | Definition (backend) |
|---|---|
| We owe | 2000 + 2150 balances (open AP + accrued) |
| Recoverable | 1200 balance (filed, unpaid) |
| Net this Q | (5100 − 5190) for Q4 to date, shown negative (a cost) |
| Time bars | count of open recoveries with time bar < 7 days; warn color when > 0 |
| Periods | last locked + open periods as compact text with 🔒 |

### 4.2 Cases tab
- Columns: **Vessel** (name, port beneath in ink-3) · **Owner → Cargo** · **Status** (icon + `statusLine` ≤ 48 chars; for working cases, the current step title, live) · **Owe** · **Recover** · **Net** · **⏳** (days to time bar, warn if < 7) · **Updated** (sim time). Money right-aligned, tabular.
- Order: working → waiting on people → waiting external → closed group (collapsed: `▸ 32 closed`).
- While a fleet scan is queued/running, show its real affected-port/ETA candidates with the actual scan step. These work rows have no monetary estimates or case link until `open_case` persists the case. They share a stable voyage key with the resulting case row; no guessed codes or outcomes.
- New case: row slides in at the top with a 2 s `--agent` 6%-tint highlight.
- Row click → `/case/[code]`. Hover shows the row in `--surface-2`.

### 4.3 Books tab
- Left (40%): trial balance: account, name, debit, credit, a balanced check row (`✓ Balanced`).
- Right (60%): journals table: date, entry, case, kind, amount, authority (icon: `delegation` or approver persona). Click → inline expansion with lines and evidence chips. Filter chip: `This quarter` / `All`.
- Periods row at the top: `Jan … Sep 🔒 · Oct 🔒 (3 Nov) · Nov · Dec`.

### 4.4 Proof tab
Three blocks: a full-width scoreboard above two supporting panels (user override, 25 Oct 2026).
- **Scoreboard:** run date, model, voyages; metrics table (TEST_MATRIX §6); `View voyages` expands per-voyage pass/fail.
- Classifier names, confidence bars and calibration results are not shown in the UI. Internal evidence remains persisted.
- **Real vs simulated:** two-column list (Real: Claude calls, Convex state, double-entry, audit chain, PDF reading. Simulated: company, vessels, AIS, documents, counterparties, personas/role toggle, scripted world events, scripted responder in the scoreboard).
- **Audit chain:** `✓ 1,284 events verified` + `Verify now` button.

### 4.5 Right rail
- **Waiting on people:** role chips with counts (the current acting role is highlighted). List items: icon, vessel, age, amount at risk, question (1 line, truncated). Click → opens the case with that role's work surface. If the acting persona differs, the card shows `Answer as Controller` (switches persona then opens).
- **Learned:** last 5 memory items: ✦ title, status pill (`Active` pos, `Pending` warn, `Precedent` ink-3, `Rejected` neg).

---

## 5. Voyage Room (`/case/[code]`)

~~~text
┌ top bar: ← Desk  MV Aster Vale · Rotterdam  Nordhavn → Hansa   clock   Acting as  SIM ┐
├───────────────────────────────────────────────────────────┬─────────────────────────┤
│                                                           │ Thinking   Memory ✦1    │
│                CENTER STAGE (mode-dependent)              │─────────────────────────│
│   MAP mode: light basemap, anchorage + berth polygons,    │ NOW  ◌ Checked NOR vs AIS│
│   vessel ▲ with heading, past track, NOR ✕ pin with a     │  NOR 06:00 · ship 24.0 nm│
│   dashed line to port limits labelled "24.0 nm"           │  outside port limits    │
│                                                           │  → laytime from 25 Oct  │
│                                                           │  [NOR] [AIS 06:00]  −$12,000│
│                                                           │─────────────────────────│
├───────────────────────────────────────────────────────────┤ ✓ Opened case            │
│ AIS     ▬drift▬ ▬▬anchored▬▬▬▬▬▬▬ ⇢ ▬berth▬               │ ✓ Recorded arrival 18:00 │
│ Charter ░░░░laytime░░░░██████ demurrage ██▒▒▒██           │ ✦ Used memory: customs…  │
│ Sale    ░░░░░laytime░░░░████████████                      │                         │
│ Docs    ◆N        ◆H         ◆S    ◆I                     │ ┌ ASK · Controller ────┐ │
│ Period  ── Oct ─────────────┃🔒 Nov ──────                 │ │ Approve $110,150 …   │ │
│                       ▲ now                    [Live]     │ └──────────────────────┘ │
├───────────────────────────────────────────────────────────┴─────────────────────────┤
│ Billed $139,150 │ We owe $110,150 est. │ Recover $90,600 filed │ Net −$19,550 │ ⏳ filed │
└─────────────────────────────────────────────────────────────────────────────────────┘
 grid: columns [1fr 400px]; rows [1fr 168px 64px]
~~~

### 5.1 Center stage modes
| Mode | When | Content |
|---|---|---|
| `MAP` | Default; Observer; no open ask for the acting role in this case | MapLibre map (§5.2) |
| `DOCUMENT` | A doc pin or evidence chip was clicked | pdf.js viewer, quote highlighted, `← Map` button; header shows title + received time |
| `OPS_DESK` | Acting as Ops and this case has an open `CONFIRM_FACT` ask | §8.1 |
| `STATEMENT` | Acting as Controller and an open `PAYMENT_APPROVAL` ask | §8.2 |
| `RECOVERY` | Acting as Trader and an open `COMMERCIAL_DECISION` ask | §8.3 |
After an answer is submitted, the mode returns to `MAP` and the acting persona resets to Observer.

### 5.2 Map
- Style: OpenFreeMap positron (light); fallback bundled coastline (`public/geo/coast-nl.json`, `coast-br.json`) on `--surface-2`.
- Layers: anchorage polygon (fill `--agent` 6%, stroke 1 px `--agent` 40%) with label `Port limits`; berth polygon (fill `--navy` 8%); past track (`--ink-2`, 1.5 px; dashed across AIS gaps); vessel marker (navy triangle, rotated by COG); **no future path**.
- Evidence pins: NOR ✕ (`--neg`) at the tender position with the label `NOR 06:00`; dashed line to the nearest port-limit point labeled with the computed distance. Shifting segment highlighted `--warn` when the shifting fact exists.
- The camera fits the case geometry; it follows the vessel during clock jumps.

### 5.3 Timeline (168 px, 5 lanes of 24 px + axis)
- Range: case window = first AIS point in port area − 6 h → max(simNow, completion) + 6 h.
- Lanes: **AIS** (Drifting / Underway / Anchored / Shifting / Berthed / Gap segments with text when ≥ 48 px wide) · **Charter** (laytime `--laytime`; demurrage `--demurrage`; EXCLUDE = diagonal hatch; HALF = dotted) · **Sale** (same) · **Docs** (◆ pins: N NOR, S SOF, H harbour notice, C customs, I invoice, L our letter) · **Period** (month segments, 🔒 when locked).
- Playhead = `simNow` (live). Clicking the axis sets a *view cursor* (map shows the position then); `Live` returns. Keyboard: ←/→ 1 h, Shift 6 h, Esc = live.
- Hover a band → small tooltip: kind, interval, treatment, clause.

### 5.4 Rail: Thinking tab
- **NOW** card (visible when a task runs): `--agent` left border, ◌, title, then up to 3 short lines (observation → check → conclusion), evidence chips, delta chip.
- **Done** list (newest first, 1 line each): icon · title · delta chip right. Click to expand into the same three lines + `Tools used: Read NOR · Checked AIS` (plain names) + memory chip.
- Steps that used memory show a `✦ Used memory` chip linking to the Memory tab item.
- Pinned **ask card** at the bottom (any tab): role chip, question, amount at risk, age; if the acting persona matches → `Open`; else `Answer as <Role>`.

### 5.5 Rail: Memory tab
- Sections: `Learned here` · `Used here` · `Recent`.
- Item row: ✦ (NEW badge for 30 s) · title (≤ 60) · kind pill (Fact / Procedure / Precedent) · status pill · provenance line `from Marcus Hale · 9 Dec`.
- Expanded (in place): **What changed:** `I did: Counted closure at half` / `Marcus did: Counted in full · CP cl. 8`. **Decision:** gate reason (1 line). **Backtest:** `6/6 consistent` (procedures). **Approval:** who/when. **Used in:** case chips.
- PRECEDENT_ONLY items render in `--ink-3` with `Not learned · commercial judgment`.
- Controller acting + `PENDING_CONTROLLER` item → inline `Approve` / `Reject` buttons in the expanded item (this is the `APPROVE_MEMORY` ask surface).

### 5.6 Money strip (64 px, 5 cells)
| Cell | Content |
|---|---|
| Billed | owner invoice total or `—` |
| We owe | payable total + state (`est.` / `approved`) |
| Recover | recoverable total + state (`est.` / `filed` / `waived $3,000`) |
| Net | We owe − Recover (cost shown negative) |
| ⏳ | time bar countdown (`30 d`), `filed ✓` when filed |
Click any cell → **Why?** popover (≤ 3 sentences + evidence chips). Right end: `Journals` → bottom sheet listing this case's journal entries (lines, period, authority).

---

## 6. Role swap rules

| Zone | Changes with the acting role? | Why |
|---|---|---|
| Top bar | No | Same company, same case, same clock |
| Center stage | **Yes** (§5.1) | The only thing that differs between roles is the job |
| Timeline | No | Shared time reference; Ops and the Controller both use it |
| Rail: Thinking/Memory | No (content); action buttons appear only for permitted roles | Humans see why they were asked; learning is visible to all |
| Ask card | Actionable only for the target role | Separation of duties |
| Money strip | No | One truth for the numbers; edits update it live |
Buttons a role cannot use are **hidden**, not greyed. The server enforces permissions regardless.

---

## 7. Teach-back
After a human submits an answer that produced a lesson needing teach-back, the rail shows a compact card for that persona:
`Next time?` + up to 3 buttons from the classifier scope (e.g., `All ports` · `Santos only` · `Don't`), or for the Controller fact: `All Nordhavn CP-2019 voyages` · `Just this case`. One click; no text.

---

## 8. Work surfaces

### 8.1 OPS_DESK
~~~text
┌ Confirm customs hold 3 Oct 17:00 – 4 Oct 05:00 · $9,000 at stake ─────────────────────┐
│ Sources          │ Results                      │ Preview                               │
│ ● Mailbox        │ ▸ Customs release 1004       │  (pdf.js)                             │
│ ○ Customs portal │   4 Oct · Receita Federal    │                                       │
│ ○ Documents      │ ▸ Hold notice 1003           │                       [Link to hold]  │
│ [ Kestrel      ] │                              │                                       │
├──────────────────┴──────────────────────────────┴───────────────────────────────────────┤
│ Linked: Customs release 1004 ✕     ( ) Confirm  ( ) Different cause  ( ) Can't find  [Submit] │
└─────────────────────────────────────────────────────────────────────────────────────────┘
~~~
Events emitted: `WORK_STARTED` (on open), `SOURCE_SEARCHED` (on search submit), `DOCUMENT_OPENED`, `EVIDENCE_LINKED/UNLINKED`, `ANSWER_SUBMITTED`. No keystroke capture.

### 8.2 STATEMENT (Controller)
Table: Line · Interval · Owner h · Our h · Treatment (select: Count / Exclude / Half) · Basis (clause chip) · $ impact. Variance rows have a `--neg` left bar. Changing a treatment opens an inline basis row (clause select + note ≤ 80 chars, required); totals recompute from the server engine.
Footer: `Payable $110,150 · Dispute $29,000 · Limit $50,000` · `[Reject]` `[Approve $110,150]` (the label updates with edits).

### 8.3 RECOVERY (Trader)
Card: `Hansa Mills` + `Strategic` pill · claim `$93,600` · `⏳ 2 Dec · 30 d` · last 3 cases with Hansa (date, amount, outcome). Buttons: `Pursue $93,600` · `Partial` (reveals amount + reason) · `Waive` (reason). Submit.

---

## 9. States (every panel)
Loading: skeleton bars (no spinners except NOW). Empty: one short line (`No cases yet`). Error: one line + action (`Investigation paused · Retry`). Held: clock pill `Held · Trader`. Permission: hidden affordances. Model failure on a step: step icon `!` + `Model unavailable · Retry`.

## 10. User-visible error text
| Code | Text |
|---|---|
| `PERIOD_LOCKED` | "October is closed. Posting to December." (informational) |
| `OVER_DELEGATION` | "Over limit · sent to Controller" |
| `SOD_VIOLATION` | "You proposed this; someone else must approve" |
| `CAPABILITY_DENIED` | "No access to Customs portal" |
| `QUOTE_NOT_FOUND` | "Couldn't verify a value in the document" |
| `MODEL_UNAVAILABLE` | "Paused · model unavailable · Retry" |
| `CLASSIFIER_UNAVAILABLE` | "Lesson held for review" |

## 11. Accessibility
WCAG AA contrast; visible 2 px `--agent` focus ring; all controls keyboard reachable; tab order top bar → stage → timeline → rail → money strip; ARIA live region (polite) for new steps and asks; text alternatives for map (the timeline and steps carry the same facts).

## 12. Required screenshots (V12 evidence; inspected by eye, defects recorded in progress.md)
U-01 Desk baseline · U-02 Desk with Aster Vale working · U-03 Room MAP with NOR pin + distance · U-04 Room OPS_DESK (Kestrel) · U-05 Memory with NEW procedure expanded · U-06 Room STATEMENT with edited line · U-07 Room RECOVERY · U-08 Memory showing ACTIVE fact + greyed precedent · U-09 Books balanced · U-10 Proof tab.
