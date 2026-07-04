# Lane Lab v2 — Auto-Progressing Average Enemy Builds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. **Spec:** `docs/superpowers/specs/2026-07-04-lane-lab-v2-auto-enemy-design.md`.
> **Data facts:** `docs/research/2026-06-26-deadlock-api-spike.md` + the 2026-07-04 probe recorded in
> the spec.

**Goal:** On `/lane`, the single enemy laner auto-fills its **average build path** and progresses as
your souls climb (driven by the existing progression scrubber). Ships a shared per-hero build-path data
shape consumed by both D1 (this auto-fill) and C4 (progression-panel overlay).

**Architecture:** Bake a distilled per-hero `build_paths` timeline into the existing lazy
`lane-lab-data.json` (from `item-flow-stats`, nodes only, `avg_net_worth_at_buy` as the souls anchor);
pure distillation + fill helpers in a new `src/lib/build-path.ts`; accessors in `src/lib/lane-lab.ts`;
auto-enemy state in `src/lib/use-build.ts`; a toggle + wiring in `lane-matchup.tsx`. Engine untouched.

**Tech Stack:** Next.js 16 / React 19, Bun (`bun test`, `bun run build`), the existing `simulate`
engine + baked `lane-lab-data.json`.

## Global Constraints

- **No engine math changes** (`src/lib/sim/**` untouched — auto-fill only feeds items to `simulate`).
  No share-code changes.
- **Static / no runtime DB** — build-path data is baked at sync time; `edges[]` stay out.
- **1 enemy only** (v1 cap); **no combined-damage math**; **no tracker surfaces.** Re-read the spec's
  Scope fences.
- **Auto-off must be a byte-identical no-op** vs pre-v2 behavior (exact-mode loadouts never clobbered).
- **"Proving Ground" must never appear.** Follow `docs/style.md` (CSS-var tokens, inline-style pattern,
  `useIsNarrow`, no hardcoded hex).
- Tests: pure logic via `bun test`; UI via `tsc` + `bun run build` + headless render + manual. No
  component-test harness — don't add one.
- Lint: pre-existing errors only in `scripts/sync-deadlock-api.ts` — ignore; introduce none.
- Commits end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Track ownership (for the orchestrator — hand to different agents without overlap)

| Task | Track | Files (disjoint per track) |
|---|---|---|
| **T1** distillation helper + tests | **C0** | `src/lib/build-path.ts` (new) + test |
| **T2** sync bake `build_paths` | **C0** | `scripts/sync-deadlock-api.ts`, `src/lib/lane-lab-data.json` (regen) |
| **T3** accessors + tests | **C0** | `src/lib/lane-lab.ts`, `src/lib/lane-lab.test.ts` |
| **T4** auto-enemy state | **D1** | `src/lib/use-build.ts` |
| **T5** `/lane` toggle + wiring | **D1** | `src/components/lane-matchup.tsx` |
| **T6** progression overlay | **C4** | `src/components/progression-panel.tsx` |

**Sequencing:** T1 → T2 → T3 (C0, sequential; T3 depends on the baked field). T4 → T5 (D1, depend on
T3). T6 (C4) depends only on T3 and is parallel to T4/T5. C0 (T1–T3) is the shared gate; ship it first.

---

## File Structure

- `src/lib/build-path.ts` (**new**) + `build-path.test.ts` — pure `distillBuildPath` + `fillToSouls`.
- `scripts/sync-deadlock-api.ts` (**modify**) — per-hero `item-flow-stats?hero_ids=` fetch + distill +
  id-translate + write `build_paths`.
- `src/lib/lane-lab-data.json` (**regenerate**) — gains `build_paths`.
- `src/lib/lane-lab.ts` (**modify**) — `getBuildPath`, `buildPathAtSouls`, view type.
- `src/lib/lane-lab.test.ts` (**modify**) — accessor tests.
- `src/lib/use-build.ts` (**modify**) — `autoEnemy` toggle, derived enemy loadout, one-way manual-edit
  transition.
- `src/components/lane-matchup.tsx` (**modify**) — toggle UI + wire derived enemy.
- `src/components/progression-panel.tsx` (**modify**) — average-path overlay (C4).

---

## Task 1 (C0): Pure distillation + fill helpers (TDD)

**Files:** Create `src/lib/build-path.ts`, `src/lib/build-path.test.ts`.

