# Spec 1 — Split `/hideout` into a Damage Calculator + a Lane Matchup Calculator (design)

*From the 2026-06-26 roadmap's "Revised direction" (`docs/research/2026-06-26-roadmap.md`). This is
the first of three sub-projects in the "V2 transition": **the surface split**. It's a foundational
refactor — it relocates the existing counter feature onto its own surface and extracts the shared
build-workbench core, with **no new user-facing behavior**. The cost/phase-aware counter rework and
the full lane model are Spec 2; positioning is Spec 3.*

## Context

`/hideout` is rendered by `src/components/hideout.tsx` — a ~1,500-line client monolith that holds the
entire build session (hero/target ids, loadouts, scenario, sim results) and renders the hero
selection, buy menu, the four overview lenses (Damage / Vitality / Spirit / **Counter**), compare
mode, and the progression scrubber, with ~15 helper components defined inline. The Lane Lab v1
"Counter" tab lives *inside* this monolith and uses its state.

The product direction is two focused surfaces: a **Damage Calculator** (pure theorycraft) and a
**Lane Matchup Calculator** (laning counters). Spec 1 makes that split real and clean.

## Decisions (locked this session)

- **Full extraction** of the shared build-workbench core into reusable units (not a `mode` prop, not
  a duplicate page). Both surfaces are thin consumers of the core.
- **Independent sessions per surface; transfer via the existing `?b=` share code** — no cross-route
  shared state.
- **Behavior-preserving:** `/hideout` must behave exactly as today **minus the Counter tab**. No
  engine (`src/lib/sim/`) or share-code (`src/lib/build-code.ts`) changes.
- **Out of scope (→ Spec 2):** lanemate, second enemy, the full lane layout, cost/phase-aware
  counters, a laning-specific scenario. Spec 1's lane page is the *relocated current counter
  feature*, and the base Spec 2 grows.

## Architecture

### Shared core

- **`src/lib/use-build.ts` — `useBuild(initial)` hook.** Owns the whole build session that currently
  lives in the `Hideout` function body: `heroId`, `targetId`, `loadoutA`/`loadoutB`/`targetLoadout`,
  `compareOn`/`compareView`/`activeBuild`, `buyingFor`, the build-modifier + scenario state
  (`matchTargetLevel`, `range`, `shots`/`shotsTouched`, `headshots`, `accuracy`, `headshotPct`,
  `hittingEnemy`, `resistDebuffs`, `activesFiring`, `stacksByItem`, `imbueAssign`, `abilityRanks`,
  `excludedActives`, `disabledAbilities`, `checkpoint`), the derived values (`hero`, `target`,
  `equipped*`, `resultA`/`resultB`/`result`, `hs`/`ts`, progression steps), and **all actions**
  (set heroes incl. the fire-rate `shotsTouched` reset, add/remove item for attacker/target, buy
  flow, the toggle/rank setters, `?b=` decode-on-init, encode + `history.replaceState` URL sync,
  share-url builder). Pure presentation/view state (`overviewTab`, `showCalc`, `showProgression`,
  `showOnboard`, `toast`, responsive `narrow`) stays in the surface components, not the hook.
  - Interface: returns a single object; surfaces destructure what they need. The hook is the only
    place build state is mutated, so the two surfaces can't drift in their build logic.

- **Shared presentation components extracted from the monolith into their own files:**
  - `src/components/versus-band.tsx` — **VersusBand** (the attacker/target portraits as
    `HeroPicker` triggers, per-side stat band, level strip, compare toggle, share button) plus the
    helpers it owns: `HeroPortrait`, `MiniStat`, `SideLabel`, `CompactLoadout`, `MatchLevelButton`,
    `ShareBuildButton`, `InfoDot`, `CompareToggle`. Props come from `useBuild`.
  - `src/components/progression-panel.tsx` — **ProgressionPanel** + `ReorderBtn`, `PreviewStat`.
  - Already separate, reused as-is: `BuyMenu`, `HeroPicker`, `CounterPanel`, `OnboardingTour`,
    `RollingNumber`, `SlotText`.
  - Damage-surface-only atoms (`OverviewTabs`, `VitalityPanel`, `SpiritPanel`, `ExecutePanel`,
    `StackChip`, `PercentSlider`, `ScenarioChip`, `BurstChip`, `NumberField`, `RankPips`, …) stay
    with the Damage Calculator — they are not shared.

