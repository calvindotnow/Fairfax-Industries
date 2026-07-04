# Spec 2a — Cost/phase-aware counters (design)

*Second sub-project of the "V2 transition" (after Spec 1 split `/hideout` into a Damage Calculator
and the `/lane` Lane Matchup Calculator). Spec 2a reworks the counter recommender so it stops
suggesting unaffordable tier-4 items and instead surfaces the best counters you can actually buy in
lane — using real purchase-timing data + value-per-soul ranking. Stays on the current single-enemy
`/lane` surface; the full multi-entity lane is Spec 2b.*

## Context

Lane Lab v1's recommender ranks counter candidates by raw sim duel-shift, so the "best" answer is
always the most expensive item — useless for laning, where the question is "best counter I can buy
*now*." Spec 1 moved this onto its own `/lane` surface (`src/components/lane-matchup.tsx` →
`CounterPanel`). Spec 2a fixes the ranking and adds the data it needs. (Roadmap "Revised direction",
`docs/research/2026-06-26-roadmap.md`.)

## Decisions (locked this session)

- **Value-per-soul ranking** — rank by sim duel-shift **÷ soul cost**, not raw duel-shift. Efficient
  cheap counters rise; marginal-value 6,400 items sink. (Side benefit: the level-from-cost distortion
  from v1 largely cancels, since the level bump scales with cost and we divide by cost.)
- **Lane vs. power-spike split by soul cost** *(revised from buy-time during implementation — the data
  showed `avg_buy_time_s` skews uniformly late and the counter pool skews tier-4, so buy-time can't
  form a lane group)*: affordable counters (`soulCost ≤ LANE_COST`) are "lane counters"; tier-4 are
  "power spikes to build toward." `avg_buy_time_s` is kept only as per-row context. Lane groups are
  often thin (the best counters genuinely are expensive) — accepted as honest; a future pool-fix can
  fatten them.
- **One grouped panel** replacing v1's separate "Top counters" + "Biggest lift": two groups, each row
  fusing cost + sim effect (TTK/EHP) + empirical winrate.
- **Stays on the single-enemy `/lane` surface.** No lanemate / 2nd enemy / auto-enemy (→ Spec 2b).

## Data layer

Re-sync `counter_item_stats` to carry purchase timing. The per-pair `item-stats` fetch already returns
`avg_buy_time_s` (and `avg_buy_time_relative`) per item — v1 projected it out; keep it.

- `scripts/sync-deadlock-api.ts`: in the per-pair projection, include `avg_buy_time_s` (rounded int).
  Also **bump the per-pair top-N from 12 → ~16** so both groups (early + late) have material after the
  phase split. Re-bake (`bun run db:reset`, ~8 min, regenerates `baked-data.json` + `lane-lab-data.json`
  together as before).
- `src/lib/lane-lab.ts`: `getCounterItems(youId, enemyId)` returns `{ itemId, winrate, matches, buyTimeS }[]`.
- `soulCost` is already on baked items (`getItems()`); no new field needed for cost.

## Ranking logic (`src/lib/counter.ts`, pure + tested)

New pure helpers (keep `duelAdvantage` as-is; add):
- `valuePerSoul(deltaA: number, soulCost: number): number` — `soulCost > 0 ? deltaA / soulCost : 0`.
- `splitByCost<T extends { soulCost: number }>(rows, laneCostMax?): { lane: T[]; powerSpike: T[] }`
  — `soulCost > 0 && soulCost <= laneCostMax` → lane; else power-spike. `LANE_COST = 4000` (tiers 1–3
  vs the tier-4 6,400; a single named, tunable constant).
- The CounterPanel composes: build candidates (existing `pickCandidates` over the empirical counters,
  excluding owned), sim each for `deltaA` + the offense/defense deltas (existing two-direction sim),
  attach `soulCost` (from items) + `buyTimeS` (from the accessor), then **rank the lane group by
  `valuePerSoul` desc** and the **power-spike group by raw `deltaA` desc** (lane = efficiency, power
  spikes = "strongest to aim for").

## UI (`src/components/counter-panel.tsx`)

Replace the single "Biggest lift" list with two labeled groups; keep the matchup header. Each row:
item name · `§<soulCost>` · the net glyph + sim effect (TTK/EHP, as today) · empirical `winrate%` · `[+ add]`.

```
Countering: Seven            you 47% in lane · Phantom+ · 19k

LANE COUNTERS  (best value you can buy in lane)
  Decay          §1250  ▲▲  TTK −0.9s · heal−   58%  [+]
  Toxic Bullets  §1250  ▲   heal −55%           56%  [+]
  Spirit Armor   §1700  ▲   EHP +610            56%  [+]
        ranked by value per soul · typically bought <9 min

POWER SPIKES  (build toward)
  Colossus       §6400  ▲▲▲ EHP +1,900          59%  [+]
  Witchmail      §6400  ▲▲  EHP +1,074          59%  [+]
        strongest counters · typically bought later
```

- Empty states: if the lane group is empty (all counters are late), show the power-spikes only with a
  note; if no counter data, the existing "not enough lane data."
- Disclosure updated: note the lane/power-spike split is by *typical buy time from match data*, value
  is *sim duel-shift per soul*, winrate is *vs baseline* — all honest, no prescription.

## Error / edge handling

- Missing `buyTimeS` on a row → power-spike group (don't guess it's a lane item).
- `soulCost` 0/missing → exclude from value-per-soul ranking (or sort last); guard divide-by-zero.
- Thin lane group is acceptable (data-driven); the top-N bump to ~16 mitigates it. If a matchup
  genuinely has no early counters, the lane group is empty (handled above).

## Testing

- Engine untouched (recommender only calls `simulate`). Pure logic unit-tested with `bun test`
  (`counter.test.ts`): `valuePerSoul` (incl. zero-cost guard), `splitByPhase` (boundary at
  `LANE_BUY_SECONDS`, null buy time → power-spike), and the lane/power-spike ranking order on
  constructed rows.
- Data accessor: extend `lane-lab.test.ts` for the new `buyTimeS` field.
- UI verified via `tsc` + `bun run build` + headless render of `/lane` (the two groups populate) +
  manual.

## Out of scope (→ Spec 2b)

Lanemate + synergy, second enemy, the multi-entity lane layout, auto-progressing average enemy builds,
and the full build-path/`item-flow-stats` data (Spec 2a uses only the per-item `avg_buy_time_s`, not
the flow graph).
