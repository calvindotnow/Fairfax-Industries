# Phase 0 — Polish fixes + rich OG previews (design spec)

*From the 2026-06-26 roadmap (`docs/research/2026-06-26-roadmap.md`). Phase 0 is the
cheap-and-fast batch: three correctness/UX fixes plus the highest-leverage virality win.
No engine math changes. Each item is independent and separately shippable.*

## Context

The roadmap's Phase 0 bundles four small, high-value items that don't depend on the new
empirical-data layer:

1. **Hero picker** — clicking a portrait opens an embedded, styled hero selector (kill the
   native OS scrollbar).
2. **Fire-rate-aware default shots** — stop defaulting the burst to a flat 8 shots.
3. **Default the enemy target to matching level** — flip an existing toggle's default.
4. **Rich OG link previews** for `/b/<code>` — dynamic hero-vs-hero + headline-numbers image
   so build links unfurl in Discord.

All four are grounded in existing code (`src/components/hideout.tsx`,
`src/app/b/[code]/page.tsx`). Items 1–3 are pure client/UI defaults; item 4 adds one new
route file and a tiny refactor. The app runs on a server/edge runtime (no `output: 'export'`
in `next.config.ts`; deploys via OpenNext → Cloudflare Workers), and `next/og` `ImageResponse`
is **confirmed supported** on that target (OpenNext Cloudflare ships an e2e example).

---

## Item 1 — Embedded hero picker

**Goal.** Clicking an attacker/target **portrait** opens a hero selector, and that selector is
a styled, in-page **portrait grid** instead of today's native `<select>` (which renders the OS
scrollbar).

**Current.**
- `HeroSelect` (`hideout.tsx:1195`) is a native `<select>`/`<option>` wrapped in a styled div,
  used twice: attacker (`:422`) and target (`:453`).
- `HeroPortrait` renders the avatars (`:399` attacker, `:438` target) and is **not** clickable.
- A separate native `<select>` exists for imbue-ability assignment (`:578`) — **out of scope**
  here (different control); note it as a future restyle candidate.

**Design.**
- Add a reusable **`HeroPicker`** component (new file `src/components/hero-picker.tsx`) that
  replaces `HeroSelect`. Props: `{ heroes, value, onChange, accentColor, align? }` — same
  surface as `HeroSelect`, so it's a drop-in at `:422` and `:453`.
- Trigger: a styled button showing the current hero (accent `◆` + name), matching the existing
  `HeroSelect` chrome (`--surface-raised`, `--border-strong`, `--r-sm`, height 30). Opens a
  popover.
- Popover body: a **portrait grid** (hero image + name), ~4–5 columns, hover highlight in
  `accentColor`, selected hero shows an accent ring. A **search/filter input** at top
  (autofocus) filters by name — important with the full roster. The scroll area uses a
  **custom-styled scrollbar** (`scrollbar-width: thin; scrollbar-color: var(--border-strong)
  transparent;` + `::-webkit-scrollbar` rules) so it reads as embedded, not OS-native.
- Make `HeroPortrait` clickable: a new optional `onClick` prop; wiring the attacker portrait
  (`:399`) and target portrait (`:438`) to open that side's picker. Portrait gets
  `cursor: pointer` + hover affordance + `role="button"`/keyboard activation.
- Positioning/dismiss: anchored popover that clamps to viewport; closes on outside-click and
  `Esc`. Reuse the existing measure-and-anchor pattern (see the `box` measuring around
  `hideout.tsx:807` and the InfoDot/MiniStat tooltip implementation) rather than a new
  dependency. On the narrow layout, render as a centered sheet.
- A11y + motion: trigger is a `<button aria-haspopup="dialog">`; arrow-key navigation across
  the grid; selection announced; respects reduced-motion (per `style.md §8`).

**Forward-compat.** `HeroPicker` is the same control Lane Lab will need for lanemate + enemy
selection — build it generic now so Lane Lab reuses it.

**Visual.** Exact grid sizing/styling is mockup-driven at implementation time (Calvin reacts to
mockups, not descriptions) — this spec fixes behavior and structure, not pixel values.

**Edge cases.** Empty search → "no heroes" row; keep current value highlighted/scrolled into
view on open; `value === null` shows a placeholder trigger.

---

## Item 2 — Fire-rate-aware default shots

**Goal.** The burst-scenario **Shots** field should default to ~1.5 seconds of fire for the
**current build** — base hero *plus* equipped items, so a faster-firing build gets more shots
in that window — not a flat 8.