### The two surfaces (thin consumers)

- **`src/components/damage-calculator.tsx`** (the refactored `Hideout`) — `useBuild()` + VersusBand +
  BuyMenu + the **Damage / Vitality / Spirit** lenses + scenario controls + ExecutePanel + ComparePanel
  + ProgressionPanel + onboarding. **The Counter tab/option is removed** (the `OverviewTabs` union drops
  `"counter"`; the dynamic `CounterPanel` import and its render branch move to the lane surface).
  Rendered by `src/app/hideout/page.tsx` (route unchanged).
- **`src/components/lane-matchup.tsx`** (new) — `useBuild()` + VersusBand + BuyMenu + **CounterPanel**
  as the primary content, + the transfer link. Spec 1 wires it with the same props the Counter tab
  passed (hero/enemy = attacker/target, the loadouts, `onAddItem`), using **default combat opts** for
  the recommender (no scenario controls yet — those, and the full lane, are Spec 2). Rendered by a new
  `src/app/lane/page.tsx` (mirrors `hideout/page.tsx`: server-decodes `?b=`, passes `initialBuild`).

## Routes / nav / transfer

- Keep **`/hideout`** (Damage Calculator) so existing `?b=` links and the `/b/<code>` "Open in New
  Build" link keep resolving. Add **`/lane`** (Lane Matchup Calculator).
- `src/components/navigation.tsx` links array: relabel the build entry and add the lane entry —
  proposing `{ "/hideout": "Damage Calc" }` + `{ "/lane": "Lane Matchup" }` (labels easily changed).
- **Transfer via `?b=`:** a small "Open in Lane Matchup →" link on the Damage Calculator and
  "Open in Damage Calc →" on the Lane page, each built from the current build's share code
  (`buildShareUrl` already exists). No cross-route state.

## Error / edge handling

- Behavior parity is the bar: every existing `/hideout` interaction (pick heroes, buy/sell, ranks,
  scenario toggles, compare, progression scrub, share, `?b=` load, the tour) must work identically
  after extraction. The Counter tab is the only intentional removal there.
- `/lane` reuses CounterPanel's existing empty/low-sample states ("not enough lane data").
- `?b=` codes are unchanged, so links shared before/after Spec 1 resolve on both surfaces.

## Testing / verification

- No component-test harness (consistent with prior phases). Verify via: `bunx tsc --noEmit`,
  `bun run build` (all routes incl. the new `/lane`), the existing `bun test` suite staying green
  (engine/util unaffected), **headless SSR render checks** of both `DamageCalculator` and
  `LaneMatchup` with real data, and a manual pass on both routes (incl. a `?b=` round-trip and a
  transfer link).
- A small unit test for the extracted `useBuild` is feasible if its actions are pulled into pure
  helpers; otherwise its correctness is covered by the render/build checks (note in the plan).

## Risk & sequencing (for the plan)

Refactoring a 1,500-line monolith is the riskiest change type here, so the implementation proceeds in
**small, independently-verifiable steps**, each keeping `/hideout` green:
1. Extract `useBuild`; rewire `Hideout` to consume it (no other change) → verify `/hideout` unchanged.
2. Extract `VersusBand` (+ helpers) and `ProgressionPanel` into files; rewire `Hideout` → verify.
3. Rename/trim `Hideout` → `DamageCalculator`; remove the Counter tab → verify `/hideout`.
4. Add `lane-matchup.tsx` + `/lane` route consuming the same core + CounterPanel → verify `/lane`.
5. Nav entries + transfer links → verify.

## Out of scope

The cost/phase-aware counter rework, the full lane model (lanemate + enemies), build-path/auto-enemy
data, and front-door positioning — all Spec 2 / Spec 3. No visual redesign of the Damage Calculator
beyond removing the Counter tab.
