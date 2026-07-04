# Damage / Lane Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/hideout` into a focused **Damage Calculator** (`/hideout`) and a new **Lane Matchup Calculator** (`/lane`) by extracting the shared build-workbench core out of the `Hideout` monolith — with **no user-facing behavior change** except moving the Counter feature to its own route.

**Architecture:** A mechanical, behavior-preserving refactor. Extract all build state + actions from `src/components/hideout.tsx` into a `useBuild` hook; extract the shared selection band + progression into their own component files; rename the damage half to `DamageCalculator` (drop its Counter tab); add a thin `LaneMatchup` surface at `/lane` that consumes the same core + `CounterPanel`. Surfaces are independent sessions; builds transfer via the existing `?b=` share code.

**Tech Stack:** Next.js 16 / React 19, Bun (`bun test`, `bun run build`), client components, the existing `simulate` engine + `build-code` share codes (both untouched).

## Global Constraints

- **Behavior-preserving:** after each task `/hideout` must behave EXACTLY as before, except the Counter tab is removed (Task 3). The mechanical moves change *no logic* — they relocate existing code.
- **No engine or share-code changes** — `src/lib/sim/**` and `src/lib/build-code.ts` are untouched.
- **`/hideout` route path stays** (existing `?b=` links and `/b/<code>` "Open in New Build" must keep resolving).
- **"Proving Ground" must never appear.** Follow `docs/style.md`.
- **No component-test harness exists; do not add one.** Verify via `bunx tsc --noEmit`, `bun run build`, the existing `bun test` suite staying green, headless SSR render checks, and manual.
- Lint has **pre-existing** errors only in `scripts/sync-deadlock-api.ts` — ignore them; introduce none.
- **Commits** end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Design spec: `docs/superpowers/specs/2026-06-27-damage-lane-split-design.md`.

---

## File Structure

- `src/lib/use-build.ts` (**create**) — `useBuild(initial)` hook owning the build session.
- `src/components/versus-band.tsx` (**create**) — `VersusBand` + its helpers, extracted from the monolith.
- `src/components/progression-panel.tsx` (**create**) — `ProgressionPanel` + `ReorderBtn`, `PreviewStat`.
- `src/components/damage-calculator.tsx` (**create**, from the old `hideout.tsx`) — the Damage Calculator surface; Counter tab removed.
- `src/components/hideout.tsx` (**delete** after its content becomes `damage-calculator.tsx`).
- `src/components/lane-matchup.tsx` (**create**) — the Lane Matchup surface (core + `CounterPanel`).
- `src/app/hideout/page.tsx` (**modify**) — render `DamageCalculator`.
- `src/app/lane/page.tsx` (**create**) — render `LaneMatchup` (mirrors `hideout/page.tsx`).
- `src/components/navigation.tsx` (**modify**) — relabel the build entry + add `/lane`.

Reused unchanged: `BuyMenu`, `HeroPicker`, `CounterPanel`, `OnboardingTour`, `RollingNumber`, `SlotText`, `@/lib/sim`, `@/lib/build-code`, `@/lib/lane-lab`.

---

## Task 1: Extract the `useBuild` hook

**Files:** Create `src/lib/use-build.ts`; Modify `src/components/hideout.tsx`.

**Interfaces:**
- Produces: `useBuild(args: { heroes, items, initialHeroId, initialBuild }) → { …build session… }` — a single object holding every build value + setter/action the component body currently declares (see below). Consumed by `Hideout` now and `DamageCalculator` + `LaneMatchup` later.

