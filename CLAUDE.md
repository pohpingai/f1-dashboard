# F1 Post-Race Dashboard — Build Brief

## What this is

A free, static F1 dashboard that updates ~3 hours after each session. It serves two audiences equally: the owner (a podcaster/content creator mining talking points) and casual fans browsing on their phones. The editorial voice is catchy and opinionated, never dry — every module leads with a story, not a table.

**The owner of this project has zero coding knowledge and is using this project to learn.** See "How to work with the owner" at the bottom — it is as important as the technical spec.

## Hard rules (never violate)

1. **$0/month running cost.** Free hosting, free data sources, free compute only. No paid APIs, no servers, no databases.
2. **No LLM calls anywhere in the pipeline or site.** All text on the site is either computed from data (deterministic) or hand-written by the owner. This is a deliberate anti-hallucination decision.
3. **No client-side API calls.** The browser only ever loads pre-computed static JSON files. All fetching and math happens in GitHub Actions.
4. **No news scraping or republishing third-party content.** The Drama Log (computed from official data) is the news.
5. **Mobile-first.** Most visitors arrive on phones. Every view must work at 375px width before desktop is considered.
6. **Honest labels.** Example: pit data from OpenF1 is pit-lane transit time (~20s), NOT crew stationary time (~2.3s). Label it "total pit lane time" — never imply it's the stationary stop.

## Architecture

- **Static site** (plain HTML/CSS/JS or a lightweight static framework — keep it simple, no heavy SPA framework unless justified) hosted on **GitHub Pages**.
- **GitHub Actions** does all data work:
  - `schedule` (cron) trigger: runs **every 4 hours, every day** (`0 */4 * * *`), publishing a race ~4h after its real UTC start (≈2h after the flag). It must run daily, not weekend-only: a late/delayed race can turn eligible after midnight UTC, and GitHub sometimes skips scheduled runs, so a weekend-only cron silently missed races (this delayed the Belgian GP by days until it was fixed). Eligibility is keyed off the race's actual UTC start time + a 4h buffer in `update_data.py` — not a whole-day buffer, which never hit the "~3 hours" target. Free on public repos (unlimited Actions minutes).
  - `workflow_dispatch` trigger: manual "Run workflow" button so the owner can refresh from their phone via the GitHub app or mobile browser. Both triggers must exist.
  - The workflow runs a **Python** pipeline that fetches raw data, computes everything, and writes one JSON file per race, then commits and redeploys the site.
- **Data layout:** `data/2026/round-01.json`, `round-02.json`, … plus a small `data/index.json` (season manifest: rounds, names, dates, which rounds have data). The site's race selector reads the manifest.
- **Backfill:** a one-time script loops over all completed 2026 rounds and generates their JSON files, so the site launches with the full season browsable.
- **Editor's take:** each race JSON has an optional `editors_take` string field. The owner edits it by hand (guide them: editing one file on github.com in the browser is fine). If empty, the site hides the section — no placeholder text ever.

## Data sources (corrected — do not deviate without checking)

| Need | Source | Notes |
|---|---|---|
| Race results, grid positions, points | **Jolpica-F1 API** (Ergast successor, free) | Primary results source |
| Championship standings (drivers + constructors) | **Jolpica-F1** `/driverstandings`, `/constructorstandings` | OpenF1 does NOT have cumulative standings — do not try |
| DNF reasons (mechanical vs collision) | **Jolpica-F1** results `status` field | e.g. "Engine", "Collision", "Gearbox" |
| Lap-by-lap timestamps, lap times | **OpenF1** `/v1/laps` | Free for historical data (our 3-hour delay qualifies). See the live-lock caveat below. |
| Pit lane entries/durations | **OpenF1** `/v1/pit` | This is pit-LANE duration, not stationary time — label honestly |
| Session schedule, track names | **OpenF1** `/v1/sessions` or Jolpica schedule | |
| Telemetry (v2 only) | **FastF1** Python library inside the Action | It's a library, not an API — needs the Action's compute. Cache aggressively, downsample before writing JSON |

Be polite to free APIs: cache raw responses in the workflow, retry gently, never hammer.

**OpenF1 live-lock caveat (discovered in Milestone 3):** OpenF1's free tier locks the *entire* API — including historical data — whenever a session is live on track, returning HTTP 401 ("Live F1 session in progress") to push heavy users onto a paid key. Jolpica-F1 is unaffected. Our ~3-hours-after-a-session timing sidesteps this in normal operation, but two consequences: (1) if you tap "Run workflow" while a session is actually running, the timing modules (Gap Trace, Rejoin Strip) are skipped for that race and you re-run later — results/standings still populate fine; (2) the pipeline treats this as a soft failure by design, writing the race JSON with the timing blocks marked unavailable rather than erroring.

## Milestones

