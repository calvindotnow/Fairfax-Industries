# Fairfax Industries — what we built, why, and where it's going

The single feature/roadmap doc for **Fairfax Industries**, a community Deadlock
theorycrafting tool. The build workbench lives at **`/hideout`** (the "New Build"
nav button). The damage math is a portable, tested engine at `src/lib/sim/`; UI
conventions are in [style.md](style.md); known issues + internal debt in
[bugs.md](bugs.md). Current as of the first (beta) release.

Legend: 🔴 critical · 🟠 high · 🟡 nice-to-have

---

## What this is, and why

The north star is **"Path of Building for Deadlock"** — a rigorous workbench where
you assemble a hero + items and read *exactly* what the build does, against any
enemy, on the current patch. Three goals drove every decision:

1. **Trustworthy numbers.** The target audience is hardcore theorycrafters who will
   stress-test against the in-game range. Accuracy — and *visibly* showing the
   scope/assumptions — is the moat. Hence the methodology page, per-result
   "how this is calculated" disclosures, and an engine that models the real
   mechanics (conditionals, stacking, crit, resists, execute thresholds).
2. **Approachable for everyone.** Casual players should not bounce off a dense
   calculator. Hence the onboarding tour, inline glossary tooltips, the
   three-lens (Damage / Vitality / Spirit) views, and sensible defaults.
3. **Shareable.** Theorycrafting happens in Discord. Hence stateless build links
   and crawlable build pages.

The engine is deliberately decoupled from React and the database so it stays a
clean, portable, test-covered module.

---

## Shipped