**What moves vs. stays** (this is a *verbatim relocation*, not a rewrite — do not change logic):
- **MOVE into the hook:** every `useState`/`useMemo`/`useRef`/`useEffect`/handler in the `Hideout` function body that concerns the *build* — `heroId, targetId, loadoutA, loadoutB, targetLoadout, compareOn, compareView, activeBuild, buyingFor, matchTargetLevel, range, shots, shotsTouched, headshots, accuracy, headshotPct, hittingEnemy, resistDebuffs, activesFiring, stacksByItem, imbueAssign, abilityRanks, excludedActives, disabledAbilities, checkpoint`; the derived `hero, target, equippedA/B, targetEquipped, resultA/B, result, hs, ts`, progression steps, `equipped`, etc.; and every action (`setHeroId` incl. the `setShotsTouched(false)` reset, `setTargetId`, add/remove item, buy flow, the toggle/rank setters, the `?b=` decode-on-init, the `encodeBuild` + `history.replaceState` URL-sync effect, the `buildShareUrl` builder, the fire-rate default-shots effect).
- **STAY in the component** (pure view state): `overviewTab`, `showCalc`, `showProgression`, `showOnboard`, `toast`, the responsive `narrow` measurement, and their effects.

- [ ] **Step 1: Create the hook by relocating the build body**

Create `src/lib/use-build.ts` exporting `export function useBuild({ heroes, items, initialHeroId, initialBuild }: {...}) { … }`. Cut the build state/derived/actions listed above out of `Hideout`'s body and paste them into the hook verbatim. End the hook with `return { /* every moved value + action, by their existing names */ };`. Keep all logic identical (same deps, same effects). The hook is a plain custom hook (no JSX).

- [ ] **Step 2: Rewire `Hideout` to consume the hook**

At the top of `Hideout`'s body, replace the removed declarations with one destructure:
```tsx
const build = useBuild({ heroes, items, initialHeroId, initialBuild });
const { heroId, targetId, /* …all moved names… */ } = build;
```
Leave the JSX `return (...)` untouched — it still references the same names, now sourced from the hook. The view-only state stays declared in the component.

- [ ] **Step 3: Verify `/hideout` is unchanged**

Run: `bunx tsc --noEmit` (clean — catches any missed/renamed reference) and `bun run build` (clean, 46 routes). Run `bun test` (still green). Then a headless SSR render check (see Appendix A) of `Hideout` with a seeded build — confirm it renders (non-trivial HTML, the VS band + a damage readout present). Manually: `bun run dev`, open `/hideout`, confirm pick heroes / buy / scenario toggles / compare / progression / share / `?b=` load all still work.

- [ ] **Step 4: Commit**
```bash
git add src/lib/use-build.ts src/components/hideout.tsx
git commit -m "Extract useBuild hook from the Hideout monolith (behavior-preserving)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Extract `VersusBand` and `ProgressionPanel` into files

**Files:** Create `src/components/versus-band.tsx`, `src/components/progression-panel.tsx`; Modify `src/components/hideout.tsx`.

**Interfaces:**
- Produces: `VersusBand(props)` and `ProgressionPanel(props)` as standalone exported components. Their props are exactly the values/handlers they currently close over from `Hideout` (now sourced from `useBuild`) — pass them explicitly.

- [ ] **Step 1: Move `VersusBand` + its helpers**

Cut the inline `VersusBand` JSX block (around `hideout.tsx:395–477`) into `src/components/versus-band.tsx` as `export function VersusBand(props)`, and move the helper components it uses that are NOT needed by the damage surface: `HeroPortrait`, `MiniStat`, `SideLabel`, `CompactLoadout`, `MatchLevelButton`, `ShareBuildButton`, `InfoDot`, `CompareToggle` (move the definitions; if `Hideout` also uses one elsewhere, re-export or import it back). Convert every closed-over reference (`hero`, `heroId`, `setHeroId`, `result`, `compareOn`, `buildShareUrl`, `fmt`, …) into a typed prop. In `Hideout`, `import { VersusBand }` and render `<VersusBand … />` passing the props from `build`.

- [ ] **Step 2: Move `ProgressionPanel`**

Cut `ProgressionPanel` (`~925–994`) + `ReorderBtn` (`~995`) + `PreviewStat` (`~1004`) into `src/components/progression-panel.tsx` as exports; convert closed-over refs to props; import + render it in `Hideout`.

- [ ] **Step 3: Verify `/hideout` unchanged**

Run `bunx tsc --noEmit`, `bun run build`, `bun test` (all green). Headless render check of `Hideout` (Appendix A) — VS band + progression still render. Manual `/hideout` pass (selection, share button, level strip, progression scrub).

- [ ] **Step 4: Commit**
```bash
git add src/components/versus-band.tsx src/components/progression-panel.tsx src/components/hideout.tsx
git commit -m "Extract VersusBand + ProgressionPanel into shared component files

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Rename `Hideout` → `DamageCalculator`, remove the Counter tab

