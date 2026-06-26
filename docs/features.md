# Features

The single feature doc for Fairfax Industries — a community Deadlock theorycrafting tool.
The build tool lives at **`/hideout`** (the "New Build" nav button). Math lives in the
portable engine at `src/lib/sim/`; UI conventions in [style.md](style.md). This file
supersedes the old handoff/plan/roadmap docs — shipped items below were verified against
the codebase on 2026-06-25.

Legend: 🔴 critical · 🟠 high · 🟡 nice-to-have

---

## Shipped

- **Build tool (`/hideout`)** — two-sided attacker-vs-target damage calculator: pick attacker + target, buy items for each, read burst / sustained DPS / time-to-kill / EHP. Fully responsive (`use-narrow.ts`), no horizontal scroll on phones.
- **A/B build comparison** — compare two of your own builds side by side; colors read from the build you're editing (green = ahead, red = behind). Additive to attacker-vs-target.
- **Build progression** — a build is an ordered purchase timeline; scrub to a level checkpoint to see the partial build owned by that point (level derived from cumulative souls).
- **Ability data & Spirit scaling** — abilities show cooldown, damage, range, duration, and charge count; a "scales with Spirit Power" tag (with the precise per-Spirit damage coefficient) appears on both the build page and hero pages.
- **Movement stats** — sprint speed (absolute) and stamina on the attacker readout, with hover detail.
- **Damage engine depth** — damage-over-time (per-sec + full-duration), crit/headshot damage-taken reduction, per-hero base resists, per-level resist/damage growth, base melee, attacker-side EHP, item upgrade-path collapse, asymptotic stat stacking.
- **Hero pages** — `/heroes` roster + `/heroes/<slug>` detail with a conditional ability stat table (slug URLs, legacy numeric IDs redirect).
- **Item browser** — `/items`, searchable by name **and** description, with the full in-game descriptions.
- **Methodology + "how this is calculated"** — `/methodology` page plus per-result disclosures of what's included/excluded.
- **Patch notes & data-freshness** — `/patch-notes` diffs stat snapshots between syncs; a "Data synced · <date>" badge renders in the footer.
- **Shareable build links** — stateless `?b=` codes and crawlable `/b/<code>` pages with `generateMetadata`. Codes are format VERSION 2 (legacy VERSION 1 still decodes).
- **Onboarding** — a multi-step spotlight tour anchored to real UI via `data-tour` attributes; seeds a demo build so the shop, abilities, and progression panel are live. Replay link in the footer.
- **Performance/a11y baseline** — `next/image` with explicit dimensions + lazy loading (CDN-resilient, no CLS); focusable item details; aria labels on icon-only controls.

---

## Planned / open

- 🟠 **Caching / ISR** — both routes are still `force-dynamic` (`no-store`); data only changes on sync, so move to ISR or cached queries revalidated on sync, and trim the payload to client-needed fields.
- 🟠 **Hosting + automated daily sync** — runtime DB is still file-based `bun:sqlite` (won't survive serverless), and the sync is manual. Move to managed libSQL/Turso (or bake-at-build) and run the sync on a schedule (GitHub Action/cron).
- 🟠 **Rich link previews** — `/b/<code>` has metadata but no dynamic Open Graph image; add an `opengraph-image` (hero-vs-hero + headline numbers) so build links unfurl in Discord.
- 🟠 **Dedicated Vitality & Spirit overview tabs** — the Damage tab (burst calculator + abilities) is great for damage-focused builds, but tanky players care about health/resist/stamina/movement and spirit players care about ability/spirit damage. Add Vitality and Spirit highlight tabs alongside Damage, each surfacing the stats that audience optimizes for.
- 🟠 **Deeper engine** — active items as explicit combo steps; fuller melee (the +50% weapon scaling, melee items, separate melee-resist channel); recompute imbued ability numbers (currently the imbue relationship is shown but the ability's stats aren't recomputed); and the stacking stats not yet modeled (spirit-damage amp like Escalating Exposure, heal-per-stack like Restorative Locket — their sliders show but are display-only). (On-hit procs, range/fire-rate conditionals, resist debuffs, and weapon/fire-rate/health/sprint stacking are already modeled.)
- 🟡 **Accessibility pass** — finish the contrast audit (`--text-dim`/`--text-muted`) and full keyboard/screen-reader coverage.

## Parking lot — absolute last, may never ship

- **Build guides** — curated or community theorycraft write-ups.

---

## Locked product decisions (don't revisit)

- **Derived level, no slider** — level is set by the souls a build costs; there is no "evaluate at level N" override.
- **Attacker-vs-target is the core model** — A/B comparison is additive, never a replacement.
- **"Proving Ground" is retired** — the tool is "New Build" at `/hideout`; the old name must not appear in UI, routes, filenames, or docs.
