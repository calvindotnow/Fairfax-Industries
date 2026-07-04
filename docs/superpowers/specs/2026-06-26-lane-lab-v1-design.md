# Lane Lab v1 — counter suggestion layer (design spec)

*From the roadmap (Feature 1) and the deadlock-api spike (`docs/research/2026-06-26-deadlock-api-spike.md`).
Designed in the 2026-06-26 brainstorming session. v1 is the **suggestion layer** on the existing
attacker-vs-one-enemy `/hideout` workbench — built **lane-ready** as the foundation of the full
multi-entity lane (roadmap "Option 2"), which follows as v1.x.*

## Context

The existing workbench already does attacker-vs-one-target with exact builds, breakpoints, TTK, and
EHP. The genuinely new, differentiated value is the **suggestion layer**: empirical "what beats this
enemy" + a sim-proven "what should I add" recommender. v1 adds that layer as a **4th overview tab
("Counter")** without touching the current layout. Everything is architected so v1.x lifts a cap to
become the full lane (lanemate + 2nd enemy + lane layout), with ~zero rework.

## Locked decisions (this session)

- **v1 = suggestion layer on the 1-enemy workbench, lane-ready.** Not a layout overhaul.
- **A 4th "Counter" overview tab**, next to Damage / Vitality / Spirit.
- **Recommender ranks by net two-sided duel shift**, showing offense + defense per row.
- **Empirical proposes, sim proves:** the recommender's candidate pool is the empirical counter items
  (bounded ~15), sim-ranked — not a brute force of all items.
- **Honest numbers:** real matchup winrate + sample size + rank bracket; real sim deltas; no fabricated
  post-pick winrate projection.
- **Curated data:** top-N counter items per `(hero, enemy)` pair in a separate `lane-lab-data.json`.

## Scope

**In v1:** the Counter tab (3 sections below), the `lane-lab-data.json` data layer + sync + accessors,
the recommender module, and the lane-ready seams.

**Out of v1** (→ v1.x / v2 / pro parking lot in `docs/research/2026-06-26-roadmap.md`): lanemate +
synergy chips, second enemy, the multi-entity lane layout, inline per-item chips, the auto-progressing
average enemy build (v2); the exhaustive brute-force recommender and the full per-pair dataset (pro).

---

## The Counter tab (3 stacked sections)

A new `CounterPanel` rendered when `overviewTab === "counter"` (mirrors `VitalityPanel`/`SpiritPanel`).

1. **Matchup header** — the empirical winrate for *your hero vs the enemy hero* from `counter_stats`,
   shown honestly: `"Seven beats Haze 53% in lane · 19,360 matches · Phantom+"`. Derived
   `winrate = wins / matches_played` (no `losses` field). If below the sample threshold or missing,
   show "not enough lane data for this matchup."
2. **Top counters (empirical)** — highest-winrate items *against this enemy hero* from
   `counter_item_stats[you][enemy]`, each row: item · `winrate · sample` · `[+ add]`. Excludes items
   you already own. Framed as winrate-vs-baseline, not a causal claim.
3. **Biggest lift (sim)** — the recommender output: candidate items ranked by net duel shift, each row
   showing its offense and defense effect (`+Decay · net ▲▲ · TTK −0.9s | EHP +120`). `[+ add]` applies it.

A per-tab **"how this is calculated"** disclosure (matching the existing methodology pattern) states the
data source, sample thresholds, rank bracket, and that the sim deltas come from the Fairfax engine.

## Recommender logic (`src/lib/counter.ts`, pure + tested)

- **Candidate pool:** the empirical counter items for `(you, enemy)` (top-N from `counter_item_stats`)
  plus a small fixed set of defensive staples, minus items already in your build. Bounded (~15).
- **Scoring — net two-sided duel shift.** Define duel advantage `A = theirTTKonYou / yourTTKonThem`
  (`> 1` ⇒ you win the race). For each candidate added to *your* build, recompute both sides via the
  existing engine:
  - `yourTTKonThem` = `simulate(you+item, enemy, opts).timeToKill` (more damage ⇒ ↓).
  - `theirTTKonYou` = `simulate(enemy, you+item, opts).timeToKill` (more EHP/resist ⇒ ↑).
  - `ΔA = A_with_item − A_base`; rank candidates by `ΔA` desc. Each row surfaces the **offense**
    component (`Δ yourTTK`) and the **defense** component (`Δ your EHP` / `Δ theirTTK`).
- **Bounded cost:** ~15 candidates × 2 sims = ~30 `simulate()` calls per recompute; memoize on
  `(yourBuild, enemyBuild, enemyHero, opts)` and debounce. (Engine is pure/fast; no worker needed at this
  size — the exhaustive pro mode that loops all ~150 items is the parking-lot future that gets a worker.)