**Files:** Create `src/components/damage-calculator.tsx` (from `hideout.tsx`); Delete `src/components/hideout.tsx`; Modify `src/app/hideout/page.tsx`.

- [ ] **Step 1: Rename the file + component**

`git mv src/components/hideout.tsx src/components/damage-calculator.tsx`. Rename `export default function Hideout` → `export default function DamageCalculator` (keep the same props). Update `src/app/hideout/page.tsx` to `import DamageCalculator from "@/components/damage-calculator"` and render it (props unchanged).

- [ ] **Step 2: Remove the Counter tab**

In `damage-calculator.tsx`: delete the `dynamic(() => import("@/components/counter-panel")…)` `CounterPanel` declaration and the `{overviewTab === "counter" && <CounterPanel …/>}` render branch and the `counterOpts` memo that only fed it. In `OverviewTabs`, change the `active`/`onChange` type unions back to `"damage" | "vitality" | "spirit"` and remove the `["counter", "Counter", …]` tab tuple. (CounterPanel itself stays — Task 4 uses it on `/lane`.)

- [ ] **Step 3: Verify**

`grep -n "CounterPanel\|\"counter\"\|counterOpts" src/components/damage-calculator.tsx` → no matches. `bunx tsc --noEmit`, `bun run build`, `bun test` green. Manual `/hideout`: the four tabs are now three (Damage/Vitality/Spirit); everything else identical.

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "Rename Hideout to DamageCalculator; remove the Counter tab (moves to /lane)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add the `LaneMatchup` surface + `/lane` route

**Files:** Create `src/components/lane-matchup.tsx`, `src/app/lane/page.tsx`.

**Interfaces:**
- Consumes: `useBuild` (Task 1), `VersusBand` (Task 2), `BuyMenu`, `CounterPanel`.

- [ ] **Step 1: Create `LaneMatchup`**

