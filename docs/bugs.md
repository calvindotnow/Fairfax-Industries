# Bugs, known limitations & internal debt

The single bug log for Fairfax Industries. Log new bugs here as **Problem → Why → Fix idea**.
Most of the original audit has shipped; the items below are what genuinely remains as of
the first (beta) release. Features/roadmap live in [features.md](features.md).

Severity: 🔴 blocks a cohort · 🟠 major friction / trust · 🟡 polish / edge case

---

## Open

- 🟡 **Share codes can drift across patches** — codes reference items/heroes positionally, so a link made before a patch can resolve to the wrong item after the pool changes. VERSION 2 narrowed this, but it isn't fully patch-stable. *Fix idea:* encode a stable id (the API `class_name`) or warn on a version/patch mismatch. (`src/lib/build-code.ts`)

## Known engine approximations (documented, intentional)

Scope limits, not bugs — surfaced on `/methodology`. Tightening them is "deeper engine" work in [features.md](features.md).

- **Tier *behaviors* beyond stat deltas aren't simulated** — the ability-rank system applies every numeric tier upgrade (damage, range, duration, charges, cooldown — see Shipped), but tiers that add a *behavior* rather than a number are missed: e.g. Shiv's Slice and Dice "hits twice" at max is a mechanic, not a property delta, so it shows the per-hit number, not the doubled total.
- **Spirit-power scaling of range/duration isn't applied** — rank upgrades change range/duration with concrete deltas (handled), but the separate Spirit-Power scaling of those dimensions exposes only a scale *type* (`ETechRange`/`ETechDuration`), no coefficient, so it stays a "scales with Spirit" tag rather than a recomputed figure.
- **Imbue doesn't recompute the imbued ability** — it shows the relationship (which ability is imbued) but doesn't recompute that ability's numbers (including duration) yet.
- **%-of-health ability damage** (Vyper missing-health, current-health scalers) isn't shown as a flat number. (Item current-health damage — Tankbuster — *is* now shown, assuming the breakpoint is met, at the target's full health.)
- A few **stacking items** are recognized but display-only (spirit-damage amp like Escalating Exposure, heal-per-stack like Restorative Locket) — their slider shows, but the effect isn't in the damage number.

## Internal debt (no user impact)

Flagged by the pre-launch review; deliberately deferred to avoid launch-eve churn.

- **`ItemEffect` is a grab-bag union** — one interface with many optional fields (`stat`, `maxStacks`, `baseValue`, `spiritScale`, …) across 8 kinds. *Fix idea:* split into a discriminated union per kind so each shape is explicit. (`src/lib/sim/types.ts`)
- **Execute-threshold data rides in `deriveAbilityScaling`** — a "scaling" helper also returns execute info (co-located in the ability `properties` blob). *Fix idea:* a dedicated `abilityExecute()` accessor or a first-class column. (`src/lib/sim/engine.ts`)
- **Ability damage detection uses a css_class match + a `NON_DAMAGE` name blocklist** — pragmatic (the API has no clean damage flag and damage lives in ~90 property names), but the blocklist needs eyes when a patch adds new property names. (`scripts/sync-deadlock-api.ts`)

---

*Resolved (for reference): mobile/touch overflow, hover-only item stats, the "Proving Ground"
naming split, headshots-exceed-shots, silent copy-link no-op, missing data-freshness indicator,
no onboarding, no "show your work", missing hero/item pages, the proc/shotgun over-count, the
missing base-headshot multiplier, Burst-Fire double-count, fuller melee, item stacking,
**and the whole hosting story** — the runtime database is gone (data baked into the build), pages
are static where possible, and a scheduled Action keeps data fresh. See [features.md](features.md).*