**Interfaces (produces):**
```ts
export interface BuildPathStep { itemId: number; souls: number; pickrate: number; winrate: number; }
export type BuildPath = BuildPathStep[];

/** Raw item-flow node (only the fields we use). */
interface FlowNode { column: number; item_id: number; wins: number; matches: number; avg_net_worth_at_buy: number; }

/** Distill nodes → ascending-by-souls path. De-dup an item across columns by MAX matches; drop < minPickrate. */
export function distillBuildPath(nodes: FlowNode[], totalMatches: number, minPickrate: number): BuildPathStep[];

/** Items owned at `souls`: every step with souls<=cap-souls, highest-pickrate first, capped at maxItems. */
export function fillToSouls(path: BuildPath, souls: number, maxItems: number): number[]; // returns itemIds
```

- [ ] **Step 1: Write failing tests** (`build-path.test.ts`)
```ts
import { distillBuildPath, fillToSouls } from "./build-path";

test("distill de-dups an item across columns by max matches, keeps the winning node's souls", () => {
  const nodes = [
    { column: 0, item_id: 10, wins: 40, matches: 100, avg_net_worth_at_buy: 9000 }, // noisy col-0
    { column: 1, item_id: 10, wins: 300, matches: 600, avg_net_worth_at_buy: 8500 }, // real, more matches
    { column: 0, item_id: 20, wins: 30, matches: 300, avg_net_worth_at_buy: 4000 },
  ];
  const path = distillBuildPath(nodes, /*total*/ 1000, /*minPickrate*/ 0.08);
  // item 10 kept from col1 (600>100): souls 8500, pickrate .6, winrate .5; item 20: souls 4000, pick .3
  expect(path.map(s => s.itemId)).toEqual([20, 10]); // ascending by souls
  expect(path[1]).toMatchObject({ itemId: 10, souls: 8500 });
  expect(path[1].pickrate).toBeCloseTo(0.6);
  expect(path[1].winrate).toBeCloseTo(0.5);
});

test("distill drops items below the pickrate floor and handles empty", () => {
  const nodes = [{ column: 0, item_id: 99, wins: 5, matches: 50, avg_net_worth_at_buy: 4000 }]; // 5% pick
  expect(distillBuildPath(nodes, 1000, 0.08)).toEqual([]);
  expect(distillBuildPath([], 1000, 0.08)).toEqual([]);
});

test("fillToSouls returns owned items at a soul count, capped by pickrate", () => {
  const path = [
    { itemId: 1, souls: 4000, pickrate: 0.9, winrate: 0.5 },
    { itemId: 2, souls: 9000, pickrate: 0.6, winrate: 0.5 },
    { itemId: 3, souls: 9500, pickrate: 0.3, winrate: 0.5 },
  ];
  expect(fillToSouls(path, 9200, 12)).toEqual([1, 2]);        // 3 not yet reached
  expect(fillToSouls(path, 100000, 2)).toEqual([1, 2]);       // cap 2 → highest pickrate two
  expect(fillToSouls(path, 0, 12)).toEqual([]);
});
```

- [ ] **Step 2: Run to confirm failure** — `bun test src/lib/build-path.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** (`src/lib/build-path.ts`)
```ts
export interface BuildPathStep { itemId: number; souls: number; pickrate: number; winrate: number; }
export type BuildPath = BuildPathStep[];
interface FlowNode { column: number; item_id: number; wins: number; matches: number; avg_net_worth_at_buy: number; }

export function distillBuildPath(nodes: FlowNode[], totalMatches: number, minPickrate: number): BuildPathStep[] {
  const byItem = new Map<number, FlowNode>();
  for (const n of nodes) {
    const cur = byItem.get(n.item_id);
    if (!cur || n.matches > cur.matches) byItem.set(n.item_id, n); // de-dup by max matches (kills col-0 noise)
  }
  const total = totalMatches > 0 ? totalMatches : 1;
  return [...byItem.values()]
    .map((n) => ({ itemId: n.item_id, souls: Math.round(n.avg_net_worth_at_buy), pickrate: n.matches / total, winrate: n.matches > 0 ? n.wins / n.matches : 0 }))
    .filter((s) => s.pickrate >= minPickrate)
    .sort((a, b) => a.souls - b.souls);
}

