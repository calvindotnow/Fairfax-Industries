# Roadmap

Where Fairfax Industries is headed. This is a living list of candidate work, not a commitment — order and scope will shift.

Legend: 🔴 critical · 🟠 high · 🟡 nice-to-have

## ✅ Recently shipped

- **Damage-over-time modeling** — sustained DoT/sec, a 0.5s slice folded into total burst, and full "if they sit in it" totals
- **Base resists & innate traits** — per-hero base spirit resist, per-level bullet/spirit resist growth, and headshot/crit damage-taken reduction (e.g. Seven)
- **Attacker-side defenses** — the attacker now shows health / bullet / spirit resist with effective-HP tooltips
- **Item upgrade paths** — buying an upgrade collapses its components (no double-counting); tooltips show "upgrades from / builds into"
- **Live item pool only** — disabled/non-shopable test items filtered out; real in-game item descriptions pulled into tooltips
- **Shareable build links** — stateless `?b=` codes, no database (rich Discord/OG previews still pending — see *Next*)
- **Match level** — one-click level the target to the attacker's level (no items)
- **Ultimates off by default** in the burst calc (still toggleable per hero)

## Now — fix what's blocking people

- [ ] 🔴 **Mobile & touch support** — make the Proving Ground reflow on phones/tablets (it currently overflows and is desktop-only)
- [ ] 🔴 **Tap-to-view item details** — item stats are hover-only today, so touch users see nothing
- [ ] 🟠 **"Data synced · patch · date" badge** — show how current the numbers are
- [ ] 🟠 **Faster shop** — lazy-load item images, add image dimensions (no layout shift), cache between patches
- [ ] 🟡 **Quick fixes** — clamp headshots ≤ shots, reliable "link copied" feedback, link the homepage hero portraits, one consistent name for the tool

## Next — earn trust & become a destination

- [ ] 🟠 **"How this is calculated"** — per-result breakdown of the formula, what's included/excluded, and confidence notes
- [ ] 🟠 **Methodology + changelog page** — public, versioned, so power users can verify the math
- [ ] 🟠 **Onboarding** — a guided first-run state and inline definitions for Burst / EHP / DPS / level
- [ ] 🟠 **Hero pages & item browser** — browsable, linkable, searchable reference pages
- [ ] 🟠 **Saved & shareable builds** — ✅ stateless build links shipped; still want rich Discord/social previews (OG images) and crawlable build pages
- [ ] 🟠 **A/B build comparison** — put two of your own builds side by side
- [ ] 🟡 **Automated daily data sync** — always current after a Valve patch, no manual step

## Later — depth & polish

- [ ] 🟠 **Deeper damage engine** — item stacking buffs, active items as combo steps, melee (✅ damage-over-time, crit/headshot reduction, and your-side EHP already shipped)
- [ ] 🟡 **Patch impact** — show how a new patch moved your build's numbers
- [ ] 🟡 **Build guides** — curated or community theorycraft write-ups
- [ ] 🟡 **Accessibility pass** — color-independent category labels, WCAG-AA contrast, keyboard/screen-reader support

---

*Fairfax Industries is a community theorycrafting tool for Deadlock. Not affiliated with or endorsed by Valve Corporation.*
