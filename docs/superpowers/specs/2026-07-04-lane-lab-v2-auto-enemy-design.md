# Lane Lab v2 — auto-progressing average enemy builds (design spec)

*Track D1 of the 2026-07-04 open-upgrades dispatch (`docs/superpowers/plans/2026-07-04-open-upgrades-agent-handoff.md`).
Roadmap Feature 1 "v2 (fast-follow)". Depends on C0 (aggregates sync foundation) and shares its
build-path data shape with **Track C4** (build-path timeline overlay on the progression panel) —
the canonical shape below is designed **once, for both consumers**. Builds on the v1 precedent
(`2026-06-26-lane-lab-v1-design.md`) and the cost/phase counter rework
(`2026-06-27-cost-phase-aware-counters-design.md`). Data facts from
`docs/research/2026-06-26-deadlock-api-spike.md` plus a fresh 2026-07-04 API probe (below).*

## The feature

On `/lane`, the enemy laner currently holds a static / hand-built / suggestion-driven loadout.
v2: the enemy **auto-fills its average build path** — the aggregate purchase timeline distilled for
that hero — and **progresses as your souls climb**, driven by the existing soul-checkpoint
progression scrubber. As you scrub your build forward, the enemy fills out to the average items an
enemy of that hero would own at a comparable point in the game. The counter recommender and the
matchup numbers then resolve against a *realistic* enemy instead of a bare-stats dummy.

---

## Gating research — is the data there? (verdict: **NOT blocked**)