export function fillToSouls(path: BuildPath, souls: number, maxItems: number): number[] {
  const owned = path.filter((s) => s.souls <= souls);
  if (owned.length <= maxItems) return owned.map((s) => s.itemId);
  // Over cap: keep the highest-pickrate `maxItems`, then restore souls order for stable display.
  const keep = new Set([...owned].sort((a, b) => b.pickrate - a.pickrate).slice(0, maxItems).map((s) => s.itemId));
  return owned.filter((s) => keep.has(s.itemId)).map((s) => s.itemId);
}
```

- [ ] **Step 4: Confirm pass** — `bun test src/lib/build-path.test.ts` → PASS. Then full `bun test` +
  `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/build-path.ts src/lib/build-path.test.ts
git commit -m "Add pure build-path distillation + soul-fill helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 (C0): Sync — bake `build_paths` from item-flow-stats

**Files:** Modify `scripts/sync-deadlock-api.ts`; regenerate `src/lib/lane-lab-data.json`.

**⚠️ Critical:** use **`hero_ids`** (plural) on `item-flow-stats` — `hero_id` (singular) is silently
ignored and returns global data (proven in the spec's probe). Fetch, then **discard `edges`** (they are
the bulk of the payload); keep only `nodes` + `summary.matches`.

- [ ] **Step 1: Add the constant + per-hero fetch/distill**

Near the other lane-lab constants (`TOP_N_COUNTER_ITEMS` etc.) add:
```ts
const BUILD_PATH_MIN_PICKRATE = 0.08; // keep items >= 8% of a hero's matches
```
Import the pure helper at the top: `import { distillBuildPath } from "../src/lib/build-path";`
(the sync already imports from `../src/lib/*`).

After the `counter_item_stats` loop (before the id-translation block), add a per-hero fetch reusing
`activeHeroIds` + `getJSON` + the `LANE_LAB` params + `since`:
```ts
// Per-hero average build path (item-flow-stats nodes only; edges discarded — they are the payload bulk).
// NOTE: hero_ids (plural) — hero_id (singular) is ignored by this endpoint (returns global data).
const build_paths: Record<number, { item_id: number; souls: number; pickrate: number; winrate: number }[]> = {};
for (const hid of activeHeroIds) {
  try {
    const flow: any = await getJSON(
      `${ANALYTICS_API}/item-flow-stats?hero_ids=${hid}&min_average_badge=${LANE_LAB.min_average_badge}&min_unix_timestamp=${since}&min_matches=${LANE_LAB.min_matches}`,
    );
    const steps = distillBuildPath(flow.nodes ?? [], flow.summary?.matches ?? 0, BUILD_PATH_MIN_PICKRATE);
    // keep api item_id here; translate to DB id in the translation block below
    build_paths[hid] = steps.map((s) => ({ item_id: s.itemId, souls: s.souls, pickrate: +s.pickrate.toFixed(3), winrate: +s.winrate.toFixed(3) }));
  } catch (e) {
    console.warn(`  [warn] skipping build-path for hero ${hid}: ${e}`);
  }
  await sleep(350);
}
```

- [ ] **Step 2: Translate ids (api → DB) alongside the others**

In the id-translation section, add (mirrors `translated_item_stats`, using the existing `xlHero` /
`xlItem`):
```ts
const translated_build_paths: Record<number, any[]> = {};
for (const [apiHeroKey, steps] of Object.entries(build_paths)) {
  const dbHeroId = xlHero(Number(apiHeroKey));
  if (dbHeroId == null) continue;
  const xl = (steps as any[])
    .map((s) => { const iid = xlItem(s.item_id); return iid != null ? { itemId: iid, souls: s.souls, pickrate: s.pickrate, winrate: s.winrate } : null; })
    .filter((s): s is NonNullable<typeof s> => s != null);
  if (xl.length > 0) translated_build_paths[dbHeroId] = xl;
}
```
Add `build_paths: translated_build_paths` to the `JSON.stringify({ … })` written to
`lane-lab-data.json`, and add a count to the closing `console.log`.

- [ ] **Step 3: Validate on a subset** (do not do a full re-bake in-loop; the controller runs the full
  38-hero bake before merge)
