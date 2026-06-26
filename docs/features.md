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
- **Shareable builds** — stateless `?b=` codes (VERSION 2, legacy decodes) and crawlable `/b/<code>` pages with metadata.

### Data + delivery (host-agnostic)
- Data is **synced from deadlock-api.com** and **baked into the build** (`src/lib/baked-data.json`) — **no runtime database**, so the app deploys to any static/serverless host (Cloudflare, Vercel, a Node/Bun server). Most pages are static HTML.
- A scheduled **GitHub Action** re-syncs daily and commits only on a real game-data change.
- Cloudflare Workers deploy config (OpenNext) is included as one documented option ([deploy.md](deploy.md)); the core is host-neutral.

---

## What we're working towards (next)

- 🟠 **Rich link previews** — `/b/<code>` has metadata but no dynamic Open Graph *image*; add an `opengraph-image` (hero-vs-hero + headline numbers) so build links unfurl in Discord. Highest-leverage virality win post-launch.
- 🟠 **Deeper engine** — remaining mechanics: tier *behaviors* beyond stat deltas (Shiv's Slice and Dice double-hit at max); recompute imbued ability numbers and Spirit-scaled range/duration; %-of-health *ability* damage (Vyper missing-health, etc.); and the stacking stats still display-only (Escalating Exposure, Restorative Locket). *(Done: ability ranks 0–3 apply tier upgrades to damage/range/duration/charges/cooldown; active items' direct damage — Arctic Blast, Cold Front — folded into burst while "Actives firing", each toggleable in/out per item; ability bleed/per-stack DoTs — Shiv's Serrated Knives — tracked over their full duration; Tankbuster current-health damage shown at full health; Spirit panel lists Spirit-scaling item damage.)*
- 🟡 **Accessibility pass** — finish the contrast audit (`--text-dim`/`--text-muted`) and full keyboard/screen-reader coverage.
- 🟡 **Internal refactors** (no user impact) — tracked as debt in [bugs.md](bugs.md): split the `ItemEffect` grab-bag into a discriminated union; move execute-threshold data out of `deriveAbilityScaling` into its own accessor.

## Potential new features (ideas, not commitments)

- **Saved / shareable build library** — give builds real saved URLs (and optionally accounts / "my builds") on top of the stateless link sharing.
- **Combo planner** — extend the execute math into a full "can you secure the kill?" sequencer (abilities + bullets to a threshold), and active-item combos.
- **Build guides** — curated or community theorycraft write-ups (parking lot — last, may never ship).
- **Patch impact on *your* build** — leverage the snapshot history to show how a patch moved a specific build's numbers.

---

## Locked product decisions (don't revisit)

- **Derived level, no slider** — level is set by the souls a build costs; there is no "evaluate at level N" override.
- **Attacker-vs-target is the core model** — A/B comparison is additive, never a replacement.
- **"Proving Ground" is retired** — the tool is "New Build" at `/hideout`; the old name must not appear in UI, routes, filenames, or docs.