### The build workbench (`/hideout`)
- **Attacker-vs-target model** — pick an attacker and a target, kit out both, read the matchup live. The core, confirmed model (not an A/B-of-your-own-builds tool by default).
- **Three overview lenses** — a tab switcher on the results panel: **Damage** (burst, sustained DPS, time-to-kill, the burst breakdown + abilities), **Vitality** (effective HP vs weapons/spirit, health, regen, resists incl. melee, stamina, movement), **Spirit** (spirit power + total ability output + per-ability damage). Different builds optimize different stats; each audience gets its view.
- **Ability ranks** — click the tier pips by each ability to train it up (ranks 0–3); the rank's upgrades apply to damage, range, duration, charges and cooldown, and the burst updates live. Each pip's tooltip names what that tier changes. Profiles are precomputed by the sync from the API's per-ability `upgrades` array.
- **Combat-scenario row** — toggles that drive conditional item effects: close/long range, hitting an enemy (activated fire-rate tiers), resist debuffs applied, actives firing — plus per-item **stacks** chips, per-item **actives** chips (toggle each damage-dealing active's on-cast damage in/out of the burst once "Actives firing" is on), and **accuracy / headshot-rate** sliders that scale sustained DPS.
- **Execute / assassinate window** — for heroes with a %-HP execute or low-health bonus (Venator, Shiv, Vindicta, Drifter, …), an enemy HP bar marks the threshold and tells you whether your burst from full health crosses it ("kill secured" / "N more HP").
- **A/B build comparison** — lock build A and edit a second build B side by side; green/red reads from the build you're editing. Additive to attacker-vs-target.
- **Build progression** — a build is an ordered purchase timeline; scrub to a level checkpoint to preview the partial build (level derived from cumulative souls).
- **Onboarding** — a multi-step spotlight tour anchored to real UI; seeds a demo build so panels are live. Replay link in the footer.
- **Reactive motion** — micro-interactions that make the live calculator feel responsive: stat numbers (burst total, readouts) pop on change, the overview/build tabs slide to the active one, and the share button's copy label rolls per-character. Pure-CSS and reduced-motion-aware; details in [style.md §8](style.md#8-motion).

### The damage engine (`src/lib/sim/`)
- Weapon DPS with falloff + per-pellet folding; abilities (direct + DoT) with Spirit-power scaling; on-hit procs (in both burst **and** sustained, gated by real cooldowns); headshots with the base 1.65× crit multiplier + flat bonuses, reduced by the target's crit-damage-taken.
- Conditionals: range-bound weapon power (Close Quarters / Sharpshooter), Burst-Fire dual-rate (10% → 32% on hit), enemy resist debuffs (Crippling Headshot, Bullet Resist Shredder).
- Item mechanics: **stacking** (Berserker/Glass Cannon and the broader pool, weapon/fire-rate/health/sprint, with display-only fallback for unmodeled stats), **active self-buffs** ("Actives firing", e.g. Blood Tribute / Vampiric Burst fire rate), **imbue** (assign an imbue item to one ability, shown with a ⟡), upgrade-path collapse, asymptotic stat stacking, investment bonuses.
- Fuller melee (melee-damage items + 50% weapon scaling + a dedicated melee-resist channel); accuracy- and headshot-rate-scaled sustained DPS.

### Reference pages
- **Hero pages** — `/heroes` roster + `/heroes/<slug>` detail with a conditional ability stat table (range / cooldown / duration / charges / charge-delay / damage / scaling), slug URLs.
- **Item browser** — `/items`, searchable by name **and** description, with proc spirit-scaling shown in tooltips.
- **Methodology** — `/methodology` + per-result "how this is calculated" disclosures.
- **Patch notes** — `/patch-notes` diffs the two most recent stat snapshots; a "Data synced · <date>" badge in the footer.
- **Shareable builds** — stateless `?b=` codes (VERSION 3: a 2-byte pool fingerprint detects patch drift and `/b`, `/hideout`, `/lane` warn on stale links; V1/V2 still decode) and crawlable `/b/<code>` pages with metadata, plus a **dynamic Open Graph image** (hero-vs-hero + headline numbers, hard-cached) so build links unfurl in Discord (`src/app/b/[code]/opengraph-image.tsx`).
- **Two-axis item ranking** — "What people build" on `/items`: most-picked vs highest-winrate (top 10, global aggregates with explicit not-hero-specific provenance and per-row sample sizes). (`src/app/items/item-rankings.tsx`)
- **Ability-order win rates** — "Which skill order wins" on `/heroes/<slug>`: top level-up orders as icon sequences with winrate + matches. (`src/app/heroes/[slug]/ability-orders.tsx`)
- **Patch impact on *your* build** — `/patch-notes?b=<code>` shows exactly which of the build's inputs the patch changed (old→new, per side), with an explicit no-fabricated-numbers disclosure (snapshots are too thin for an honest re-sim); linked from `/hideout` and `/b/<code>`. (`src/lib/build-patch-impact.ts`)

### Lane Lab v2
- **Auto-progressing average enemy** — on `/lane`, the enemy auto-fills its empirical build path (from `item-flow-stats` `avg_net_worth_at_buy`) at your mirrored soul count and advances with the progression scrubber; any manual enemy edit takes control one-way; auto-off is byte-identical to hand-built mode; heroes without data show a disabled toggle, never fabricated items.
- **Planned-vs-average overlay** — the progression panel overlays the aggregate average path (dim ⌀ markers) against your planned purchases, labeled "an empirical average, not a prescription."

### Data + delivery (host-agnostic)
- Data is **synced from deadlock-api.com** and **baked into the build** (`src/lib/baked-data.json`) — **no runtime database**, so the app deploys to any static/serverless host (Cloudflare, Vercel, a Node/Bun server). Most pages are static HTML.
- A scheduled **GitHub Action** re-syncs daily and commits only on a real game-data change.
- Cloudflare Workers deploy config (OpenNext) is included as one documented option ([deploy.md](deploy.md)); the core is host-neutral.

---

## What we're working towards (next)

> Agent-ready breakdown of everything below (tracks, files, acceptance, dispatch order): [superpowers/plans/2026-07-04-open-upgrades-agent-handoff.md](superpowers/plans/2026-07-04-open-upgrades-agent-handoff.md).

*(The 2026-07-04 agent sweep shipped the deeper-engine mechanics — stacking amps, %-of-health at full HP, imbue recompute, tier-behavior infrastructure — plus the accessibility pass and the internal refactors. What honestly remains, per [bugs.md](bugs.md): Vyper's ramp-style damage shows the ramp top-end; the curated tier-behavior table is empty because the canonical "Slice and Dice doubles" claim proved false; Spirit-scaled range/duration stays a tag — no coefficient exists in any data source.)*

- 🟡 **Discovery surfaces on `/items`** — Hidden Gems (high-win / rarely-built) now; Risers/Droppers light up automatically once the daily sync accumulates aggregate history. *(In flight.)*

## Potential new features (ideas, not commitments)

- **Combo planner** — spec'd 2026-07-04 with a **build-reduced** verdict (sequence/execute-window planner yes; wall-clock TTK no — cast-time data doesn't exist): [superpowers/specs/2026-07-04-combo-planner-design.md](superpowers/specs/2026-07-04-combo-planner-design.md). **Awaiting owner go-ahead.**
- **Saved / shareable build library** — give builds real saved URLs (and optionally accounts / "my builds"). ⚠️ Requires an owner architecture decision first: accounts/backend conflicts with the locked stay-static constraint.
- **Build guides** — curated or community theorycraft write-ups (parking lot — last, may never ship).

---

## Locked product decisions (don't revisit)

- **Derived level, no slider** — level is set by the souls a build costs; there is no "evaluate at level N" override.
- **Attacker-vs-target is the core model** — A/B comparison is additive, never a replacement.
- **"Proving Ground" is retired** — the tool is "New Build" at `/hideout`; the old name must not appear in UI, routes, filenames, or docs.