**Current.** `const [shots, setShots] = useState(initialBuild?.shots ?? 8)` (`hideout.tsx:94`).
Fire rate is available as `weaponFireRate` on computed stats (`engine.ts:148,401`); burst
duration is already `shots / fireRate` (`engine.ts:402`).

**Design.**
- Default = `Math.max(1, Math.round(equippedFireRate * 1.5))`, where `equippedFireRate` is the
  attacker's **current-build** weapon fire rate (base hero + equipped items). Reuse the
  already-computed `result.heroStats.weaponFireRate` rather than a separate sim. **Decision
  (accepted 2026-06-26):** this value *includes* the situational while-hitting conditional buff
  (e.g. Burst Fire's on-hit ramp), because the burst scenario assumes you're hitting the enemy —
  so the default reflects the realistic hitting-burst rate, and the `≈Xs of fire` label stays
  internally consistent with it. (Supersedes the earlier "steady, not best-case" wording; only
  conditional-fire-rate builds differ, it's just the default, and it's user-overridable.)
- Track a `shotsTouched` flag (new `useState(false)`). Auto-apply the default on initial load
  and recompute it whenever the **attacker hero or attacker loadout changes** — but only while
  `shotsTouched` is false (so buying a fire-rate item bumps the default shots up, as intended).
  The moment the user edits the Shots control (`:682`), set `shotsTouched = true` and stop
  auto-updating. A shared `?b=` build that carries an explicit `shots` counts as user-set
  (treat as touched) so shared links render exactly as shared.
- Keep the existing `headshots ≤ shots` clamp (`:682–683`).
- **Manual control stays exact.** The Shots field remains an editable integer ("shots landed")
  for breakpoint precision — no half-second/time stepping. Add a live, read-only **time label**
  next to it (`≈1.5s of fire`, computed as `shots / equippedFireRate`) so the temporal framing
  is visible without sacrificing exact control. Headshots stays an exact integer too.

**Files.** `hideout.tsx` (state init `:94`, a small effect keyed on `heroId`, the Shots
`NumberField` onChange). No engine change. No share-code format change (shots still stored as
the actual value; range fits the existing 1-byte field).

**Edge cases.** `baseFireRate` of 0 / missing weapon → fall back to a floor of 1 (or a small
sane constant). Round half-up. Respect the field's existing `max` (50).

**Resolved.** Window = **1.5s** (× 1.5) over the *equipped* fire rate; keep `1.5` as a single
named constant so it's trivially tunable. Manual control = exact integer + a `≈Xs of fire`
time label (no half-second stepping).

---

## Item 3 — Default enemy target to matching level

**Goal.** New sessions default the target to **matching the attacker's level**, with the
existing manual ("level from items purchased") path kept as the toggle-off.

**Current.** `const [matchTargetLevel, setMatchTargetLevel] = useState(initialBuild?.matchTargetLevel ?? false)`
(`hideout.tsx:92`). The value already flows to the target sim as `matchAttackerLevel` (`:238`,
and `/b/[code]/page.tsx:36`) and is toggled by `MatchLevelButton` (`:439`).

**Design.** Flip the default: `initialBuild?.matchTargetLevel ?? true`. Shared `?b=` builds
still honor their stored value (the share code already encodes `matchTargetLevel`, `:213`), so
existing links are unaffected. The `MatchLevelButton` and its active-state styling already
communicate the on/off state; confirm it reads correctly when on by default.

**Files.** One-line default change in `hideout.tsx:92`. No engine/share-code change.

**Edge cases.** With the default-on, the initial empty matchup shows target at the attacker's
level (both level 1 at zero items) — consistent and expected.

---

## Item 4 — Rich OG link previews for `/b/<code>`

**Goal.** A `/b/<code>` link unfurls in Discord/Twitter with a generated **hero-vs-hero** image
showing portraits + the four headline numbers, instead of text-only.

**Current.** `/b/[code]/page.tsx` is `dynamic = "force-dynamic"`, decodes via
`resolveBuild(code)` (`:24`) → `{ hero, target, equipped, targetEquipped, result }`, and
`generateMetadata` (`:42`) emits `openGraph: { title, description }` with **no image**. Hero
art comes from `assets-bucket.deadlock-api.com` (`next.config.ts` remotePatterns).

**Design.**
- **Extract** `resolveBuild` (and `loadData`) out of `page.tsx` into a shared module
  `src/app/b/[code]/resolve.ts` (or `src/lib/share-build.ts`) so both `page.tsx` and the new
  OG route import one implementation (avoids a duplicate decode+simulate; tidies the boundary).
- Add **`src/app/b/[code]/opengraph-image.tsx`** using `ImageResponse` from `next/og`
  (1200×630). Layout: attacker portrait + name + level on the left, a center "VS", target
  portrait + name on the right, a bottom band with **Total burst / Sustained DPS / Time to kill
  / Target EHP** (the same values `page.tsx:82–85` already renders), brass/danger accents per
  `style.md`, and a "Fairfax Industries" mark. Set `runtime = "edge"` and `size`/`contentType`
  exports per the Next file convention.
- **Fonts.** `ImageResponse` needs explicit font bytes for custom faces — ship the display
  font (Oswald) TTF in the repo and load it for the image; fall back to the built-in font if a
  fetch fails.
- **Hero images.** Reference `hero.imageUrl` (remote) in the image tree; `ImageResponse` fetches
  them at generation time. Guard a failed fetch with a neutral placeholder so the card still
  renders.
- **Metadata.** With the `opengraph-image` file present, Next injects `og:image` automatically;
  also add `twitter: { card: "summary_large_image" }` to `generateMetadata` so Twitter/Discord
  pick the large card. Keep the existing title/description.
- **Caching.** Output is deterministic per code → cache aggressively (immutable
  `Cache-Control`), matching the OpenNext example's cached-PNG behavior.

**Feasibility (validated).** OpenNext Cloudflare ships an e2e example of `next/og`
`ImageResponse` in an app-router route and confirms correct PNG output + caching on Workers, so
the edge OG route is supported on our deploy target. **Fallback** if the `opengraph-image.tsx`
file convention misbehaves under OpenNext: implement the identical image as an explicit
`app/b/[code]/og/route.tsx` API route (the exact shape the OpenNext example uses) and point
`openGraph.images` at it. Last-resort fallback: a single static branded OG image.

**Files.** New `opengraph-image.tsx`; extracted `resolve.ts`; `generateMetadata` tweak in
`page.tsx`; one font asset added to the repo.

**Edge cases.** Invalid/old code → `resolveBuild` returns null → render a neutral "Build not
found" branded card (don't 500). Very long hero names → clamp/scale text.

---

## Suggested implementation order

1. **Item 3** (one-line default flip) — trivial, ship first.
2. **Item 2** (fire-rate default shots) — small, isolated to scenario state.
3. **Item 1** (HeroPicker) — medium; reusable component that also pays forward to Lane Lab.
4. **Item 4** (OG previews) — medium; fully isolated to the `/b` route; do last/in parallel.

## Verification

- `bun test` (`src/lib/sim/engine.test.ts`) stays green — items 1–3 touch only UI defaults,
  item 4 adds a route; no engine math changes.
- **Manual (`/hideout`):** fresh load shows shots defaulting per hero and target matching level;
  switching heroes updates the shots default until the field is edited, then it stays put;
  clicking either portrait opens the styled grid picker with no native scrollbar; picking a hero
  updates the matchup.
- **Manual (`/b/<code>`):** share a build, open the page, and validate the OG image in a
  Discord/Twitter card validator; confirm `og:image` + `twitter:card` are present.
- **Build/deploy:** confirm the app builds under OpenNext and the OG route renders on a Workers
  preview; confirm the main bundle size is unaffected (OG route is server-only).

## Open questions (resolve at build, not blocking)

- HeroPicker grid dimensions/visual — mockup-driven.
- Whether to show any item icons in the OG card (recommended: heroes + four numbers only, to
  stay legible at OG scale).

## Out of scope (Phase 0)

The imbue-ability native `<select>` (`hideout.tsx:578`) restyle; any empirical-data/counter
features (Phase 1); engine changes.

## Phase 0 outcome (2026-06-26, implemented)

Built subagent-driven on branch `worktree-agent-a1d4d3d8073701962` (9 commits): all four items
shipped; 45/45 tests green; full build compiles; OG route render-verified (200 image/png,
1200×630, both valid and not-found paths). Final whole-branch review: ready to merge, no Critical.

**Accepted decisions:**
- **Fire-rate default** uses the while-hitting rate (see Item 2 decision note) — accepted as-is.
- **OG portraits** ship **names-only** — all hero art is `.webp`, which `next/og`/Satori cannot
  decode, so the `<img>` was dropped (it only fired a wasted remote fetch).

**Fast-follow (logged):** bake **webp→PNG hero portraits at sync time** (use `sharp` in the
GitHub Action — Node, not edge), then reference the baked PNGs in the OG card for real
hero-vs-hero portraits.

**Minor follow-ups (deferred):** explicit return type on `resolveBuild`; HeroPicker
narrow-screen sheet + arrow-key grid nav + scroll-selected-into-view (matters when Lane Lab
reuses it); drop the vestigial `?? 8` shots seed; `onOpenAutoFocus` instead of `autoFocus`.
