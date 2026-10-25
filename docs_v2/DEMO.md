# Breakwater v2 — Judged Demo Runbook

**Target length:** 5:00 live · **Mode:** local UI and local Convex, live Claude, scripted world. Presenter-owned testing; no video required.

## Preconditions (presenter checks; see `workflow.md`)
- Local frontend at http://127.0.0.1:3000 points to the local Convex deployment; the provider key is configured there.
- `npm run demo:prepare` completed (≈ 3–5 min, real agent): history imported; Kestrel waiting on Ops (ask age 16 d, one reminder); Halden Star awaiting the owner invoice; sim clock 24 Oct 00:00 Idle; no Aster Vale case; P-CUSTOMS-PORTAL-FIRST absent.
- Browser at 1440×900, zoom 100%, Acting as Observer.
- Proof tab shows a recorded scoreboard run.

## Script

### Act 0 — The company (0:00–0:20)
Desk. One sentence: *"Meridian charters ships and sells grain. Breakwater runs its demurrage desk: what we owe shipowners, what we recover from buyers, and the books."* Point at the KPI strip, then at `Waiting on people · Ops 1`. *"A colleague has had a question waiting for 16 days."*

### Act 1 — A human teaches it (0:20–1:30)
1. Click the Kestrel ask → `Answer as Ops`. The center stage becomes the Ops desk. The question is already there: *Confirm customs hold … $9,000 at stake.*
2. Mailbox: nothing. Switch to **Customs portal**, search `Kestrel`, open the release, `Link to hold`, `Confirm`, `Submit`.
3. Rail: the agent resumes: `✓ Verified customs hold · +$9,000 recoverable` → `✓ Filed $27,000 claim on Litoral`.
4. Teach-back card for Ops: `Next time?` → **All ports**.
5. Memory tab: `✦ NEW Check customs portal before asking Ops`, `Pending · Controller`. Expand: *I tried: Mailbox · Dana used: Customs portal* · `Backtest 6/6`.
6. Switch to **Controller** → `Approve`. Status `Active`.
Narration: *"It learned from what she did, not from a note. And it couldn't give itself access to the customs portal. The Controller had to grant it."*

### Act 2 — The disruption (1:30–3:50)
7. `← Desk` → **⚡ New disruption**. A row slides in: `◌ Aster Vale · Rotterdam · Reading port advisory…`. Open it.
8. **The moment** (≈ 1:45): the NOR arrives. NOW card: `Checked NOR against AIS` → map shows the ✕ pin and `24.0 nm` to port limits. On the next AIS update (the vessel anchors, 18:00) the deemed tender lands: chip `−$12,000` (CONTRACTS §10.5).
   *"The owner says the ship was ready at six. It was twenty-four miles outside the port."*
9. Clock jumps (no narration needed): storm closure band; `✓ Port closure · counted at half (cl. 8)`.
10. Phyto hold: `✦ Used memory · Check customs portal` → `✓ Release found · hold verified`. *"No question to Ops this time."*
11. Month-end: `✓ Accrued $80,000 for October` (Period lane 🔒 at 3 Nov).
12. SOF arrives: `✓ Converted local times (DST) · completion 06:00, not 07:00`. (Shifting was already excluded from AIS on 30 Oct: `−$4,000`.)
13. **Ask 1 · Trader:** `Answer as Trader` → `Partial` → **File amount `90600`** (a $3,000 reduction), reason *"Goodwill: Hansa took a late Q3 cargo"* → Submit. The rail shows `✓ Filed $90,600 claim on Hansa · 30 days before time bar`. Memory shows a greyed item: `Not learned · commercial judgment`.
   *"That was a judgment call. It records it as precedent and refuses to turn it into a rule."*
14. Clock jumps to 9 Dec: owner invoice `$139,150`. `✓ Reconciled · 4 variances · $150 fee accepted (below materiality)`.
15. **Ask 2 · Controller:** `Answer as Controller` → statement opens. Change *Port closure* from Half to **Count**, basis `cl. 8 · already on demurrage` → total updates to `$122,150` → `Approve $122,150`.
   Teach-back: `All Nordhavn CP-2019 voyages`. Memory: `✦ NEW Nordhavn CP-2019: closures count once on demurrage · Active`.
   *"The Controller caught something in our own contract data. It learned that, scoped to this contract form."*

### Act 3 — Proof (3:50–5:00)
16. Money strip: `Billed $139,150 · We owe $122,150 · Recover $90,600 · Net −$31,550`. Click `We owe` → **Why?** (three sentences with NOR, AIS, cl. 7 and SOF chips).
17. `Journals` sheet: accrual → true-up → reversal → AP, plus the recovery: all balanced, each with authority.
18. Desk → **Proof**: scoreboard (24 voyages, exactness, ask precision, control violations 0), real vs simulated, `✓ audit chain verified`.
Close: *"It does the work of three seats, asks three people only when it must, learns what it was missing, and won't learn what it shouldn't."*

## If something goes wrong
- A model call fails → the step shows `Paused · Retry`. Keep both servers running and allow the current bounded attempt to finish. If necessary, reset to the baseline and restart; do not claim unfinished work completed.
- Map tiles fail → the coastline fallback renders automatically.
- Out of time → skip Act 3 steps 16–17 and go straight to Proof.

## Reset between runs
`⋯ → Reset demo` (≈ 2 s; restores the prepared baseline including Kestrel's pending ask, without re-running the agent: the baseline snapshot is stored after prepare). Confirm: Kestrel waiting · no Aster Vale · procedure absent · clock 24 Oct.

## Rehearsal evidence to record in progress.md
Deployed URL, commit SHA, prepare duration, three timed rehearsals, failures and fixes, screenshots U-01–U-10.

## Local handoff override — 25 Oct 2026
Run UI and Convex locally, using the existing prepared baseline. `workflow.md` is the authoritative operator handoff for startup/reset and the exact presentation flow. The presenter tests and rehearses the complete demo. No cloud deployment, full agent-run demo test, video or timed human rehearsals are required for V12 acceptance. Claude still calls the remote API, so internet remains necessary; local UI/database remove hosting round trips but do not remove provider latency.