The open question that gates the whole feature (roadmap "Open questions": *"deadlock-api's
granularity/availability for per-soul build-path aggregation"*). Probed live 2026-07-04, unauth GETs,
`User-Agent: fairfax-industries-deadlock-sandbox` (matches the sync script). All HTTP 200.

### Endpoint: `GET /v1/analytics/item-flow-stats`

- **`hero_ids` (plural) is the working filter.** ⚠️ `hero_id` (singular, as written in the spike
  doc and the *existing counter-item sync*) is **silently ignored** on this endpoint — it returns
  global cross-hero data. Confirmed: `?hero_id=1` and `?hero_id=15` returned byte-identical payloads
  (`summary.matches = 4,086,486`, the global total); `?hero_ids=1` (144,946 matches) and
  `?hero_ids=15` (164,815 matches) differ correctly. **The sync MUST use `hero_ids`.**
- **Shape:** `{ nodes[], edges[], summary, baseline, reached_per_column }`.
  - `nodes[]`: `{ column, item_id, wins, losses, matches, players, avg_net_worth_at_buy, adjusted_win_rate, total_kills/deaths/assists }`.
  - `edges[]`: `{ from_column, from_item_id, to_item_id, wins, losses, matches }` — the *transition
    graph* (this is the bulk of the payload; **we discard it**).
- **Granularity — 4 columns (0–3), NOT a per-purchase timeline.** These are the API's four build
  *phases*. `avg_net_worth_at_buy` per node is the souls signal, and it is **monotone by column**
  (hero 1, badge 80+): col0 ≈ 4–10k, col1 ≈ 8–11k, col2 ≈ 18–27k, col3 ≈ 32–47k souls. Column 0 is
  noisy (a few late/rare items land there at low sample) — handled by de-duplication (below).
- **The critical usable fact:** `avg_net_worth_at_buy` is a **continuous souls value per item** —
  "average net worth at the moment this item was bought." That is *exactly* the anchor D1 and C4 need:
  it lets us place each item on a souls axis and answer "at soul count N, which items does the average
  enemy own?" — better than discrete buckets.

### The distillation works (proven on real hero-filtered data)

Per hero, take each `node`, de-duplicate items across columns by keeping the node with the **most
matches** (kills the col-0 noise), keep items above a pickrate floor, map each to
`souls = round(avg_net_worth_at_buy)`, sort ascending. Result for hero 1 (Infernus), pickrate ≥ 10%:
a clean **29-item souls-ordered timeline**:

```
souls   pickrate  winrate  item
 4097   0.109     0.478    84321454
 4527   0.309     0.478    4104549924
 7566   0.104     0.510    1672893796
 8333   0.279     0.496    3776945997
 8564   0.630     0.479    876563814     ← core, 63% pick
 9693   0.452     0.484    2951612397
 9897   0.651     0.481    1548066885    ← core, 65% pick
11383   0.795     0.487    7409189       ← near-universal, 80% pick
 …
```

**Verdict: the data genuinely supports the feature.** The canonical timeline is coarse on the phase
axis (4 phases) but the `avg_net_worth_at_buy` souls anchor is continuous and honest. This is a
"here's the average enemy's likely items by this soul count," presented as an empirical average — not
a fabricated exact per-purchase order. That framing matches the project's honesty bar.

### Alternatives considered & rejected

- **`item-stats?bucket=net_worth_by_1000`** — finer net-worth buckets (every 1000 souls), but the
  rows are *"item held at this net worth"* (ownership prevalence), **not** a purchase timeline; ~393 KB
  per hero per call. Rejected: wrong semantics for "when bought," and larger.
- **`avg_buy_time_s` from the CORE item-stats we already bake** — a single per-item *time* value, no
  souls, no phase. Kept only as optional per-row context (as in the cost/phase counter panel), not the
  timeline anchor. Souls, not seconds, is the correct axis (level/affordability derive from souls).
- **The `edges[]` transition graph** — a true per-purchase Markov path exists, but it's the 40k-edge
  bulk of a ~1.9 MB/hero payload (73 MB all-heroes, "infeasible full" per the spike). D1/C4 need
  *"what's owned by soul N,"* not the exact stochastic order — the node timeline answers that at a
  fraction of the size. Edges stay a parked pro feature (roadmap "Full empirical dataset — pro").

### Cost / citizenship

`item-flow-stats` is ~1.3–2.0 MB download **per hero** (edges dominate; we parse then discard them).
38 heroes = 38 calls, ~50–75 MB transient download, well under the 200 req/min unauth limit
(`ratelimit-limit: 200`, `ratelimit-period: 60`). Pace like the existing per-pair loop (~350 ms).
This adds **one fetch per hero** to the sync. Grab the free `DEADLOCK_API_KEY` for headroom (the sync
already threads it through).

---

## Canonical build-path data shape (designed once, for D1 **and** C4)

Both consumers need the same thing: *a per-hero, souls-ordered list of the average items owned, each
with the souls at which it's typically bought, plus pickrate & winrate for honest labeling.* One shape
serves both.

### TypeScript type (add to `src/lib/lane-lab.ts`'s local view type + export accessor types)

```ts
/** One item on a hero's average build path. `souls` = avg net worth at purchase (the timeline anchor). */
export interface BuildPathStep {
  itemId: number;   // DB item id (translated from the api item_id at sync time, like counter items)
  souls: number;    // round(avg_net_worth_at_buy) — the souls axis; ascending across the path
  pickrate: number; // matches / hero_total_matches — 0..1, how common this item is on this hero
  winrate: number;  // wins / matches for this node — honest, shown as context, never prescriptive
}

/** A hero's distilled average build path: steps ascending by `souls`. */
export type BuildPath = BuildPathStep[];
```

### Per-hero JSON payload (baked)

Extends the existing separate lazy JSON `src/lib/lane-lab-data.json` with one new keyed map
(mirrors `item_stats` / `counter_item_stats` structure — hero-keyed, DB ids):

```jsonc
{
  // …existing counter_stats, counter_item_stats, item_stats, params, synced_at…
  "build_paths": {
    "<db_hero_id>": [
      { "itemId": 512, "souls": 4527, "pickrate": 0.309, "winrate": 0.478 },
      { "itemId": 604, "souls": 8564, "pickrate": 0.630, "winrate": 0.479 },
      // …ascending by souls, curated (see thresholds)…
    ]
  }
}
```

### Curation thresholds (tunable constants in the sync)

- `BUILD_PATH_MIN_PICKRATE = 0.08` — keep only items ≥ 8% of that hero's matches (kills long-tail
  noise; leaves ~25–35 items/hero). *(Tuning knob — see Open Questions.)*
- De-dup across columns by **max matches** (the col-0 noise fix).
- `min_average_badge = 80`, `min_matches = 100`, 30-day window — **same params as the rest of
  lane-lab-data** (reuse the `LANE_LAB` constant) so all lane-lab data shares one bracket/window.
- Fields kept per step: `itemId, souls, pickrate, winrate` only (drop kills/deaths/assists/players).

### Expected size (measured, ×38)

From the real hero-1-filtered probe: pickrate ≥ 10% → 29 steps → **~1.4 KB raw / ~0.5 KB gzip** per
hero. At the ≥ 8% floor call it ~35 steps → ~1.7 KB raw/hero. **×38 heroes ≈ ~65 KB raw / ~22 KB
gzip.** Negligible.

### Delivery — extend `lane-lab-data.json` (do **not** add a new JSON)

