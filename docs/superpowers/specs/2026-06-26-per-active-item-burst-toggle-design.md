# Per-active-item burst toggle — design

**Date:** 2026-06-26
**Status:** Approved, pending implementation

## Problem

The `/hideout` burst calculator has a single global **"Actives firing"** switch. It flips on *all* equipped active items at once — both their on-cast **self-buffs** (e.g. Blood Tribute's fire rate) and their on-cast **direct damage** (e.g. Arctic Blast, Cold Front, folded in as combo steps).

A player running several damage-dealing actives can't model a realistic combo where they press *some but not all* of them in one burst window. They want per-item control over which actives' direct damage lands in the burst, the same way the **Stacks** line gives per-item control over stacking items.

## Approved model

**Global gate + per-item refinement.** The "Actives firing" switch stays as the master gate; a per-item chip line refines *which* damage actives count while the gate is on.

### Behavior

- A new **"Actives"** chip line appears in the scenario area, directly mirroring the existing **"Stacks"** line. It shows **only when "Actives firing" is ON and ≥1 damage-dealing active item is equipped**.
- Each equipped damage active gets **one chip** (item name) toggling its direct damage in/out of the burst.
- All chips **default to included**. Flipping the gate on reproduces today's burst number exactly; the player clicks to *exclude* the actives they didn't press in that combo. (Mirrors how Stacks default to max — zero behavior change until a chip is touched.)
- The **master gate keeps governing self-buffs wholesale** — fire-rate and other on-cast self-buffs remain all-or-nothing under "Actives firing". Only *direct damage* gets per-item refinement.
- When the gate is **OFF**, the line is hidden and no active damage counts (unchanged from today).

### Out of scope / unaffected

- **`alwaysOn` passive charge-up damage** (Tankbuster: +flat plus % of target health, ignores resist) is **not** gated by "Actives firing" and gets **no chip** — it isn't an active you press. It stays always-on, exactly as today.
- The **Spirit panel's "Item spirit damage"** listing is **unchanged**. It lists active-item spirit damage at the current Spirit as a *build property*, independent of which actives are fired in the burst combo. (Its tooltip already notes the damage counts toward burst only while "Actives firing" is on.)
- Self-buffs are not split per-item.

## Implementation

### Engine — `src/lib/sim/engine.ts`, `src/lib/sim/types.ts`

1. **Thread item identity onto effects.** Effects currently carry only `itemName` after flattening (`engine.ts` ~L448–449). Attach the item id when flattening so the burst can exclude by id:
   ```ts
   const effects = itemEffects.flatMap((x) => x.effects.map((e) => ({ ...e, itemId: x.it.id })));
   ```
   Add an optional `itemId?: number` to the `ItemEffect` type.
2. **New option.** `SimOptions.excludedActiveItemIds?: number[]` — item ids whose active *direct damage* is excluded from the burst even while "Actives firing" is on. Default: none.
3. **Burst filter** (`computeBurst`, ~L422) changes from:
   ```ts
   effects.filter((e) => e.kind === "activeDamage" && (opts.activesFiring || e.alwaysOn))
   ```
   to (with `const excluded = new Set(opts.excludedActiveItemIds)`):
   ```ts
   effects.filter((e) => e.kind === "activeDamage"
       && (e.alwaysOn || (opts.activesFiring && !excluded.has(e.itemId))))
   ```
   `alwaysOn` items are unaffected by exclusion; self-buff and spirit-panel logic untouched.

### UI — `src/components/hideout.tsx`

1. **State:** `const [excludedActives, setExcludedActives] = useState<Set<number>>(new Set())` — empty means all included.
2. **Derive damage actives** with a memo mirroring `stackingItems` (~L245): equipped items whose parsed effects include a `kind === "activeDamage"` effect that is **not** `alwaysOn`.
3. **Render** an "Actives" chip line as its own row in the scenario block, immediately after the Stacks line (same `flex-wrap` chip-row styling, an uppercase "Actives" label), shown only when `activesFiring && damageActives.length > 0`. Each chip reuses the binary on/off `ScenarioChip` look (label = item name, `on` = not excluded). Toggling adds/removes the item id in `excludedActives`.
4. **Thread through both sims:** add `excludedActiveItemIds: [...excludedActives]` to the `opts` passed into `simAttacker`, and include `excludedActives` in `sharedSim` so A/B memos recompute.
5. **Tooltip:** update the "Actives firing" tip to mention that individual damage actives can be toggled in/out below when the gate is on.
6. A stale excluded id for an unequipped item is harmless (the chip simply isn't rendered); no reset needed on hero/loadout change.

### Tests — `src/lib/sim/engine.test.ts`

- With two damage actives equipped + `activesFiring`, excluding one drops `burst.total` by that item's contribution; excluding both equals the gate-off total.
- An `alwaysOn` item (Tankbuster) is unaffected by `excludedActiveItemIds`.

### Docs

- `docs/features.md`: short note on the per-item active-damage toggle under the build workbench.
- `docs/bugs.md`: trim the matching scope-limit line now that active damage is per-item controllable.

## Success criteria

- Flipping "Actives firing" on with no chips touched yields the identical burst number to today.
- Excluding a damage active removes exactly its direct-damage contribution from the burst, in both A and B builds.
- Tankbuster-style always-on damage and all self-buffs behave exactly as before.
- Engine tests above pass; `tsc --noEmit` clean.
