# Bugs & known limitations

The single bug log for Fairfax Industries. Log new bugs here as **Problem → Why → Fix idea**.
The original "100 users" audit has been worked through — the items below are what genuinely
remains; everything else from that pass shipped (see [features.md](features.md)).

Severity: 🔴 blocks a cohort · 🟠 major friction / trust · 🟡 polish / edge case

---

## Open

- 🟡 **Share codes can drift across patches** — codes reference items/heroes positionally, so a link made before a patch can resolve to the wrong item after the pool changes. VERSION 2 narrowed this, but it isn't fully patch-stable. *Fix idea:* encode a stable id (the API `class_name`) or warn on a version/patch mismatch. (`src/lib/build-code.ts`)
- 🟡 **No caching (perf, not correctness)** — both routes are `force-dynamic` (`Cache-Control: no-store`), so every visit re-reads the DB and re-renders. *Fix idea:* ISR / cached queries revalidated on sync (tracked as a feature in [features.md](features.md)).

## Known engine approximations (documented, intentional)

These are scope limits, not bugs — surfaced on `/methodology`. Tightening them is "deeper engine" work in [features.md](features.md).

- Procs are counted in **burst** but not in **sustained DPS**.
- **Melee** models only base light/heavy (no +50% weapon-damage scaling, no melee-damage items, no separate melee-resist channel).
- **Item stacking buffs** (Berserker, Glass Cannon) and **active items as combo steps** aren't modeled.

## Infra limitation (not a code bug)

- 🟠 **File-based SQLite won't survive serverless** — `deadlock.db` is read at request time from the local filesystem; a public deploy needs a managed DB (tracked under hosting in [features.md](features.md)).

---

*Resolved since the original audit (for reference): mobile/touch overflow, hover-only item stats, the "Proving Ground" naming split, the landing "compare builds" copy mismatch, headshots-exceed-shots, silent copy-link no-op, unclickable roster portraits, missing data-freshness indicator, no onboarding, no "show your work", missing hero/item pages — all shipped.*