Create `src/components/lane-matchup.tsx` ("use client") — `export default function LaneMatchup({ heroes, items, initialHeroId, initialBuild })`. Use `const build = useBuild({...})`. Render: the `VersusBand` (same props as the Damage Calculator passes), the `BuyMenu` (same wiring), and `CounterPanel` as the main content, passing exactly what the old Counter tab passed: `hero={build.hero} enemy={build.target} yourItems={build.equipped} enemyItems={build.targetEquipped} items={items} onAddItem={build.addItem-for-active} fmt={fmt}` and **default combat opts**:
```tsx
const opts = { range: 25, shots: 8, headshots: 0, disabledAbilityIds: [], hittingEnemy: true, resistDebuffs: true, activesFiring: false, stacksByItem: {}, accuracy: 100, headshotPct: 0, abilityRanks: {}, excludedActiveItemIds: [] };
```
(Read how the old Counter tab in `damage-calculator.tsx` built `counterOpts`/`onAddItem` and mirror it; no scenario controls on `/lane` in Spec 1 — that's Spec 2.) `CounterPanel` is a client component imported directly (the route is client-loaded).

- [ ] **Step 2: Create the `/lane` route**

Create `src/app/lane/page.tsx` mirroring `src/app/hideout/page.tsx`: same server-side `?b=` decode (reuse its exact logic — import the same helpers), passing `initialBuild`/`initialHeroId` into `<LaneMatchup … />`. Same page metadata pattern.

- [ ] **Step 3: Verify `/lane`**

`bunx tsc --noEmit`, `bun run build` (now includes `/lane`), `bun test` green. Headless render check of `LaneMatchup` with a real in-data matchup (Appendix A) → the matchup header + top counters + recommender render (same output the Counter tab produced). Manual: `/lane` shows the build + counter content; `?b=<code>` loads a build.

- [ ] **Step 4: Commit**
```bash
git add src/components/lane-matchup.tsx "src/app/lane/page.tsx"
git commit -m "Add LaneMatchup surface at /lane (relocated counter feature)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Nav entries + transfer links

**Files:** Modify `src/components/navigation.tsx`, `src/components/damage-calculator.tsx`, `src/components/lane-matchup.tsx`.

- [ ] **Step 1: Nav**

In `src/components/navigation.tsx`, update the links array: relabel `{ href: "/hideout", label: "New Build" }` → `label: "Damage Calc"`, and add `{ href: "/lane", label: "Lane Matchup" }` right after it.

- [ ] **Step 2: Transfer links**

On the Damage Calculator, add a small link "Open in Lane Matchup →" pointing to `/lane?b=${code}` using the current build's share code (the `buildShareUrl`/`encodeBuild` already in `useBuild` — build `/lane?b=<code>`). On `LaneMatchup`, add "Open in Damage Calc →" → `/hideout?b=<code>`. Place each near the share button / header; match `style.md` link styling.

- [ ] **Step 3: Verify**

`bunx tsc --noEmit`, `bun run build`, `bun test` green. Manual: nav shows "Damage Calc" + "Lane Matchup"; from `/hideout` with a build, the transfer link opens `/lane` with the same build (`?b=` round-trips), and vice versa.

- [ ] **Step 4: Commit**
```bash
git add src/components/navigation.tsx src/components/damage-calculator.tsx src/components/lane-matchup.tsx
git commit -m "Nav entries (Damage Calc / Lane Matchup) + build-transfer links

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Appendix A — Headless render check (the verification technique)

For a surface component `C` in a throwaway `_rc.tsx` at repo root, then `rm` it:
```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getHeroes, getItems } from "./src/lib/data";
import C from "./src/components/<file>"; // or { Named }
const heroes = getHeroes(), items = getItems();
const html = renderToStaticMarkup(React.createElement(C as any, { heroes, items, initialHeroId: null, initialBuild: null }));
console.log("len", html.length, "| has VS:", html.includes("VS"));
```
Run `bun _rc.tsx`. Expected: non-trivial `len`, no throw. (Pass a seeded `initialBuild` if the surface needs items to show content.)

## Self-Review

**Spec coverage:** useBuild extraction → T1; VersusBand/ProgressionPanel extraction → T2; DamageCalculator + Counter-tab removal → T3; LaneMatchup + `/lane` route + default opts → T4; nav + `?b=` transfer → T5. Behavior-preservation + no engine/share-code change → Global Constraints + each task's verify. Independent-sessions/transfer → T4/T5. ✓

**Placeholder scan:** Tasks describe a *verbatim relocation* of named, line-referenced existing code plus exact new code (the default opts, the nav entries, the render-check) — appropriate for a refactor; no "TBD"/"handle edge cases". The one soft spot (`build.addItem-for-active`) is resolved by "mirror how the old Counter tab built `onAddItem`," which is concrete. ✓

**Type consistency:** `useBuild` returns the same names the JSX already uses (T1), and T2/T4 pass those same names as props; `DamageCalculator`/`LaneMatchup` share the `{ heroes, items, initialHeroId, initialBuild }` prop shape; `OverviewTabs` union returns to the 3-tab form in T3. ✓

## Verification (whole feature)

`bun test` green; `bunx tsc --noEmit` + `bun run build` clean (routes include `/lane`); headless render checks pass for both surfaces; manual: `/hideout` is the 3-lens Damage Calculator (no Counter tab), `/lane` is the Lane Matchup Calculator (matchup + counters + recommender), nav has both, and a build transfers between them via `?b=`.