### Milestone 1 — Skeleton (do first, ship before anything else)
- Repo structure, GitHub Pages deployment working, Actions workflow with both triggers.
- Pipeline fetches one race and writes valid JSON.
- Landing page renders from JSON: winner hero, standings split, drama log (DNF list with lap + reason), schedule with next-race countdown, session times shown in **both local track time and Malaysia time (MYT, Asia/Kuala_Lumpur)** using `Intl.DateTimeFormat` or Luxon.
- Race selector browsing all backfilled 2026 rounds.
- Acceptance: owner taps "Run workflow" on their phone → site updates without touching a laptop. Site is readable and pleasant at 375px and on a laptop.

### Milestone 2 — Heroes & Zeroes (v1.0 complete)
- Ranked strip (not a scatter plot): biggest climbers and biggest fallers, computed as grid − finish.
- Context flags: how many gained places came "free" from cars ahead retiring (cross-reference the DNF log). A gain of 8 with 5 DNFs ahead is a different story than 8 on-track passes — say so in the generated headline.
- Each entry gets an auto-generated one-line take from a template (deterministic, no LLM), e.g. "P14 → P6, but 5 of those places were gifts from retirements."
- Acceptance: for any past 2026 race, the module names a Hero and a Zero with an honest one-liner.

### Milestone 3 — Rejoin Strip + Gap Trace (v1.1; they share `/v1/laps` data)
- **Rejoin Strip:** for each pit stop, determine from *actual* post-pit lap data (not projections — we have hindsight) who the driver rejoined behind/ahead of and the real gaps. Flag: rival 0–2s ahead at rejoin → "Dirty air"; rival 0–1.5s behind → "Rejoin clash"; otherwise "Clean air". Render as a per-driver timeline with colored flags.
- **Gap Trace:** two dropdowns to pick any two drivers, plus a **Pace/Gap view toggle** (defaults to Pace):
  - *Gap view* plots the cumulative time gap between them lap by lap, with pit laps annotated — makes undercuts and tyre fade visually obvious.
  - *Pace view* plots each driver's per-lap lap time as a line in team colours, with a ribbon between them tinted per-lap by whoever leads on track. Lap times are derived client-side as the first difference of the cumulative crossing times already in the JSON — no re-fetch. **Outlier handling (honest labels):** pit in/out-laps and safety-car/yellow laps (>1.08× a driver's median green pace) are dropped so a few 100s+ laps don't squash the ~90s scale, and the caption states how many were removed. This is *raw* lap-time comparison, NOT the fuel-corrected tyre-degradation model (that stays in v2 — do not conflate them, and never present raw pace as a degradation cliff).
  - Both views have a hover (desktop) / tap (mobile) tooltip showing the lap and exact values.
- Acceptance: pick any documented undercut from 2026 and the Gap view visibly shows the gap flip on the pit laps; the Pace view shows a readable green-flag scale with SC/pit laps removed; the Rejoin Strip flags match what actually happened on track.

### v2 backlog (do NOT build yet; architecture must not preclude them)
- Telemetry micro-sector overlay (two drivers' speed/brake/throttle aligned by track distance; FastF1; heavy — downsample).
- Tyre degradation curves: fuel-corrected lap times (~0.03–0.06 s/lap fuel effect), regression slope fitted on the stable phase only, cliff flagged separately (e.g. 3 consecutive laps >0.4s above trend). Exclude SC/VSC/in/out laps. A straight regression line cannot show a cliff — never present it as if it does.
- Teammate head-to-head (quali gap, race pace gap, strategy comparison).
- Strategy Gantt (tyre stints per driver, from OpenF1 `/v1/stints`).
- Optional AI hook generator — only with numbers-only prompts and owner review before publish. Not now.

## Design direction

- Dark, broadcast-graphics feel: near-black background, high-contrast light text, big numbers.
- Team colors carry meaning (hero card accent bar = winning team's color, driver entries tinted by team).
- One loud accent color for the site's own identity; otherwise restrained.
- Card-based layout stacking vertically on mobile; landing page teases each deep-dive module as a tappable card with a one-line hook.
- **Progressive disclosure everywhere:** headline take first, chart and numbers on tap/expand.
- Site name: placeholder "Pit Wall MY" — owner may rename.
- Content first: keep styling minimal until modules work, then a dedicated design pass.

## Non-goals

- Live/real-time timing (would cost money and complexity; 3-hour delay is the product).
- User accounts, comments, or any backend state.
- Covering seasons before 2026 (data structure shouldn't prevent it, but don't build it).
- Native mobile app — responsive web only.

## How to work with the owner (read carefully)

- The owner has **zero coding experience** and wants to **learn while building**. For every step: explain what you're doing in plain language AND name the technical term (e.g. "I'm creating a workflow file — this is the 'CI/CD pipeline', the instructions the cloud robot follows").
- Work in **small steps**. One thing at a time, confirm it works, then move on. After each milestone step, tell the owner exactly how to verify it themselves (what URL to open, what they should see).
- Before running commands that change things outside the repo folder or install software, say what it does and why.
- Prefer boring, well-documented tools over clever ones. The owner will maintain this.
- Commit often with plain-English commit messages, so the history doubles as a learning log.
- When something fails, explain the error in plain language before fixing it.
- Never add paid services, API keys with costs, or LLM calls — see Hard rules.
