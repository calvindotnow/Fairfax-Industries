# Cost/Phase-Aware Counters (Spec 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the `/lane` counter recommender to rank by value-per-soul and split counters into "Lane Counters" (affordable, bought early) vs "Power Spikes" (build toward), using real purchase-timing data — so it stops always suggesting unaffordable tier-4 items.

**Architecture:** Add `avg_buy_time_s` to the baked `counter_item_stats` (+ bump top-N to 16); add pure ranking helpers (`valuePerSoul`, `splitByPhase`) to `src/lib/counter.ts`; rework `CounterPanel`'s recommender into two phase-grouped lists. Engine untouched.

**Tech Stack:** Next.js 16 / React 19, Bun (`bun test`, `bun run build`), the existing `simulate` engine + baked `lane-lab-data.json`.

## Global Constraints

- **No engine math changes** (`src/lib/sim/**` untouched — recommender only calls `simulate`); no share-code changes.
- **Static / no runtime DB** — timing data is baked at sync time.
- **"Proving Ground" must never appear.** Follow `docs/style.md`.
- **Honest numbers:** lane/power-spike split = *typical buy time from match data*; value = *sim duel-shift per soul*; winrate = *vs baseline*. No prescription claims.
- **Stays on the single-enemy `/lane` surface** — no lanemate / 2nd enemy / auto-enemy (that's Spec 2b).
- Tests: pure logic via `bun test`; UI via `tsc` + `bun run build` + headless render + manual. No component-test harness — don't add one.
- Lint: pre-existing errors only in `scripts/sync-deadlock-api.ts` — ignore; introduce none.
- Commits end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Spec: `docs/superpowers/specs/2026-06-27-cost-phase-aware-counters-design.md`. Data source: `docs/research/2026-06-26-deadlock-api-spike.md`.

---

## File Structure

- `scripts/sync-deadlock-api.ts` (**modify**) — per-pair `counter_item_stats` projection: add `avg_buy_time_s`, top-N 12→16.
- `src/lib/lane-lab-data.json` (**regenerate**) — counter_item rows gain `avg_buy_time_s`.
- `src/lib/lane-lab.ts` (**modify**) — `getCounterItems` returns `buyTimeS`.
- `src/lib/counter.ts` (**modify**) + `src/lib/counter.test.ts` — add `valuePerSoul`, `splitByPhase`, `LANE_BUY_SECONDS`.
- `src/lib/lane-lab.test.ts` (**modify**) — assert `buyTimeS`.
- `src/components/counter-panel.tsx` (**modify**) — two-group recommender.

---

## Task 1: Data — bake `avg_buy_time_s` into counter items

**Files:** Modify `scripts/sync-deadlock-api.ts`, `src/lib/lane-lab.ts`, `src/lib/lane-lab.test.ts`; regenerate `src/lib/lane-lab-data.json`.

**Interfaces:**
- Produces: `getCounterItems(youId, enemyId) → { itemId: number; winrate: number; matches: number; buyTimeS: number | null }[]` (sorted desc by winrate, as today).

- [ ] **Step 1: Sync — keep the timing field + bump top-N**

In `scripts/sync-deadlock-api.ts`, find the per-pair counter-item projection (currently maps each row to `{ item_id, wins, losses, matches }` and `.slice(0, TOP_N_COUNTER_ITEMS)`). Add `avg_buy_time_s: Math.round(r.avg_buy_time_s ?? 0) || null` to the projected object, and change `TOP_N_COUNTER_ITEMS` from `12` to `16`. (The `item-stats` rows already carry `avg_buy_time_s` — see the spike doc.) Leave everything else.

- [ ] **Step 2: Validate on a subset**

Run: `LANE_LAB_MAX_HEROES=4 bun run sync` then:
```
bun -e 'const ll=require("./src/lib/lane-lab-data.json");const h=Object.keys(ll.counter_item_stats)[0];const e=Object.keys(ll.counter_item_stats[h])[0];console.log("keys:",Object.keys(ll.counter_item_stats[h][e][0]),"top-N:",ll.counter_item_stats[h][e].length);'
```
Expected: keys include `avg_buy_time_s`; top-N up to 16. (The controller will run the full 38-hero re-bake before merge.)

- [ ] **Step 3: Accessor — expose `buyTimeS`**

In `src/lib/lane-lab.ts`, update the `counter_item_stats` row type to include `avg_buy_time_s?: number | null`, and in `getCounterItems` map each row to also return `buyTimeS: r.avg_buy_time_s ?? null`.

- [ ] **Step 4: Test the accessor field**

In `src/lib/lane-lab.test.ts` add: for an in-data pair, every returned counter item has a `buyTimeS` that is `null` or a positive number:
```ts
test("getCounterItems exposes buyTimeS", () => {
  const heroes = getHeroes();
  const rows = getCounterItems(heroes[0].id, heroes[1].id);
  for (const r of rows) expect(r.buyTimeS === null || r.buyTimeS > 0).toBe(true);
});
```
Run: `bun test src/lib/lane-lab.test.ts` → PASS. Then full `bun test` + `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add scripts/sync-deadlock-api.ts src/lib/lane-lab.ts src/lib/lane-lab.test.ts src/lib/lane-lab-data.json
git commit -m "Bake avg_buy_time_s into counter items (+ top-N 12->16)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Ranking logic — `valuePerSoul` + `splitByPhase` (TDD)

**Files:** Modify `src/lib/counter.ts`, `src/lib/counter.test.ts`.

**Interfaces:**
- Produces:
  - `LANE_COST = 4000` (counters ≤ this are "affordable/lane"; above = tier-4 power spikes).
  - `valuePerSoul(deltaA: number, soulCost: number): number` — `deltaA / soulCost`, `0` if `soulCost <= 0`.
  - `splitByCost<T extends { soulCost: number }>(rows: T[], laneCostMax?: number): { lane: T[]; powerSpike: T[] }` — `soulCost > 0 && soulCost <= laneCostMax` → lane; else powerSpike.

> **Design note (data-driven):** the counter pool skews to expensive late-game items, and `avg_buy_time_s` is uniformly late, so we split by **soul cost** (affordable vs tier-4), not buy-time. `buyTimeS` stays as per-row context only.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/counter.test.ts`:
```ts
import { valuePerSoul, splitByCost, LANE_COST } from "./counter";

test("valuePerSoul = deltaA/soulCost, guards zero cost", () => {
  expect(valuePerSoul(1.2, 1200)).toBeCloseTo(0.001);
  expect(valuePerSoul(1, 0)).toBe(0);
});
test("splitByCost: <=LANE_COST is lane (affordable), above is power-spike", () => {
  const rows = [
    { itemId: 1, soulCost: 1600 }, { itemId: 2, soulCost: 6400 },
    { itemId: 3, soulCost: LANE_COST }, { itemId: 4, soulCost: 3200 },
  ];
  const { lane, powerSpike } = splitByCost(rows);
  expect(lane.map(r => r.itemId)).toEqual([1, 3, 4]);
  expect(powerSpike.map(r => r.itemId)).toEqual([2]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/counter.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement**

Append to `src/lib/counter.ts`:
```ts
/** Counters at/under this soul cost are "affordable/lane" picks; above = tier-4 power spikes. Tunable. */
export const LANE_COST = 4000;

/** Counter value normalized by cost — efficient cheap picks beat marginal expensive ones. */
export function valuePerSoul(deltaA: number, soulCost: number): number {
  return soulCost > 0 ? deltaA / soulCost : 0;
}

/** Split candidate rows into lane (affordable) vs power-spike (expensive/tier-4). */
export function splitByCost<T extends { soulCost: number }>(
  rows: T[], laneCostMax: number = LANE_COST,
): { lane: T[]; powerSpike: T[] } {
  const lane: T[] = []; const powerSpike: T[] = [];
  for (const r of rows) (r.soulCost > 0 && r.soulCost <= laneCostMax ? lane : powerSpike).push(r);
  return { lane, powerSpike };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/lib/counter.test.ts` → PASS. Then full `bun test` + `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/counter.ts src/lib/counter.test.ts
git commit -m "Add valuePerSoul + splitByPhase counter helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: UI — two-group cost/phase-aware recommender

**Files:** Modify `src/components/counter-panel.tsx`.

**Interfaces:**
- Consumes: `getCounterItems(...).buyTimeS` (Task 1); `valuePerSoul`, `splitByPhase`, `LANE_BUY_SECONDS` (Task 2); `simulate`, `duelAdvantage`, `pickCandidates` (existing); item `soulCost` (from the `items` prop).

- [ ] **Step 1: Build the grouped rows**

In `counter-panel.tsx`, the existing `liftRows` `useMemo` already builds candidate rows with `deltaA`, `dTTK`, `dEHP` per item (two-direction sim). Extend each row to also carry `soulCost` (from the resolved `items.find(it => it.id === itemId)`) and `buyTimeS` (from the matching `counterItems` row's `buyTimeS`). Then:
- `const { lane, powerSpike } = splitByCost(rows);` (rows carry `soulCost`).
- Sort `lane` by `valuePerSoul(r.deltaA, r.soulCost)` desc; sort `powerSpike` by `r.deltaA` desc.
- `buyTimeS` is shown as per-row context only (e.g. "~22m"); it is NOT the split signal.
- Memo deps unchanged plus `counterItems` (already there for soulCost/buyTimeS).

- [ ] **Step 2: Render two groups**

Replace the single "Biggest lift" list with two labeled sections — **"Lane counters"** (the `lane` array) and **"Power spikes"** (the `powerSpike` array). Reuse the existing row markup (glyph + TTK + EHP + `[+ add]`) and **add `§{soulCost}`** to each row and the empirical `winrate%` (from the `counterItems` row). Group sub-captions: lane = "ranked by value per soul · typically bought <9 min"; power-spike = "strongest counters · typically bought later". Empty-state each group (if `lane` empty, show only power-spikes with a note; existing "not enough lane data" when there are no counters at all). This **replaces** the separate "Top counters" + "Biggest lift" sections — fold the empirical winrate into the new rows so there's one grouped list. Keep the matchup header.

- [ ] **Step 3: Update the disclosure**

Adjust the disclosure line to state: lane/power-spike split is by *typical buy time from match data*; the lane list ranks by *sim duel-shift per soul*; winrate is *vs baseline*. (Keep it honest, ~2 lines.)

- [ ] **Step 4: Verify**

`bunx tsc --noEmit` clean; `bun run build` clean; `bun test` green. Headless render of `LaneMatchup` (or `CounterPanel`) with a seeded in-data matchup (Abrams vs Dynamo, a few items each) — confirm the html contains **"Lane counters"** and **"Power spikes"** and at least one `§` cost. Manual `/lane`: the two groups show, lane items are cheaper/earlier, `[+ add]` works.

- [ ] **Step 5: Commit**
```bash
git add src/components/counter-panel.tsx
git commit -m "Rework counter recommender: Lane Counters + Power Spikes (value-per-soul)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** avg_buy_time_s data + top-N bump → T1; value-per-soul + phase split → T2; two-group panel + cost/winrate per row + disclosure → T3; honesty + single-enemy scope → Global Constraints + each verify. ✓

**Placeholder scan:** complete code for the pure helpers + accessor + tests; the UI task gives the exact composition (extend `liftRows`, split, sort, render two groups) referencing the existing row markup — appropriate altitude, no "handle edge cases". ✓

**Type consistency:** `getCounterItems` adds `buyTimeS: number | null` (T1) consumed by `splitByPhase<T extends { buyTimeS }>` (T2) and the panel (T3). `valuePerSoul(deltaA, soulCost)` / `splitByPhase` signatures match across T2 and T3. ✓

## Verification (whole feature)

`bun test` green (engine + new counter/lane-lab tests); `tsc` + `bun run build` clean; the committed `lane-lab-data.json` carries `avg_buy_time_s`; `/lane` renders **Lane counters** + **Power spikes** with costs + winrates, lane ranked by value-per-soul. Controller runs the full 38-hero re-bake before merge.
