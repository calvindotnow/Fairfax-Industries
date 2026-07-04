# Open Upgrades — Multi-Agent Handoff Outline

> **For agentic workers:** this is the **master dispatch document** for all open upgrade work as of 2026-07-04. Each track below is sized for one agent. Small tracks (Waves A, E) execute directly — use superpowers:executing-plans discipline (test-first, frequent commits). Large tracks (Wave D, Tier F) **REQUIRE** a brainstorming → spec → plan session first (superpowers:brainstorming → superpowers:writing-plans), following this repo's existing convention in `docs/superpowers/specs/` + `docs/superpowers/plans/`. Track steps use checkbox syntax for tracking.

**Goal:** clear every open item in `features.md`, `bugs.md`, and the unshipped remainder of `docs/research/2026-06-26-roadmap.md`, as parallelizable agent tracks.

**Architecture:** the app is static/baked — a pure, tested damage engine (`src/lib/sim/`), game data synced from deadlock-api.com and baked to JSON at build time (no runtime DB), two product surfaces (`/hideout` damage calculator, `/lane` lane matchup) plus reference pages. Nothing in this document changes that architecture.

**Tech stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 tokens + inline-style pattern (see `docs/style.md`) · `bun test` · data via `scripts/sync-deadlock-api.ts` → `src/lib/baked-data.json` (+ `lane-lab-data.json`) · daily GitHub Action re-sync.

## Global constraints (every track inherits these)

**Locked product decisions — do not revisit (from `features.md` / the 2026-06-26 roadmap):**
- Derived level, **no level slider** — level comes from the souls a build costs; no "evaluate at level N" override.
- **Attacker-vs-target is the core model** — A/B comparison stays additive, never a replacement.
- **Never become a tracker** — no leaderboards, match feeds, recent matches, rank distributions, or personal match history. Empirical data serves a build decision only.
- **Never paywall a number, only ever a workflow.** Free + donations; no ads.
- **Stay static** — no accounts, no backend, no runtime DB. Data is baked at build time.
- The name **"Proving Ground" is retired** — must not appear in UI, routes, filenames, or docs.

**Conventions:**
- UI follows `docs/style.md` (single source of truth): CSS-variable tokens in `globals.css`, inline-style pattern in product components / Tailwind on the marketing shell, `useIsNarrow` for breakpoints, no hardcoded hex.
- The engine stays pure and test-covered: every engine change adds a locking test in `src/lib/sim/engine.test.ts`; `bun test` green before every commit (54 tests / 8 files at handoff time).
- Data changes go through `scripts/sync-deadlock-api.ts` → baked JSON. Heavy aggregates go in a **separate lazy-loaded JSON** (pattern: `src/lib/lane-lab-data.json`), never bloating the shared `baked-data.json`. Watch bundle size.
- Docs discipline: when a track ships, update `docs/features.md` (status flip), `docs/bugs.md` (close/convert items), and `/methodology` (`src/app/methodology/page.tsx`) if engine scope changed — **in the same change**.
- Be a good API citizen: identify via User-Agent (already done in sync), consider a free deadlock-api key for the aggregate endpoints.

**Verification norms:** `bun test`; engine numbers stress-tested against the in-game practice range (the accuracy moat); UI verified in the browser (preview tools or `bun --bun next dev`); bundle-size check whenever baked data grows.

---

## Wave A — independent quick/medium tracks (fully parallel, direct-execute)

### Track A1 · Share-code patch stability
**Source:** `bugs.md` → Open (🟡). **Lift:** M.
**Files:** `src/lib/build-code.ts` (166 lines, `VERSION = 2` at :28), `src/lib/build-code.test.ts`, `src/app/b/[code]/resolve.ts` (+ its test).
**Current state:** VERSION 2 narrowed drift but codes still reference items/heroes positionally; a link made before a patch can resolve to the wrong item after the pool changes. V1 (name-sorted positional) decodes via a legacy path (:142).
**Approach:** introduce **VERSION 3** that encodes stable identities — the API `class_name` (available in baked data) hashed/indexed against a pool manifest — or, minimally, embed a short hash of the item pool so decode detects mismatch and shows a "this link was made on an older patch; some items may differ" notice on `/hideout`, `/lane`, and `/b/<code>`. Keep V1 + V2 decoders working.
**Acceptance:**
- [ ] A test that simulates a pool reshuffle (add/remove/rename an item, re-sort) proves V3 codes still resolve to the same items.
- [ ] Legacy V1/V2 codes still decode (existing tests stay green).
- [ ] On genuine mismatch, the UI warns instead of silently mis-resolving.