- **Enemy build:** uses the *current* enemy loadout (base stats if you haven't kitted them out; v2's
  auto-average-enemy improves this). State this in the disclosure so the numbers are interpretable.
- The exact `net ▲/▲▲/·` bucketing of `ΔA` and the top-N / defensive-staples list are tuning knobs —
  see Open Questions.

## Data layer

A **separate `src/lib/lane-lab-data.json`** (keeps the main `baked-data.json` lean), synced from the
validated endpoints (`docs/research/2026-06-26-deadlock-api-spike.md`):

```jsonc
{
  "synced_at": "<iso>",
  "params": { "min_average_badge": <n>, "min_matches": <n>, "window": "<patch/date>" },
  "counter_stats":      [ { "hero_id", "enemy_hero_id", "wins", "matches_played" }, ... ], // 1,406 pairs
  "counter_item_stats": { "<hero_id>": { "<enemy_id>": [ { "item_id", "wins", "losses", "matches" }, ... top-N ] } },
  "item_stats":         { "<hero_id>": [ { "item_id", "wins", "losses", "matches" }, ... ] }, // fallback/context
  "synergy_stats":      [ { "hero_id1", "hero_id2", "wins", "matches_played" }, ... ]          // baked now, USED in v1.x
}
```

- **Curation:** `min_matches` 100 (counter), 200 (item), `same_lane_filter=true`; `counter_item_stats`
  = top-N items per pair (~370 KB gzip total — gives enemy-specific counters for every matchup).
- **Sync:** extend `scripts/sync-deadlock-api.ts` with ~4 analytics fetches (`hero-counter-stats`,
  `item-stats` with/without `enemy_hero_ids`, `hero-synergy-stats`) → write `lane-lab-data.json`. IDs
  already match our `/v1/assets/*` ids (spike-confirmed) — no mapping layer. The daily GitHub Action
  commits it on change. Public reads, no auth; grab a free API key for rate-limit headroom.
- **Accessors** in `src/lib/data.ts`: `getMatchup(youId, enemyId)`, `getCounterItems(youId, enemyId)`,
  `getItemStats(youId)` — returning typed, winrate-derived rows.

## Lane-ready seams (so v1.x is pure addition)

- Model the enemy as an **array capped at length 1** in v1 (the lane lifts the cap). The Counter panel
  and accessors take an enemy (→ enemies); the recommender is generic over the target.
- Keep the new state in a small **`useCounterLab` hook** (vs. swelling `hideout.tsx` further) — it owns
  the active enemy, the memoized accessor reads, and the recommender results.
- `synergy_stats` is baked in v1 but only *consumed* in v1.x (lanemate), so the data side is already done.

## Error / edge handling

- Missing/low-sample matchup → "not enough lane data" in each section (don't fabricate).
- Enemy hero with no counter-item rows → fall back to `item_stats` (hero-level "winning items") with a
  clear label that it's not enemy-specific.
- Owned items excluded from both the empirical list and the recommender candidates.
- `timeToKill` can be `null` (zero DPS) — guard the ratio; show "—" and rank such candidates last.
- Respect `MAX_LOADOUT`; `[+ add]` follows existing build rules (level derives from souls).

## Testing

- **Engine untouched** — the recommender only *calls* `simulate`. No `engine.ts` change.
- **Pure logic unit-tested with `bun test`** (`src/lib/counter.test.ts`): candidate selection (excludes
  owned, respects top-N), the net-duel scoring (`ΔA` sign/ordering on constructed sim results), and the
  data accessors (winrate derivation, fallback path). Use baked/fixture data like `resolve.test.ts`.
- **UI** (CounterPanel) verified via `tsc` + `bun run build` + manual on `/hideout` (no component
  harness — same as Phase 0).

## Files

- Create: `src/lib/counter.ts` (+ `counter.test.ts`) — candidate pool + net-duel scoring (pure).
- Create: `src/components/counter-panel.tsx` — the Counter tab UI.
- Create: `src/lib/lane-lab-data.json` — baked aggregates (committed by the sync Action).
- Modify: `scripts/sync-deadlock-api.ts` — analytics fetches + write the JSON.
- Modify: `src/lib/data.ts` — accessors over `lane-lab-data.json`.
- Modify: `src/components/hideout.tsx` — add the `"counter"` tab to `OverviewTabs` + render `CounterPanel`;
  introduce the `useCounterLab` hook + lane-ready enemy-array seam.

## Open questions (resolve at plan/build time)

- Net-duel `ΔA` → `▲/▲▲/·` bucket thresholds; candidate top-N size; the defensive-staples list.
- Default rank bracket (e.g. Phantom+ vs all) and patch/date window for the synced data.
- Bundle-size budget check once `counter_item_stats` is real (target ~370 KB gzip).
- Whether the matchup header's bracket/window is user-toggleable in v1 or fixed (lean: fixed in v1).
