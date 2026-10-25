# Breakwater — local demo guide

This guide describes the intended local demo. This source snapshot is unvalidated and includes no prepared deployment or database. Provision this project independently before presentation. The UI and Convex run locally; Claude and Jev require internet, credentials and API credits.

## 0. First-time setup

When setup is requested, install Node 22.13+ and run `npm ci`. Configure a new local Convex deployment for this directory with `npx convex dev`; do not connect to another project's deployment. Its generated `.env.local` must point Next.js at this project's local backend.

Set `ANTHROPIC_API_KEY`, `BREAKWATER_AGENT=live` and `BREAKWATER_AGENT_MODEL=claude-sonnet-5-5` in that deployment. Jev requires either `TYPESAFE_API_KEY` with `BREAKWATER_JEV_TRANSPORT=typesafe`, or `OPENROUTER_API_KEY` with `BREAKWATER_JEV_TRANSPORT=openrouter`. Use interactive `npx convex env set NAME` commands for secrets. Configure local auth with `npm run auth:configure` as required by the setup script.

Import the world and documents, then prepare a baseline with the commands in §4. Preparation makes live calls. A Proof score requires an actual `npm run score:run`; no score is supplied as verification of this snapshot.

## 1. Start

**Terminal 1 — backend**

```sh
cd /Users/parthdua/Downloads/breakwater-submission
npx convex dev
```

Wait for **[Local] Port 3210** and **Convex functions ready**. Keep this project’s generated `.env.local` and local Convex data.

**Terminal 2 — frontend**

```sh
cd /Users/parthdua/Downloads/breakwater-submission
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Open **http://127.0.0.1:3000** in Chrome at 100% zoom, ideally 1440×900 or larger. No sign-in screen is needed. Build once after code changes; between judges, leave both servers running and reset the data.

## 2. Reset before every judge

1. Return to **Desk**. Choose **Ops** under **Acting as** so the menu appears.
2. Click **⋯ → Reset demo → Reset**.
3. Wait for the baseline rows, then choose **Observer**.

Check: **24 Oct 2026 · 00:00 · Idle**; Kestrel waiting on Ops; Halden Star recovery filed; **32 closed** cases; no Aster Vale case or active customs procedure. Desk KPIs start at **We owe $24,500 · Recoverable $27,000 · Net this Q +$27,000**.

Terminal alternative, with the backend running:

```sh
cd /Users/parthdua/Downloads/breakwater-submission
npx convex run demo:restore '{"label":"baseline","actor":"presenter:reset"}'
```

Then open the Desk URL and select Observer. This restores the saved business baseline without model calls. Audit history and the recorded Proof run remain. Use this reset between judges; preparation is only for recovery below.

## 3. Presentation flow

Opening line: **“Meridian charters ships and sells grain. Breakwater handles what we owe owners, what we recover from buyers, and the books.”**

| Do | Intended behavior / point to show |
|---|---|
| Desk: point to the waiting Ops question; click **Answer as Ops** on Kestrel. | A real evidence question is waiting; the center becomes the Ops desk. |
| Choose **Customs portal**, search **Kestrel**, open **Customs release 1004**, click **Link to hold**, choose **Confirm**, then **Submit**. | Actual PDF evidence verifies the hold; recovery becomes **$27,000 filed**. Submission returns you to Observer. |
| Switch back to **Ops**. Wait for **Next time?**, then choose **All ports**. | A new procedure appears in Memory; its historical backtest is **6/6**. |
| Switch to **Controller**, open Memory and expand the new procedure; click **Approve**. | Status becomes **Active**. The agent cannot grant itself access. Wait for Active before continuing. |
| Return to Desk and click **New disruption** once; open **Aster Vale**. | Watch the NOW feed, map and timeline populate from the running work. |
| Point to the red NOR pin and **24.0 nm**. | The readiness notice was outside port limits. Arrival corrects the start by **−$12,000**; shifting is excluded and local SOF times are converted correctly. |
| Point to **Used memory** and the verified inspection hold. | The learned procedure finds the release; **no Ops ask** is needed for Aster. |
| When asked, click **Answer as Trader → Partial**. Enter **File amount `90600`** and reason **`Goodwill: Hansa took a late Q3 cargo`**; Submit. | **$90,600** is filed; **$3,000** is waived. Memory keeps the waiver as **Not learned · commercial judgment**. The input is the amount to file, not the waiver. |
| When asked, click **Answer as Controller**. Change **port closure Half → Count**; choose **clause 8** and enter **`CP cl. 8 proviso: already on demurrage`**. Click **Save edit**, then **Approve $122,150**. | The reviewed amount updates before approval; AP and the dispute are posted under that approval. |
| Switch back to **Controller**. On **Next time?**, choose **All NORDHAVN-CP-2019 voyages**. | The corrected contract interpretation becomes **Active**, scoped to that charter form. |
| Show Aster’s money strip, click **We owe → Why?**, then open **Journals**. | Cited evidence explains the number; journals balance and show their authority. |
| Desk → **Proof → View voyages**, then **Verify now**. | The actual recorded 24-voyage run, its visible failures and an audit verification result. |

During this flow, answer the asks rather than using **Let time pass**; that control follows a different deadline path. Allow the NOW card to finish while provider calls are running. Lesson titles may vary slightly.

**Aster’s final figures:** billed **$139,150**; payable **$122,150 approved**; recovery **$90,600 filed**; dispute **$17,000**; waiver **$3,000**; net **−$31,550**. These are the case figures, not the company-wide KPIs.

Present the actual Proof result after a score run. Do not assume a fixed score or hide measured failures.

## 4. Recovery only

If reset reports **No snapshot “baseline”**, rebuild it once with both servers configured/running:

```sh
npm run world:import
npm run documents:import
npm run demo:prepare
```

This preparation makes live model calls and replaces demo work. It is not the normal reset. A baseline must be prepared in this project before using normal reset.

If dependencies are missing, run `npm ci` once before startup. Node **22.13+** is required. If the backend reports a missing provider key, set it interactively there with `npx convex env set ANTHROPIC_API_KEY`, then confirm `BREAKWATER_AGENT=live` and `BREAKWATER_AGENT_MODEL=claude-sonnet-5-5` in that local environment. Keep secret values out of files shared with judges.

If the UI cannot connect, check Terminal 1 first. If port 3000 is occupied, stop the previous frontend before starting another. Map tiles have a bundled coastline fallback; Claude calls still depend on the connection. For a paused provider failure, check connectivity/credits before resetting and starting again.

The complete presentation test and rehearsals are yours to run; this handoff does not claim a new full-demo run or a timed rehearsal.