### Track A2 · Engine internal refactors (behavior-preserving)
**Source:** `bugs.md` → Internal debt. **Lift:** M.
**Files:** `src/lib/sim/types.ts` (`ItemEffect` at :22 — one interface, 9 `kind`s, many optional fields), `src/lib/sim/engine.ts` (`deriveAbilityScaling` at :203 also returns `executePct`/`executeKind`), `scripts/sync-deadlock-api.ts` (produces effects), `src/lib/sim/engine.test.ts`.
**Approach:** (1) split `ItemEffect` into a **discriminated union** — one interface per `kind` (`onHitProc | onHitFlat | conditionalWeaponPct | conditionalFireRate | targetResistReduction | stacking | imbue | activeBuff | activeDamage`) with only that kind's fields; update all consumers with exhaustive `switch`es. (2) extract a dedicated `abilityExecute()` accessor so execute-threshold data no longer rides the scaling helper.
**Acceptance:**
- [ ] All existing tests green, **zero diff** in any baked JSON, zero behavior change (spot-check a known matchup's numbers before/after).
- [ ] No `kind`-conditional field access without narrowing (TS enforces it).

*Not in scope (standing watch-item, not a refactor):* bugs.md's third debt entry — ability-damage detection via css_class match + `NON_DAMAGE` name blocklist in the sync. Leave the mechanism; just re-eyeball the blocklist whenever a patch adds new ability property names.

### Track A3 · Accessibility completion
**Source:** `features.md` → next (🟡); `style.md` §9 documents the known gaps. **Lift:** M.
**Files:** `src/components/damage-calculator.tsx`, `buy-menu.tsx`, `counter-panel.tsx`, `lane-matchup.tsx`, `versus-band.tsx`, `src/app/globals.css`, `docs/style.md`.
**Current state:** `--text-dim` was already raised to pass AA; item details open on tap/focus. Remaining: finish the contrast audit (`--text-muted` usages on tinted/parchment surfaces), full keyboard operability (shop tiles, tooltips, ability-rank pips, scenario toggles, lens tabs), aria (`aria-label` on icon-only buttons, `aria-pressed` on toggles, focus order), and color-independent category signaling where hue still stands alone.
**Acceptance:**
- [ ] Every interactive control reachable and operable by keyboard, with visible focus.
- [ ] Text passes WCAG AA on its actual background (incl. parchment).
- [ ] `style.md` §9 updated to reflect what's fixed vs. still open.

### Track A4 · Doc hygiene + verify-first polish
**Source:** staleness found 2026-07-04 + roadmap Phase-0 leftovers. **Lift:** S.
**Files:** `docs/features.md`, `src/components/damage-calculator.tsx` / `src/lib/use-build.ts`, `src/lib/sim/types.ts` (`SimOptions`).
**Steps:**
- [ ] `features.md`: move "Rich link previews" from *next* → *Shipped* (it exists: `src/app/b/[code]/opengraph-image.tsx`, dynamic, cached, hero-vs-hero + headline numbers). *(May already be done in the same change that created this document — verify.)*
- [ ] Verify **fire-rate-aware default shots** (default ≈ 1 second of fire = `round(weaponFireRate)`, user-overridable) — implement if missing.
- [ ] Verify **`matchTargetLevel` defaults to on** — implement if missing (keep "by items purchased" as the toggle-off state).

---

## Wave B — engine depth (one agent, sequential; parallel to A/C)

**Source:** `features.md` → "Deeper engine" (🟠) + `bugs.md` → approximations. Each sub-item: write the failing locking test first; update `/methodology` and `bugs.md` (approximation → modeled) on completion. Run each mechanic as a mini spec-then-implement cycle.

- [ ] **B1 · Display-only stacking → modeled.** Escalating Exposure (spirit-damage amp per stack) and Restorative Locket (heal per stack) have stack sliders but no effect on numbers. Wire their per-stack effects into the damage/vitality outputs. Files: `engine.ts` stacking handler, `engine.test.ts`.
- [ ] **B2 · %-of-health ability damage.** Vyper missing-health (and other current/missing-health scalers) shown as a flat number at the target's **full HP** — same convention Tankbuster already uses for items. Files: `scripts/sync-deadlock-api.ts` (parse the property), `engine.ts`, tests.
- [ ] **B3 · Imbue recompute.** Imbue currently shows only the relationship (⟡ on the imbued ability); recompute the imbued ability's actual numbers (damage, duration) with the imbue item applied. Files: `engine.ts` imbue path, tests.
- [ ] **B4 · Tier behaviors beyond stat deltas.** Rank upgrades that add a *mechanic*, not a number (e.g. Shiv's Slice and Dice hits twice at max rank) — the API exposes no flag. Add a small, explicit **curated per-ability override table** (documented, easy to audit per patch) consumed by the burst path. Files: new table module under `src/lib/sim/`, `engine.ts`, tests.
- [ ] **B5 · Spirit-scaled range/duration — research-first.** The API exposes only a scale *type* (`ETechRange`/`ETechDuration`), no coefficient. Timebox research (API fields, deadlock.wiki, community data). If a coefficient exists → apply it; if not → close as a documented approximation (keep the "scales with Spirit" tag) and record the finding in `bugs.md`.

---

## Wave C — empirical UX lifts (C0 first, then C1–C4 parallel)

**Source:** roadmap Feature 3 (all adopted, tracker-free). Empirical data **proposes**, the sim **proves** — no leaderboards/match surfaces, ever.

### Track C0 · Aggregates sync foundation (enabler — do first)
**Files:** `scripts/sync-deadlock-api.ts`, new lazy JSON (e.g. `src/lib/aggregates-data.json`), `src/lib/data.ts` accessors, `.github/workflows/sync-data.yml`.
**Approach:** extend the sync to bake **curated** item win/pick aggregates (`/v1/analytics/item-stats`) and ability-order stats (`/ability-order-stats`), with `min_matches` floors and rank-bracket filtering per the research appendix. Separate lazy-loaded JSON (pattern: `lane-lab-data.json`); commit-on-change in the Action.
**Acceptance:** valid JSON, documented size budget, accessors typed + unit-tested (pattern: `data.test.ts`).

### Track C1 · Two-axis item ranking — `/items` (+ hero pages)
Popular-by-pickrate vs highest-winrate, side by side; sortable. **Deps:** C0.

### Track C2 · Ability-order win rates — `/heroes/<slug>`
"Which skill order actually wins" table on the hero detail page. **Deps:** C0.

### Track C3 · Discovery sidebars — Hidden Gems / Risers / Droppers / Sleepers
Movement requires aggregate history: extend the snapshot pattern (`src/lib/snapshot.ts`, `patch-diff.ts` keep two stat snapshots) to aggregates, then surface deltas. **Deps:** C0 (+ two sync cycles of history). **Lift:** M–L.

### Track C4 · Build-path timeline overlay — progression panel
Overlay the planned build vs the aggregate average path (bucketed by soul/minute) on `src/components/progression-panel.tsx`, reusing the existing scrubber. Requires distilling per-hero `item_order`/`bought_at_s` into a canonical timeline. **Deps:** C0. ⚠️ **Design the build-path data shape once, jointly with D1 — they share it.**

---

## Wave D — Lane Lab v2 (big; spec-first REQUIRED)

### Track D1 · Auto-progressing average enemy builds on `/lane`
**Source:** roadmap Feature 1 v2 (the "heaviest data lift"). **Deps:** C0 + the C4 build-path data shape.
Enemy laners auto-fill their **average build path**, advancing as your souls climb (drives the existing progression/soul checkpoints). Files eventually: sync (build-path distillation), `src/components/lane-matchup.tsx`, `counter-panel.tsx`, `src/lib/lane-lab.ts`.
**Do not start coding from this outline** — run brainstorming → spec → plan first (this is the repo's convention; see `docs/superpowers/specs/2026-06-26-lane-lab-v1-design.md` for the v1 precedent). Open question to resolve at spec time: deadlock-api granularity for per-soul build-path aggregation (gates the whole feature).

---

## Wave E — positioning (small; anytime after `/lane` stabilizes)

### Track E1 · Home-page re-lead
**Source:** roadmap Feature 4. **Files:** `src/app/page.tsx`. **Lift:** S.
Lead with the lane question ("what do I build to beat this lane") now that `/lane` exists as its own surface; present both tools (Lane Matchup + Damage Calculator) with the sim depth as the credibility proof. Confirm the seeded default demo state still lands a first-timer on live numbers. The front door is already matchup-framed — this is evolution, not a rewrite.

---

## Tier F — owner go-ahead required (ideas, not commitments)

**Agents must NOT start these unprompted.** Listed so the pipeline is visible; each needs an explicit owner green-light, then a brainstorm → spec → plan cycle.

- **F1 · Patch impact on *your* build** — closest to green-light; static-friendly. Snapshot history × a build code → "this patch moved your build's burst by −4%." Builds on `patch-diff.ts`.
- **F2 · Combo planner** — extend the execute math into a 1v1 kill-sequencer (abilities + bullets to a threshold). Distinct from the **parked** combined-damage 2v2 solver (which stays parked).
- **F3 · Saved build library** — ⚠️ category change: real saved URLs / accounts imply a backend, conflicting with the **stay-static** constraint. Requires an explicit owner decision on architecture before any spec work.

**Explicitly excluded (parking lot — do not schedule):** build guides; the combined-damage 2v2 combo solver; any paid/pro tier.

---

## Dependency graph & suggested dispatch

```
A1 ∥ A2 ∥ A3 ∥ A4          (independent, start immediately, 4 parallel agents)
B1 → B2 → B3 → B4 → B5     (one agent, sequential; parallel to A and C)
C0 → { C1 ∥ C2 ∥ C3 ∥ C4 } (C0 is the gate)
C0 + C4(data shape) → D1   (spec session first)
E1                          (anytime)
F1 / F2 / F3                (gated on owner approval)
```

**Suggested first dispatch:** A1–A4 as four parallel agents + one agent starting B1. C0 next. Merge order within a wave doesn't matter; tracks touch disjoint files except where noted.

## Per-track completion checklist (every agent, before closing a track)

- [ ] `bun test` green; new locking test(s) added for any engine change.
- [ ] Engine-number changes sanity-checked against the in-game range or an existing test baseline.
- [ ] `docs/features.md` status updated (next → Shipped, or ideas → next).
- [ ] `docs/bugs.md` item closed/converted; new limitations logged honestly.
- [ ] `/methodology` updated if the modeled scope changed.
- [ ] `docs/style.md` updated if any token/pattern changed.
- [ ] No violation of the Global constraints (re-read them before merging).