```bash
LANE_LAB_MAX_HEROES=3 bun run sync
bun -e 'const ll=require("./src/lib/lane-lab-data.json"); const h=Object.keys(ll.build_paths)[0]; console.log("heroes:",Object.keys(ll.build_paths).length,"sample keys:",Object.keys(ll.build_paths[h][0]),"steps:",ll.build_paths[h].length, "ascending:", ll.build_paths[h].every((s,i,a)=>i===0||s.souls>=a[i-1].souls));'
```
Expected: keys `itemId, souls, pickrate, winrate`; ascending by souls; ~25–35 steps/hero.

- [ ] **Step 4: Size budget check** (after the full re-bake — the controller's step, but verify the
  math locally on the subset)
```bash
gzip -c src/lib/lane-lab-data.json | wc -c   # expect < 370000 (~352 KB after full bake)
```

- [ ] **Step 5: Commit** (subset bake now; controller re-bakes all 38 before merge)
```bash
git add scripts/sync-deadlock-api.ts src/lib/lane-lab-data.json
git commit -m "Bake per-hero average build_paths (item-flow-stats nodes)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 (C0): Accessors + tests

**Files:** Modify `src/lib/lane-lab.ts`, `src/lib/lane-lab.test.ts`.

**Interfaces (produces):**
```ts
export function getBuildPath(heroId: number): BuildPath;                          // ascending by souls, [] if none
export function buildPathAtSouls(heroId: number, souls: number, maxItems?: number): number[]; // owned itemIds
```

- [ ] **Step 1: Extend the view type + import the helper**

In `src/lib/lane-lab.ts`, add to the `ll` cast type:
```ts
build_paths?: Record<string, { itemId: number; souls: number; pickrate: number; winrate: number }[]>;
```
Import: `import { fillToSouls, type BuildPath } from "./build-path";`

- [ ] **Step 2: Implement accessors**
```ts
export function getBuildPath(heroId: number): BuildPath {
  return (ll.build_paths?.[heroId] ?? []) as BuildPath; // already ascending + typed at bake time
}
export function buildPathAtSouls(heroId: number, souls: number, maxItems = 12): number[] {
  return fillToSouls(getBuildPath(heroId), souls, maxItems);
}
```

- [ ] **Step 3: Tests** (`src/lib/lane-lab.test.ts`) — use in-data heroes (pattern: existing tests)
```ts
import { getBuildPath, buildPathAtSouls } from "./lane-lab";

test("getBuildPath is ascending by souls with valid fields", () => {
  const heroes = getHeroes();
  const hid = heroes.find((h) => getBuildPath(h.id).length > 0)?.id ?? heroes[0].id;
  const path = getBuildPath(hid);
  for (let i = 1; i < path.length; i++) expect(path[i].souls).toBeGreaterThanOrEqual(path[i - 1].souls);
  for (const s of path) { expect(s.pickrate).toBeGreaterThan(0); expect(s.winrate).toBeGreaterThanOrEqual(0); }
});

test("buildPathAtSouls grows monotonically and respects the cap", () => {
  const heroes = getHeroes();
  const hid = heroes.find((h) => getBuildPath(h.id).length > 2)?.id ?? heroes[0].id;
  expect(buildPathAtSouls(hid, 0).length).toBe(0);
  const mid = buildPathAtSouls(hid, 12000).length;
  const late = buildPathAtSouls(hid, 60000).length;
  expect(late).toBeGreaterThanOrEqual(mid);
  expect(buildPathAtSouls(hid, 60000, 5).length).toBeLessThanOrEqual(5);
});
```

- [ ] **Step 4: Verify** — `bun test src/lib/lane-lab.test.ts` → PASS; full `bun test` + `bunx tsc
  --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/lane-lab.ts src/lib/lane-lab.test.ts
git commit -m "Add getBuildPath / buildPathAtSouls accessors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 (D1): Auto-enemy state in `use-build`

**Files:** Modify `src/lib/use-build.ts`.