`lane-lab-data.json` is today **~2.0 MB raw / ~330 KB gzip**, already lazy-loaded only into the
`/lane` chunk (via `src/lib/lane-lab.ts`). Adding ~22 KB gzip lands it at **~352 KB gzip** — inside the
v1 curated precedent (~370 KB gzip) and the bundle budget. C4's overlay and D1's auto-fill both live on
surfaces that already load this JSON (`/lane`; and `/hideout`'s progression panel can import the same
`lane-lab.ts` accessor — it's a small server-safe read). A separate JSON would mean a second lazy fetch
for no size benefit. **Decision: one field on the existing JSON.**

---

## UX behavior (D1 — the `/lane` auto-fill)

### What "at your soul count" means for the enemy — **mirror your souls** (decided)

The enemy fills to the average build path **up to the same souls you've spent at the current
progression checkpoint** (`previewResult.soulsSpent`, or the full-build souls when no checkpoint is
active). Rationale:

- A lane is roughly even-souls by construction (both laners farm the same wave/camps); mirroring is the
  honest default and the least surprising.
- It ties directly to the **existing scrubber** — as you scrub your timeline, `soulsSpent` at the
  checkpoint drives the enemy's fill. No new control.
- **No offset in v1.** An enemy-souls offset (±%) is a tempting knob but adds a control and a
  justification burden for little value; deferred (Open Questions). If added later it's a single
  multiplier on the mirror.

**Enemy items owned at soul count S** = every `BuildPathStep` with `souls ≤ S`, capped at `MAX_LOADOUT`
(12), taking the highest-pickrate steps if the cap is hit. Component-collapse rules from
`useBuild.addWithCollapse` apply so we never hold a part *and* its upgrade.

### Auto-fill vs suggestions mode / exact mode (the hard rule)

The v1/2a `/lane` surface has an implicit **exact mode**: the user can hand-build the enemy loadout
(`targetLoadout` via `buyingFor === "target"`). v2 adds **auto mode**. The invariant:

- **Exact-mode hand-built enemy loadouts must never be clobbered.** Auto-fill only ever writes to a
  *separate derived loadout*, never mutates `targetLoadout`. A per-lane **"Auto enemy build"** toggle
  (default **on** for a fresh lane) selects which the sim reads:
  - **Auto on** → the enemy loadout the sim/counter panel reads is the *derived* average path at the
    current soul count. The Buy menu's enemy column shows these as read-only "avg" chips.
  - **Auto off** → back to today's behavior: the enemy is exactly `targetLoadout` (empty or hand-built).
- **The moment the user manually edits the enemy** (adds/removes an enemy item, i.e. buys for target),
  auto flips **off** and their edit is preserved — a one-way "you took control" transition (with a
  toast: *"Switched to a custom enemy build"*). Turning auto back on restores the derived path and
  leaves their `targetLoadout` intact underneath (re-selectable). This guarantees **no silent
  clobber**.

### Empty / low-sample fallback

- Hero with **no `build_paths` entry** or a path that's empty after the pickrate floor → auto mode is
  unavailable for that enemy; the toggle is disabled with a tooltip *"No average build data for
  {hero}"*, and the enemy falls back to bare stats (today's default) or a hand-built loadout. No
  fabrication.
- Path shorter than the current soul count implies (all steps' `souls < S`) → enemy owns the whole
  path (capped at 12). Fine — that's just "the average enemy is fully built."

### How the user overrides

1. **Toggle auto off** — full manual control (exact mode).
2. **Edit any enemy item while auto is on** — auto flips off, edit preserved (above).
3. **Scrub the progression checkpoint** — changes the soul count → the auto enemy re-fills (this is the
   *intended* interaction, the headline of the feature).

---

## UX behavior (C4 — the progression-panel overlay)

C4 consumes the **same `BuildPath`** to overlay *your planned build vs the hero's average path* on
`src/components/progression-panel.tsx`, reusing the scrubber. This spec fixes the shared data shape and
the accessor; the C4 *visual* design is C4's to finalize, but the contract is:

- The panel already computes, per step, a `cumulative` souls value (`ProgressionPanel` rows). C4 reads
  `getBuildPath(heroId)` and, for the panel's hero, renders a faint "average" marker/track: at each of
  your steps' `cumulative` souls, what the average build owns by then (steps with `souls ≤ cumulative`),
  and a "your build is N items ahead/behind the average pace" read.
- Same honesty framing: "average path, {bracket}, {n} matches — an empirical average, not a
  prescription."
- C4 must **not** need any field D1 doesn't bake — the type above is the whole contract.

---

## Scope fences

- **1 enemy** (v1's cap) — do not lift it. The enemy stays an array-capped-at-1 (v1 seam). Auto-fill
  targets that single enemy. (Lifting the cap is Spec 2b / the lane build-out, not free here.)
- **NO combined-damage math** — the enemy is a normal 1v1 target; auto-fill only changes *which items*
  it holds. The sim stays strictly you-vs-one-enemy (roadmap parking lot: combined-damage 2v2 stays
  parked).
- **NO tracker surfaces** — no match feeds, no "who bought this," no per-match history. `build_paths` is
  an aggregate average, presented as such, in service of a build decision only.
- **Stays baked-static** — `build_paths` is baked into `lane-lab-data.json` by the daily sync; no
  runtime fetch, no DB. `edges[]` (the full flow graph) stays out.
- **Engine untouched** — auto-fill produces an enemy `ItemWithModifiers[]`; the recommender/panel call
  the existing `simulate`. No `src/lib/sim/**` change.

---

## Verification plan

**Distillation (sync-side, unit-tested):** extract the pure distillation into a testable helper
(`distillBuildPath(nodes, totalMatches, minPickrate)` → `BuildPathStep[]`) so it's covered without a
network call. Tests: de-dup keeps the max-matches node for a duplicated item id; pickrate floor drops
sub-threshold items; output is ascending by `souls`; empty input → `[]`.

**Accessor:** `getBuildPath(heroId)` returns `BuildPath` (ascending, typed); `buildPathAtSouls(heroId,
souls, maxItems)` returns the item ids owned at that soul count (≤ cap, highest-pickrate on overflow),
with component-collapse applied. Unit-test both with baked/fixture data (pattern: `lane-lab.test.ts`).

**Size budget:** a check that `lane-lab-data.json` gzips under the ~370 KB budget after the `build_paths`
field lands (measure post-bake; expected ~352 KB).

**UI checks (manual + headless render, no component harness — same as prior specs):**
- `/lane`: with auto on, the enemy shows average items; scrubbing your progression checkpoint changes
  the enemy's item set (more items at higher souls).
- Editing an enemy item flips auto off and preserves the edit (toast shows); re-enabling restores the
  average and keeps the manual loadout underneath.
- A hero with no build-path data disables the toggle with the tooltip (no crash, no fabrication).
- C4: the progression panel renders the average overlay from the same accessor.

**Engine parity:** `bun test` green; no baked-JSON diff except the new `build_paths` field; spot-check a
known matchup's numbers with auto **off** are byte-identical to pre-v2 (auto-off must be a no-op path).

---

## Files (for the plan; task→track mapping in the plan doc)

- **Modify** `scripts/sync-deadlock-api.ts` — fetch `item-flow-stats?hero_ids=<id>` per hero, distill,
  translate ids, write `build_paths` into `lane-lab-data.json`. *(Track C0.)*
- **Create** `src/lib/build-path.ts` (+ `build-path.test.ts`) — pure `distillBuildPath` + the souls-fill
  helper (kept pure/testable, imported by both the sync and the accessor). *(Track C0.)*
- **Modify** `src/lib/lane-lab.ts` (+ `lane-lab.test.ts`) — `getBuildPath` / `buildPathAtSouls`
  accessors + the `build_paths` view type. *(Track C0.)*
- **Regenerate** `src/lib/lane-lab-data.json` — gains `build_paths`. *(Track C0, full re-bake.)*
- **Modify** `src/lib/use-build.ts` — auto-enemy state (`autoEnemy` toggle, derived enemy loadout from
  `buildPathAtSouls` at the checkpoint souls, the one-way "manual edit → auto off" transition), exposed
  so `LaneMatchup`/`CounterPanel` read the derived enemy when auto is on. *(Track D1.)*
- **Modify** `src/components/lane-matchup.tsx` — the "Auto enemy build" toggle + wire the derived enemy
  into `CounterPanel` / the enemy Buy column. *(Track D1.)*
- **Modify** `src/components/progression-panel.tsx` — the average-path overlay. *(Track C4.)*

## Open questions (resolve at plan/build time)

- `BUILD_PATH_MIN_PICKRATE` floor (0.08 vs 0.10) and `MAX_LOADOUT`-overflow tiebreak (pickrate vs
  winrate).
- Whether the enemy-souls offset (mirror ±%) is worth a control in a later revision (lean: no, mirror).
- Exact souls source for the enemy fill: `previewResult.soulsSpent` at the active checkpoint vs the full
  build's souls when no checkpoint (lean: checkpoint souls if a checkpoint is set, else full-build souls).
- C4 overlay visual (marker vs faint track vs "N ahead/behind" text) — C4's call; data contract is fixed
  here.
