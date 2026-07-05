# Bugs, known limitations & internal debt

The single bug log for Fairfax Industries. Log new bugs here as **Problem → Why → Fix idea**.
Most of the original audit has shipped; the items below are what genuinely remains as of
the first (beta) release. Features/roadmap live in [features.md](features.md).

Severity: 🔴 blocks a cohort · 🟠 major friction / trust · 🟡 polish / edge case

---

## Open

*(No open bugs — log new ones here as Problem → Why → Fix idea.)*

## Known engine approximations (documented, intentional)

Scope limits, not bugs — surfaced on `/methodology`. Tightening them is "deeper engine" work in [features.md](features.md).

- **Tier *behaviors* beyond stat deltas** — *infrastructure added 2026-07-04, table intentionally empty.* A curated override table (`src/lib/sim/tier-behaviors.ts`) now lets a verified (hero, ability, rank-threshold) → behavior (starting with a `damageMult`) apply in the ability damage path via `tierBehaviorFor`. **The table ships empty on purpose:** the canonical candidate — *Shiv's Slice and Dice "hits twice"* — was checked against deadlock.wiki **and** the API tier data (2026-07-04) and does NOT double at max rank. Its Tier 3 is "+50 Impact Damage / cooldown-reduction-on-hit"; the echo/second strike is a **Rage (ultimate-unlock) mechanic**, not a rank threshold. Encoding a ×2 would fabricate a behavior the current patch lacks, so nothing is encoded. The mechanism is proven by tests; add entries only as genuine rank-threshold mechanics are verified per patch.
- **Spirit-power scaling of range/duration isn't applied** — *researched & closed as a documented approximation 2026-07-04.* Rank upgrades change range/duration with concrete deltas (handled), but the separate Spirit-Power scaling of those dimensions is **not recoverable from the data**: the ability `scale_function` blob carries only `class_name`/`subclass_name` + the scale *type* (`ETechRange`/`ETechDuration`) — **no coefficient**; the hero's `starting_stats.tech_range`/`tech_duration` are base multipliers of **1.0** (0% bonus at 0 Spirit), not per-Spirit rates. deadlock.wiki confirms range/duration *do* scale via a per-ability coefficient, but it's only visible via the in-game Alt-hover and isn't published in the API or the community wikis. So this stays a "scales with Spirit" **tag** (`rangeScalesWithSpirit`/`durationScalesWithSpirit`), never a recomputed figure — no coefficient was fabricated. If deadlock-api ever exposes the coefficient, wire it into `deriveAbilityScaling`.
- ~~**Imbue doesn't recompute the imbued ability**~~ — **modeled 2026-07-04.** The imbue item's magnitude now recomputes the **assigned** ability's numbers: `imbuedSpiritPower` (Surge of Power +28, Frostbite Charm +70) is added to that ability's Spirit-Power coefficient term (damage + DoT rate), and `imbuedDurationPct` (Duration Extender +22%, Superior Duration +28%, imbued-ability +25%) extends its duration and DoT lifetime. Applied to the assigned ability only; other abilities are untouched. The sync bakes both magnitudes onto the `imbue` effect; the engine consumes `SimOptions.imbueAssign` (imbue item id → ability id). **UI follow-up (owned by the components agent):** `use-build.ts` must pass its existing `imbueAssign` map into the sim options — the engine reads it but `use-build.ts`'s `counterOpts`/`simAttacker` don't forward it yet.
- **%-of-health ability damage** — *partly modeled 2026-07-04.* Abilities with a **single-percentage** current- or missing-health rider now compute at the target's **full health** (same convention as Tankbuster): current-health scalers show `pct%` of max (Victor Jumpstart 15%, Silver Slam Fire 2.5%), and missing-health scalers correctly show **0** at full HP (Mina Rake 6% — nothing is missing). The sync bakes a `healthScaling` descriptor into the ability `properties`; the engine adds it through the ability's own resist/amp channel (`abilityHealthScaling`). *Assumption:* the rider is mitigated by the target's matching resist (not ignore-resist). **Still approximate:** ramp-style abilities with min/max health thresholds — **Vyper's Lethal Venom** (min at 100% HP → max at 30% HP) — are *not* recomputed; the baked base damage is the ramp's **max** (30%-HP) figure, so it over-states damage at full health. Encoding the linear ramp is a follow-up.
- ~~A few **stacking items** are recognized but display-only~~ — **modeled 2026-07-04.** Escalating Exposure's per-stack Spirit Amp (`MagicIncreasePerStack` = 4.5%/stack ×12 → +54% max) now multiplies every spirit-typed number as a *target-takes-more-spirit-damage* amp (distinct from Spirit Power), surfaced on `SimResult.spiritAmpMult`. Restorative Locket's `HealPerStack` (16/stack ×25 → 400 max) is a pure-sustain readout on `SimResult.sustain.heal` — no damage component, so it never touches a damage number. *(Both effects are emitted by the sync parser and take effect on the next data sync; the engine models them today. UI follow-up: surface `spiritAmpMult` on the Spirit lens and `sustain.heal` on the Vitality lens — owned by the components agent.)*

## Internal debt (no user impact)

Flagged by the pre-launch review; deliberately deferred to avoid launch-eve churn.

- **Ability damage detection uses a css_class match + a `NON_DAMAGE` name blocklist** — pragmatic (the API has no clean damage flag and damage lives in ~90 property names), but the blocklist needs eyes when a patch adds new property names. (`scripts/sync-deadlock-api.ts`)

---

*Resolved (for reference): **the `ItemEffect` grab-bag + execute-data debt** (closed 2026-07-04 —
`ItemEffect` is now a discriminated union of 9 per-kind interfaces, each carrying only its own
fields, all consumers narrowing on `kind`; execute-threshold data moved off `deriveAbilityScaling`
into a dedicated `abilityExecute(ability)` accessor with locking tests — behavior- and
data-preserving), **share-code patch drift** (closed 2026-07-04 — VERSION 3 codes embed a
2-byte FNV-1a fingerprint of the sorted item-name pool; `decodeBuildMeta` in `src/lib/build-code.ts`
exposes a `poolMismatch` flag and `/b/<code>`, `/hideout`, `/lane` render an "older patch" notice;
V1/V2 legacy codes still decode, treated as unknown-provenance and never flagged),
mobile/touch overflow, hover-only item stats, the "Proving Ground"
naming split, headshots-exceed-shots, silent copy-link no-op, missing data-freshness indicator,
no onboarding, no "show your work", missing hero/item pages, the proc/shotgun over-count, the
missing base-headshot multiplier, Burst-Fire double-count, fuller melee, item stacking,
**and the whole hosting story** — the runtime database is gone (data baked into the build), pages
are static where possible, and a scheduled Action keeps data fresh. See [features.md](features.md).*