**Interfaces (produces, added to the hook's return):**
`autoEnemy: boolean`, `setAutoEnemy`, `autoEnemyAvailable: boolean`, `autoEnemyLoadout: number[]`,
`autoEnemyEquipped: ItemWithModifiers[]` — and the *effective* enemy the sim reads switches on
`autoEnemy`.

**Design (from the spec):** mirror **your souls at the active progression checkpoint** (else full-build
souls); derive the enemy loadout via `buildPathAtSouls`; **never mutate `targetLoadout`**; a manual
enemy edit flips `autoEnemy` off (one-way) with a toast.

- [ ] **Step 1: State + derived loadout**

Import: `import { buildPathAtSouls, getBuildPath } from "@/lib/lane-lab";`
Add state near `checkpoint`:
```ts
const [autoEnemy, setAutoEnemy] = useState(true); // default on for a fresh lane
```
Derive availability + the fill souls + the derived enemy items (place after `previewResult`/`target`
are defined so `soulsSpent` is available):
```ts
const autoEnemyAvailable = useMemo(() => target != null && getBuildPath(target.id).length > 0, [target]);
// Mirror your souls: checkpoint preview souls if scrubbing, else your full-build souls.
const yourSouls = (checkpoint != null ? previewResult?.soulsSpent : result?.soulsSpent) ?? 0;
const autoEnemyLoadout = useMemo(
  () => (autoEnemy && target ? buildPathAtSouls(target.id, yourSouls, MAX_LOADOUT) : []),
  [autoEnemy, target, yourSouls]
);
const autoEnemyEquipped = useMemo(
  () => autoEnemyLoadout.map((id) => items.find((i) => i.id === id)!).filter(Boolean),
  [autoEnemyLoadout, items]
);
```

- [ ] **Step 2: Effective enemy the sim/counter read**

The enemy loadout the whole `/lane` surface reads becomes: `autoEnemy && autoEnemyAvailable` →
`autoEnemyEquipped`, else `targetEquipped` (today's). Introduce a single derived value and route the
CounterPanel / VS band enemy through it (keep the raw `targetEquipped` for exact mode underneath):
```ts
const effectiveEnemyEquipped = autoEnemy && autoEnemyAvailable ? autoEnemyEquipped : targetEquipped;
```
Return `effectiveEnemyEquipped` and wire it in Task 5. (Auto **off** ⇒ `effectiveEnemyEquipped ===
targetEquipped` ⇒ **byte-identical no-op** vs pre-v2 — satisfies the constraint.)

- [ ] **Step 3: One-way manual-edit transition**

Wrap the target add/remove so a manual enemy edit turns auto off and keeps the edit. `addTargetItem` /
`removeTargetItem` already write `targetLoadout`; before they mutate, if `autoEnemy` is on, flip it off
and seed `targetLoadout` from the current derived enemy so the user keeps what was showing:
```ts
const takeEnemyControl = () => {
  if (!autoEnemy) return;
  setTargetLoadout(autoEnemyLoadout.slice(0, MAX_LOADOUT)); // keep what was on screen
  setAutoEnemy(false);
  showToast("Switched to a custom enemy build");
};
// in addTargetItem/removeTargetItem: call takeEnemyControl() first, then apply the edit to targetLoadout.
```
Turning `autoEnemy` back on restores the derived path; `targetLoadout` is left intact underneath
(re-selectable when auto is off again). Reset `autoEnemy = true` when the enemy hero changes (add
`setAutoEnemy(true)` to the existing hero-change effect that keys on `targetId`, or add one).

- [ ] **Step 4: Export** the new values in the hook's return object.

- [ ] **Step 5: Verify** — `bunx tsc --noEmit` clean; `bun test` green (no test change needed here; the
  logic is exercised via the accessors' tests + Task 5's render check). Commit:
```bash
git add src/lib/use-build.ts
git commit -m "Auto-enemy: derive average enemy loadout at your soul count

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5 (D1): `/lane` toggle + wiring

**Files:** Modify `src/components/lane-matchup.tsx`.

- [ ] **Step 1: Route the enemy through the effective loadout**

Change the `CounterPanel` `enemyItems` prop and the VS band's enemy items from `build.targetEquipped`
to `build.effectiveEnemyEquipped`. (The Buy menu's enemy column, when `buyingFor === "target"`, still
edits `targetLoadout` via `build.activeAdd` — untouched; editing triggers the Task-4 transition.)

- [ ] **Step 2: Add the "Auto enemy build" toggle**

Near the "Open in Damage Calc →" row, add a toggle following `docs/style.md` (a `<button>` with
`aria-pressed={build.autoEnemy}`, brass-tinted when on, CSS-var tokens only). Disabled with a tooltip
when `!build.autoEnemyAvailable` (title `No average build data for {enemy.name}`). Label copy:
`Auto enemy build` + a small sub-hint `fills the average {enemy} build as your souls climb`.

- [ ] **Step 3: Surface the average state**

When auto is on, show a one-line note above the enemy Buy column / CounterPanel:
`Enemy: average {enemy.name} build at §{yourSouls} — scrub your build to advance it. Edit to take
control.` (Use `build.fmt`.) Keep it token-styled, muted.

- [ ] **Step 4: Verify**

`bunx tsc --noEmit` clean; `bun run build` clean; `bun test` green. Headless render of `LaneMatchup`
with an in-data enemy hero: assert the html contains `Auto enemy build`. Manual `/lane`:
- auto on → enemy shows average items; scrubbing the progression checkpoint changes the enemy set
  (more items at higher souls);
- editing an enemy item flips auto off, keeps the edit, shows the toast; toggling auto back on restores
  the average;
- an enemy hero with no build-path disables the toggle with the tooltip.

- [ ] **Step 5: Commit**
```bash
git add src/components/lane-matchup.tsx
git commit -m "Wire auto-enemy toggle + average enemy into /lane

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6 (C4): Progression-panel average-path overlay

**Files:** Modify `src/components/progression-panel.tsx`. **Depends on:** T3 only. Parallel to T4/T5.

> **Scope note:** this task belongs to **Track C4** (build-path timeline overlay). It is included here
> because it consumes the *same* `BuildPath` shape D1 defines — the orchestrator may hand it to the C4
> agent. The *visual* is C4's to finalize; the data contract is fixed by T1–T3.

- [ ] **Step 1: Read the average path**

Add optional props so the panel can overlay without hard-coupling: `buildPath?: BuildPath` (the panel's
hero's path, passed by the parent via `getBuildPath(heroId)`). The panel already computes per-row
`cumulative` souls.

- [ ] **Step 2: Render the overlay**

For each of your rows (at its `cumulative` souls), compute `avgOwned = buildPath.filter(s => s.souls <=
cumulative).length` and show a faint "avg N items by here" marker, plus a header read "your build vs the
average {bracket} path." Token-styled, muted; no new hue that stands alone (style.md §9). Empty
`buildPath` → render nothing extra (graceful no-op).

- [ ] **Step 3: Honesty line**

Add a one-line disclosure: `Average path from Deadlock match data ({bracket}) — an empirical average,
not a prescription.`

- [ ] **Step 4: Verify** — `bunx tsc --noEmit`, `bun run build`, `bun test` green; headless render with
  a `buildPath` prop shows the overlay text; with `buildPath={[]}` (or omitted) the panel is unchanged.

- [ ] **Step 5: Commit**
```bash
git add src/components/progression-panel.tsx
git commit -m "Overlay average build path on the progression panel (C4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** distillation + fill helpers → T1; `item-flow-stats` bake (hero_ids, nodes-only,
`avg_net_worth_at_buy` anchor, pickrate floor, id-translate, extend `lane-lab-data.json`) → T2;
accessors → T3; mirror-souls auto-fill + one-way "manual edit → auto off" (no clobber) + availability
fallback → T4; toggle + wiring + auto-off no-op → T5; shared-shape C4 overlay → T6. Scope fences
(1 enemy, no combined-damage, no tracker, baked-static, engine untouched) → Global Constraints + each
verify. ✓

**Placeholder scan:** complete code for the pure helpers + accessors + sync bake + state derivation;
UI tasks give exact prop swaps + toggle spec at the right altitude (no "handle edge cases"). ✓

**Type consistency:** `BuildPathStep{itemId,souls,pickrate,winrate}` defined in T1, baked in T2,
returned by `getBuildPath` in T3, consumed by `buildPathAtSouls`→`fillToSouls` (T1) in T4 and by the
C4 overlay in T6. `hero_ids` (plural) fix called out explicitly in T2. ✓

## Verification (whole feature)

`bun test` green (new `build-path` + `lane-lab` build-path tests + existing engine suite); `tsc` +
`bun run build` clean; committed `lane-lab-data.json` carries `build_paths` and gzips < 370 KB;
`/lane` auto enemy fills the average build and advances with the progression scrubber; manual enemy
edits preserve (auto flips off, toast); auto-off is byte-identical to pre-v2; the C4 progression overlay
renders from the shared accessor. Controller runs the full 38-hero re-bake before merge. On ship, flip
`docs/features.md` (Lane Lab v2 → Shipped), close/convert the matching `docs/bugs.md` item, and — since
`/methodology` scope is unchanged (no engine change) — no methodology edit is required.
