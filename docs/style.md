# Fairfax Industries — UI Style Guide

**This is the source of truth for the UI as it is actually built today.** It is captured from the live code (`src/app/globals.css` + the components), not an aspirational redesign brief. When you change a token or establish a new pattern, **update this file in the same change** and keep hex values in sync with `globals.css`. Add notable shifts to the [Changelog](#changelog).

> Not to be confused with [claude-design-handoff.md](claude-design-handoff.md), which is an older, aspirational brief written for an external design tool (it even proposes a different typeface). For "what the UI is right now," trust **this** file.

---

## 0. How styling actually works (read this first)

**All design tokens live in `src/app/globals.css` `:root`** as CSS custom properties. Everything below is defined there; components reference them via `var(--…)`. That file is the single source of truth for values; this doc is the human-readable map.

**Two consumption styles coexist** — match whichever the file you're editing already uses:

| Surface | Files | How it's styled |
|---|---|---|
| Marketing / shell | `src/app/page.tsx`, `src/app/layout.tsx` | **Tailwind v4 utility classes**, mapped to tokens in the `@theme inline` block of `globals.css` (`text-foreground`, `bg-primary`, `border-border`, `font-display`, plus custom utilities `.surface`, `.overline`) |
| The product (build tool + nav) | `src/components/hideout.tsx`, `src/components/buy-menu.tsx`, `src/components/navigation.tsx` | **Inline `style={{}}` objects** referencing `var(--…)` directly. ~95% of the product UI lives here. |

**Guidance for new work:** in the build tool, match the existing inline-style + token pattern; on landing/marketing surfaces, Tailwind utilities are fine. Never hardcode a hex — use a token; if you need a value that doesn't exist, add it to `globals.css` and document it here.

**Responsive pattern:** inline styles can't hold media queries, so the build tool reads a `useIsNarrow(max = 768)` hook (`src/lib/use-narrow.ts`, a `matchMedia` wrapper, SSR-safe / desktop-first) and swaps the few **layout-defining** style objects to stacked variants on narrow viewports (`hideout.tsx`, `buy-menu.tsx`, `navigation.tsx`). Keep leaf/visual inline styles as-is; only branch the containers (grid columns, flex direction/wrap, the big burst number size). On the marketing shell (`layout.tsx`/`page.tsx`), Tailwind responsive prefixes (`sm:`) are fine instead.

**Installed but NOT wired up** (don't assume they're in use): shadcn/ui (config only — there is no `src/components/ui`), `radix-ui`, `framer-motion`, `class-variance-authority`, and the `cn()` helper in `src/lib/utils.ts`. Functional icons come from `lucide-react` (currently only `ArrowRight`, on the landing page).

---

## 1. Brand & aesthetic

Fairfax Industries is a community Deadlock theorycrafting tool. The world is **1940s Art-Deco, occult-noir New York** — brass, aged paper, lit display cases, stamped slab type. "Fairfax" is the in-game weapon-shop brand, so the UI can pose as a canonical extension of the in-game armory.

- **Mood:** warm matte noir. Dark, warm charcoal surfaces (never pure black), a single brass brand accent, and the item shop rendered as a **warm parchment "armory" panel** against the dark frame.
- **Numbers are the hero.** This is a calculator — big, confident, tabular figures in the display face are the centerpiece (e.g. the burst total).
- **Wordmark:** a small brass diamond ◆ + `FAIRFAX` (Oswald 700, tracked) + `Industries` (tiny, letterspaced caps). See `navigation.tsx`.

---

## 2. Color tokens

All values are from `globals.css`. Grouped by role.

### Base & surfaces
| Token | Hex | Use |
|---|---|---|
| `--background` | `#1a1917` | Page base — warm charcoal, never pure black |
| `--foreground` | `#e9e5dc` | Default text |
| `--surface` (`--ink-820`) | `#211f1c` | Cards / panels |
| `--surface-raised` (`--ink-780`) | `#262320` | Raised elements, inputs, tiles |
| `--surface-hover` (`--ink-740`) | `#2b2824` | Hover state |
| `--surface-well` (`--ink-870`) | `#1d1b18` | Recessed wells, empty slots |
| Ink scale | `--ink-950 #141311` → `--ink-600 #4a443c` | Full neutral ramp for layering |

### Brass — brand / primary
| Token | Hex | Use |
|---|---|---|
| `--primary` / `--brass-500` | `#c89b5c` | Primary actions, brand accent, focus `--ring` |
| `--brass-300` | `#e4c389` | Bright brass — big numbers, emphasis |
| `--brass-200 … 700` | `#f0d8ab … #846032` | Brass ramp |
| `--brass-glow` | `rgba(200,155,92,0.22)` | Glow `textShadow`/`boxShadow` behind brass numbers |
| `--primary-foreground` | `#1a1917` | Text on brass fills |

### Category colors — **semantically load-bearing**
Weapon / Vitality / Spirit are used everywhere to color-code items, abilities, chips, and loadout frames. Each has a base, 400/500/600 steps, a translucent `tint` (fills) and `frame` (borders).

| Category | Base | 400 (text) | 500 | tint | frame |
|---|---|---|---|---|---|
| **Weapon** (amber) | `--weapon #d98841` | `#e49b5c` | `#d98841` | `rgba(217,136,65,0.13)` | `rgba(217,136,65,0.42)` |
| **Vitality** (green) | `--vitality #7faf5a` | `#97c172` | `#7faf5a` | `rgba(127,175,90,0.13)` | `rgba(127,175,90,0.42)` |
| **Spirit** (purple) | `--spirit #9b8ad6` | `#b3a4e4` | `#9b8ad6` | `rgba(155,138,214,0.14)` | `rgba(155,138,214,0.45)` |

> ⚠️ Category meaning is currently carried by **hue alone** — pair color with a text/icon label for accessibility (see §9).

### Currency, danger, accents
| Token | Hex | Use |
|---|---|---|
| `--cash-500` | `#6fae5e` | **Souls / cost** (distinct green; the `§` symbol). Pill: `--cash-pill-bg #2c4a31`, `--cash-pill-fg #ece3c7`, `--cash-pill-bd #1d3322` |
| `--danger-500` | `#c5503e` | The **Target** side / "sell" / destructive emphasis |
| `--destructive` | `#c0564a` | Tailwind destructive token |
| `--accent` | `#8aa46b` | Patina green — use **sparingly** |
| `--muted-foreground` | `#918c81` | Tailwind muted text |

### Parchment — the buy-menu "armory" surface
The shop (`buy-menu.tsx`) breaks from the dark theme into warm paper.
| Token | Hex | Use |
|---|---|---|
| `--parch-300 / -400` | `#d3c197 / #c2ad7e` | Paper base (via `--tex-parchment` gradient) |
| `--parch-ink` | `#2c2316` | Text on parchment |
| `--parch-ink-soft` | `#6a5634` | Secondary text on parchment |
| `--parch-line` | `#9a8254` | Hairlines on parchment |
| `--parch-frame` | `#4a3d24` | Frame / deco corners |
| `--tex-parchment` | gradient | The paper fill (radial highlights + linear base) |

### Text & hairlines
| Token | Hex / value | Use |
|---|---|---|
| `--text` (`--paper-50`) | `#e9e5dc` | Primary text |
| `--text-muted` (`--paper-400`) | `#918c81` | Secondary text (passes AA ≈ 4.6:1) |
| `--text-dim` (`--paper-500`) | `#88837a` | Faint/secondary labels. Raised from `#75716a` → now ≈4.66:1 on `--background` (passes AA); still dimmer than `--text-muted` |
| `--border` / `--line` | `rgba(233,229,220,0.10)` | Default hairline |
| `--border-strong` / `--line-strong` | `rgba(233,229,220,0.16)` | Stronger divider |
| `--line-soft` | `rgba(233,229,220,0.06)` | Faintest inset line |
| `--border-brass` / `--line-brass` | `rgba(200,155,92,0.30)` | Brass-tinted border |

---

## 3. Typography

Loaded via Google Fonts `@import` in `globals.css` (not `next/font`).

| Token | Family | Role |
|---|---|---|
| `--font-oswald` | **Oswald** | Display, headings, **all numerics**, labels, wordmark. Condensed, stamped, uppercase-friendly. |
| `--font-archivo` | **Archivo** | Body / UI text. |
| `--font-numeric` | Oswald | All numbers — always with `fontVariantNumeric: "tabular-nums"`. |

**Conventions**
- **Headings** (`h1–h6` and `SectionHead`): Oswald 600, **UPPERCASE**, letter-spacing ~`0.04–0.08em`.
- **Section head** pattern: Oswald 600, 15px, uppercase, `0.08em`.
- **Overline labels** (`.overline` / inline): 10–11px, `0.1–0.2em` tracking, uppercase, `--text-dim`/`--text-muted`.
- **Big number** (e.g. burst total): Oswald 600, ~74px, `--brass-300`, `textShadow: 0 0 36px var(--brass-glow)`, tabular-nums.
- **Body:** Archivo, sentence case. Reserve ALL-CAPS for overlines, section heads, and the wordmark.

> The old handoff proposed Fraunces + Inter — that was never implemented. The shipped type system is **Oswald + Archivo**.

---

## 4. Spacing, radii, layout

**Radii** (`--r-*`): `xs 3px` · `sm 5px` · `md 8px` · `lg 12px` · `xl 16px` · `pill 999px`. Base `--radius: 0.5rem`. Panels use `--r-lg`; controls/tiles use `--r-sm`/`--r-md`.

**Layout**
- `--page-max: 1240px` — main content max width; `<main>` is `mx-auto w-full px-6 py-10`.
- `--nav-h: 60px` — sticky top nav height.
- Build-tool vertical rhythm: **16px** gaps between major sections; **18px** panel padding.
- Landing rhythm: `space-y-20` between sections.

---

## 5. Elevation & texture

| Token | Use |
|---|---|
| `--elev-card` | `inset 0 1px 0 rgba(233,229,220,0.05), 0 1px 2px rgba(0,0,0,0.35)` — resting cards |
| `--elev-pop` | `inset 0 1px 0 rgba(233,229,220,0.08), 0 18px 50px -16px rgba(0,0,0,0.72)` — tooltips/popovers |
| `--board-bg` | dark radial vignette for board-like backgrounds |
| `--tex-parchment` | the parchment fill (shop) |
| body background | radial **brass glow** at top-center over `--background` |

Elevation comes from **lighter surfaces + hairlines + the occasional inset highlight**, not heavy drop shadows. Scrollbars are slim (8px) with a translucent thumb.

---

## 6. Component patterns (recipes)

Canonical patterns already in the code — reuse them rather than inventing new ones. File references point at the live implementation.

- **Panel / card** — `background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg)`; optional `boxShadow: inset 0 1px 0 var(--line-soft)`. (`hideout.tsx`)
- **Section head** — `SectionHead`: Oswald 600, 15px, uppercase, `0.08em`, optional right-side slot.
- **Stat readout** — `StatReadout`: tiny uppercase dim label over an Oswald tabular number; `accent` variant = larger, `--brass-300`, brass glow.
- **Burst chip** — `BurstChip`: small padded pill, category-toned via `CHIP_TONES` (`{fg,bg,bd}` for weapon/vitality/spirit/brass); shows a label (with optional `×count`) over a value.
- **Buttons**
  - *Primary (brass):* `background: var(--primary); color: var(--primary-foreground); border-radius: var(--r-md)`, hover `opacity .9`. (landing CTA)
  - *Toggle / segmented:* bordered; active state uses `color-mix(in srgb, <accent> 16%, transparent)` fill + an inset bottom border in the accent; Oswald, uppercase, small. (`MatchLevelButton`, `BuyForToggle`, category tabs)
  - *Share/copy:* uppercase Oswald; success state flips border/text to `--cash-500`. (`ShareBuildButton`)
- **Tooltip / popover** — `position: fixed`, follows cursor, `background: linear-gradient(180deg, var(--ink-820), var(--ink-870))`, `border: 1px solid var(--{category}-frame)`, `--r-md`, `boxShadow: var(--elev-pop)`, a 3px category color bar on top, `pointerEvents: none`. (`ItemTooltip`, `MiniStat` tip)
- **Select** — custom wrapper (`surface-raised` + `border-strong` + `--r-sm`) around a native `<select>`, with a category-colored diamond `◆`. (`HeroSelect`)
- **Cost pill** — `§` glyph in `--cash-500` + tabular number, on `--cash-pill-*`. (`CostPill`)
- **Loadout grid** — fixed square slots; empty = `1px dashed var(--border-strong)` on `--surface-well`; filled = `--surface-raised` + category `frame` border + a category-colored bottom bar. (`CompactLoadout`)
- **Hero portrait** — square image, `--r-md`, `border-strong`, optional level badge (`--ink-820` pill, `--border-brass`, `--brass-400` number). (`HeroPortrait`)
- **Deco corners** — four L-shaped brackets in `--parch-frame`; an Art-Deco motif framing the shop. (`DecoCorners`)
- **Buy menu / parchment shop** — `--tex-parchment` section, `--parch-frame` border, deco corners, category tabs (active = inset underline), **tier quadrants** (Tier 4 rendered dark with an "EXPERTS" tag), 64px item tiles, `--parch-ink` text. (`buy-menu.tsx`)
- **Item details (dual-mode)** — one shared `ItemDetailsBody` renders item stats; on hover/keyboard-focus devices it's shown in the cursor-following `ItemTooltip` (pointerEvents none) and a click buys directly; on touch (`useCanHover()` false) a tap opens `ItemSheet` — a modal (backdrop + dark panel, category top bar, Escape/backdrop to close) with an explicit Buy/Sell button. New detail surfaces should follow this hover-or-tap split. (`buy-menu.tsx`)

---

## 7. Iconography & decorative motifs

- **Functional icons:** `lucide-react` (currently only `ArrowRight`). Prefer lucide for any new functional icon.
- **Decorative glyphs (unicode/CSS, not an icon set):** brass diamond `◆` / rotated square (wordmark, select accents), `§` for souls, `⌕` for search, `⎘`/`✓` for copy, and the L-shaped Art-Deco corner brackets.
- **Item & hero art** comes from the deadlock-api CDN (`assets-bucket.deadlock-api.com`) via `next/image` with explicit `width`/`height` (lazy by default, no CLS). The host is whitelisted in `next.config.ts` under `images.remotePatterns`; add new image hosts there. Don't reintroduce raw `<img>`.

---

## 8. Motion

CSS transitions only — short and quiet (`opacity` / `background` / `transform`, ~`120ms`). `framer-motion` is a dependency but **unused**; don't reach for it without a real need. Keep motion subtle; the product should feel precise, not animated.

---

## 9. Accessibility — known gaps (fix forward, don't repeat)

Documented honestly so new components don't inherit these:

1. **Contrast:** ~~`--text-dim` (`#75716a`) ≈ 3:1, fails AA~~ — **resolved:** `--text-dim` raised to `#88837a` (≈4.66:1 on `--background`, passes AA). It's still the dimmest text token; don't go fainter than this for anything that must be read.
2. **Color-only meaning:** weapon/vitality/spirit hue is now paired with text where it stood alone — shop category **tabs** carry the category word, burst **chips** and resist labels are text-described, and **ability rows** show a category tag. Still color-only: the small loadout/shop **tile frames** (category is named in the item details tooltip/sheet). Keep pairing color with text/shape on new surfaces. (Tracked: §7.1b.)
3. **Hover-only details:** ~~tooltips are cursor-driven with `pointerEvents: none`~~ — **resolved for the shop:** tiles now show details on keyboard `focus` and open the `ItemSheet` on touch (see §6). Apply the same hover-or-tap split to any new detail surface.

**Target:** WCAG 2.1 AA. New work should meet it even though existing code doesn't everywhere yet.

---

## 10. Voice & copy

Sentence case, terse, confident, editorial. ALL-CAPS only for overlines, section heads, and the wordmark. Let the numbers carry the drama — present them large in Oswald tabular figures. Brand wordmark is always `FAIRFAX` + `Industries`.

---

## Changelog

- **2026-06-25** — Feature-requests batch (FR-1…FR-8): build **progression panel** (ordered buy-order timeline + level checkpoints via `levelFromSouls`; click a step to preview the partial build without touching the live calc; reorder with arrows; order travels in the share code) — FR-1 flagship; sprint/stamina movement stats on the attacker readout; `MiniStat` hover-intent delay (~350ms); DoT copy/layout cleanup; bought-item readability fix (non-color "owned" ✓ badge + contrast-safe label); smaller VS-band avatars (80→64); hero pages now `/heroes/<slug>` (numeric back-compat) with a per-ability stat table; item browser searches descriptions + shows fuller text. (Compare UX rework handled concurrently in a sibling change.)
- **2026-06-25** — Wave 4 (execution plan): hero pages (`/heroes`, `/heroes/[id]`) + item browser (`/items`); shareable build pages (`/b/[code]`, server-decoded + crawlable, with `generateMetadata`); A/B build compare (lock build A → assemble an empty build B; the Compare button expands/minimizes without discarding either; A|B tabs swap which you edit; bar-graph deltas with green/red +/− plus defensive stats — additive); patch-stable share codes (name-hash, V1 back-compat); engine depth (procs folded into sustained DPS; melee surfaced); patch-history snapshots + `/patch-notes`; hard 12-item loadout cap. Nav gained Heroes/Items; footer links Methodology + Patch notes.
- **2026-06-25** — Wave 2 (execution plan): footer **data-freshness badge** (from `max(heroes.updatedAt)`); a `/methodology` page + a "How this is calculated" disclosure in the Damage panel; first-run **onboarding card** (localStorage-dismissed) and reusable **`InfoDot`** glossary popovers on stat labels; a transient **merge toast** when item upgrades collapse components; **`--text-dim` raised to AA** and category text labels added (resolves a11y gaps #1 and most of #2).
- **2026-06-25** — Wave 1 (execution plan): build tool made responsive via the `useIsNarrow` hook (containers stack ≤768px); all art moved to `next/image` (CDN whitelisted in `next.config.ts`, kills CLS); added the touch `ItemSheet` + keyboard-focus details path and `aria-pressed`/`aria-label` on shop and loadout controls. Resolves a11y gap #3 for the shop.
- **2026-06-25** — Initial style guide captured from the current implementation (warm matte noir + parchment armory; Oswald/Archivo; token system in `globals.css`). Supersedes `claude-design-handoff.md` as the description of the *current* UI.
