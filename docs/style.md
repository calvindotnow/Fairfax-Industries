# Fairfax Industries — UI Style Guide

**This is the source of truth for the UI as it is actually built today.** It is captured from the live code (`src/app/globals.css` + the components), not an aspirational redesign brief. When you change a token or establish a new pattern, **update this file in the same change** and keep hex values in sync with `globals.css`. Add notable shifts to the [Changelog](#changelog).

> Companion docs: [features.md](features.md) (what's shipped + planned) and [bugs.md](bugs.md) (known issues). This file covers the *look* — "what the UI is right now."

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
| `--danger-500` | `#d96452` | The **Target** side / "sell" / destructive emphasis. Lightened from `#c5503e` (2026-07-04) — the old value read ~3.6–3.8:1 as text on `--surface`/`--background`/the dark tooltip gradient (fails AA) everywhere it's used as text (Target side label, "Click to sell", compare-panel red deltas, execute-window label). New value clears 4.5:1 on all of those (`--surface` 4.61:1, `--background` 4.93:1, tooltip gradient 4.72:1) |
| `--destructive` | `#c0564a` | Tailwind destructive token |
| `--accent` | `#8aa46b` | Patina green — use **sparingly** |
| `--muted-foreground` | `#918c81` | Tailwind muted text |

### Parchment — the buy-menu "armory" surface
The shop (`buy-menu.tsx`) breaks from the dark theme into warm paper.
| Token | Hex | Use |
|---|---|---|
| `--parch-300 / -400` | `#d3c197 / #c2ad7e` | Paper base (via `--tex-parchment` gradient) |
| `--parch-ink` | `#2c2316` | Text on parchment |
| `--parch-ink-soft` | `#4a3c24` | Secondary text on parchment. Darkened from `#6a5634` (2026-07-04) — the old value read ~3.0–4.3:1 depending on the exact parchment sub-surface (header, search-bar tint, light tier quadrant), failing AA's 4.5:1 body-text minimum everywhere it's used (shop subtitle, "Buying for" label, item tile labels, search icon). New value clears 4.5:1 on the darkest real case (the search-bar tint, ≈4.58:1) and further on the rest |
| `--parch-line` | `#9a8254` | Hairlines on parchment |
| `--parch-frame` | `#4a3d24` | Frame / deco corners |
| `--tex-parchment` | gradient | The paper fill (radial highlights + linear base) |

### Text & hairlines
| Token | Hex / value | Use |
|---|---|---|
| `--text` (`--paper-50`) | `#e9e5dc` | Primary text |
| `--text-muted` (`--paper-400`) | `#918c81` | Secondary text (passes AA ≈ 4.6:1) |
| `--text-dim` (`--paper-500`) | `#8f8a81` | Faint/secondary labels. Raised `#75716a` → `#88837a` → `#8f8a81` (2026-07-04): the earlier value passed AA only on `--background` (4.66:1) but fell to ~4.15:1 on `--surface-raised`, the most common real background for `--text-dim` labels (ability rows, stat readouts, counter rows). New value clears 4.5:1 on every surface it's actually used on (`--background` 5.12:1, `--surface` 4.79:1, `--surface-raised` 4.55:1, `--surface-well` 5.01:1, buy-menu dark tier quadrant 5.36:1); still dimmer than `--text-muted` |
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
- **Animated number** — `RollingNumber` (`rolling-number.tsx`): wrap a formatted stat string; it plays a debounced `num-pop` rise + de-blur when the value settles. Use for live-updating figures (burst total, `StatReadout`, `OverviewStat`, compare column). See §8.
- **Slot-text label** — `SlotText` (`slot-text.tsx`): per-character "slot machine" roll when a label swaps; on the copy-build-link button. See §8.
- **Buttons**
  - *Primary (brass):* `background: var(--primary); color: var(--primary-foreground); border-radius: var(--r-md)`, hover `opacity .9`. (landing CTA)
  - *Toggle / segmented:* bordered; active state uses `color-mix(in srgb, <accent> 16%, transparent)` fill + an inset bottom border in the accent; Oswald, uppercase, small. (`MatchLevelButton`, `BuyForToggle`, category tabs). **Tab sets** (`OverviewTabs` underline, `BuildTabs` pill) animate the active marker with a sliding indicator (`useTabIndicator`, see §8).
  - *Share/copy:* uppercase Oswald; label + icon animate via the **slot-text roll** (`SlotText`) on copy ("Copy build link" → "Link copied", ⎘→✓); success state flips border/text to `--cash-500`. (`ShareBuildButton`)
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

**Shared motion tokens** (in `globals.css` `:root`): `--motion-fast: 120ms` (color/border state changes), `--motion-base: 240ms` (entrances, slides, the number pop), and `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)` — the shared easing curve, originally the slot-text roll curve. Use these rather than hardcoding durations so micro-interactions feel like one system.

The vocabulary is **pure CSS** — transitions plus one keyframe (`num-pop`). `framer-motion` is still installed but **unused**; the motions below are hand-rolled and don't need it, so don't reach for it without a real new need. Keep motion subtle and purposeful — the product should feel precise and *reactive* (numbers respond to your edits), not decorative.

Shipped motions:
- **State transitions** — short `transition:` on `color` / `background` / `border` (`--motion-fast`) on chips, buttons, tabs. The baseline everywhere.
- **Slot-text roll** — `SlotText` (`src/components/slot-text.tsx`): a per-character "slot machine" roll when a label swaps. On the copy-build-link button ("Copy build link" ⟷ "Link copied", icon ⎘⟷✓). Pure CSS transforms, no external stylesheet, debounced via `requestAnimationFrame`.
- **Number pop** — `RollingNumber` (`src/components/rolling-number.tsx`): stat readouts rise + de-blur (the `num-pop` keyframe, `--motion-base`) when their value settles to a new number. Debounced so dragging a slider scrubs the number live instead of strobing the blur; never pops on initial load. Wired into the burst total, `StatReadout`, `OverviewStat`, and the active column of `CompareRow`.
- **Sliding tab indicator** — `OverviewTabs` (underline) and `BuildTabs` (A/B pill) slide to the active tab via a shared `useTabIndicator` hook (`hideout.tsx`): it measures the active button's box and lets CSS transition `left` / `width`. Replaces the old instant border/background swap.

**Reduced motion:** a global `@media (prefers-reduced-motion: reduce)` rule in `globals.css` neutralizes all transitions, animations, and the slot-text roll. New motion inherits this floor automatically — no per-component handling needed.

---

## 9. Accessibility — known gaps (fix forward, don't repeat)

Documented honestly so new components don't inherit these:

1. **Contrast:** ~~`--text-dim` (`#75716a`) ≈ 3:1, fails AA~~ — **resolved (2026-06-25):** raised to `#88837a` (≈4.66:1 on `--background`). **Re-resolved (2026-07-04):** that value still failed AA (~4.15:1) on `--surface-raised`, the token's most common real background — raised again to `#8f8a81` (clears 4.5:1 on every surface it's actually used against; see §2). Two more sub-AA cases found and fixed the same day: **`--parch-ink-soft`** (`#6a5634`, secondary text on the parchment shop) read ~3.0–4.3:1 depending on the exact parchment sub-surface — darkened to `#4a3c24`. **`--danger-500`** (`#c5503e`, used as text for the Target label / "Click to sell" / compare deltas / execute-window label) read ~3.6–3.8:1 on its real dark backgrounds — lightened to `#d96452`. One **site-level** fix: the buy-menu's "Actives N/4" cap warning rendered `--weapon-500` text directly on parchment (≈1.4–1.7:1, a severe fail) — the warning is now carried by the weapon-toned border + tint background only; the text itself uses `--parch-ink` (the high-contrast parchment ink). It's still the dimmest text token; don't go fainter than this for anything that must be read.
2. **Color-only meaning:** weapon/vitality/spirit hue is now paired with text where it stood alone — shop category **tabs** carry the category word, burst **chips** and resist labels are text-described, and **ability rows** show a category tag. Still color-only (audited 2026-07-04, left as-is — a bigger visual change than this pass's scope): the small loadout/shop **tile frames** (category is named in the item details tooltip/sheet, and the item name is always available via `title`/`aria-label`). Keep pairing color with text/shape on new surfaces. (Tracked: §7.1b.)
3. **Hover-only details:** ~~tooltips are cursor-driven with `pointerEvents: none`~~ — **resolved for the shop:** tiles now show details on keyboard `focus` and open the `ItemSheet` on touch (see §6). **Resolved 2026-07-04 for the VS-band mini-stats:** `MiniStat` (Bullet res / Spirit res / Sprint / Stamina, etc.) previously opened its tooltip on `onMouseEnter` only, with no keyboard path at all — it's now focusable (`tabIndex`), opens on `onFocus`/closes on `onBlur`, and exposes the tip via `aria-label` for screen readers (`role="note"`) instead of relying on the visual popover alone. Apply the same hover-or-tap/focus split to any new detail surface.
4. **Keyboard operability:** audited 2026-07-04 across the shop, ability rows, tier pips, scenario/stack/actives chips, lens tabs, A/B tabs, hero picker, and the progression scrubber. Two real gaps found and fixed: the **progression-panel** checkpoint row was `role="button" aria-pressed` with no `tabIndex`/`onKeyDown` — completely unreachable by keyboard; it's now a real tab stop with Enter/Space activation. The **shop item tiles** (and a few inputs — the shop search box, the burst `NumberField`) set `outline: none` for a custom look with nothing to replace it, so a keyboard user tabbing to them saw no focus indicator at all. Fixed globally: a `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }` rule in `globals.css` gives every interactive control a visible brass ring on keyboard focus (mouse clicks don't trigger `:focus-visible`, so it doesn't add visual noise to pointer use). Everything else already worked — ability rows, tier pips, scenario chips, category tabs, the hero picker (Radix `Popover`), and A/B tabs were already native `<button>`s or had `tabIndex`/`onKeyDown` wired.
5. **ARIA:** the Damage/Vitality/Spirit lens switcher (`OverviewTabs`) used `aria-pressed` on plain buttons, which is the right pattern for a *toggle* but not for tabs that swap which content panel is shown. Converted to the standard tabs pattern: `role="tablist"`/`role="tab"`/`aria-selected`/`aria-controls`, a matching `role="tabpanel"` wrapper per panel, roving `tabIndex` (only the active tab is a tab stop), and Left/Right/Home/End arrow-key navigation per the ARIA APG. `BuildTabs` (the A/B compare switch) was deliberately left on `aria-pressed` — it's a segmented toggle (which build you're editing), not a set of content panels, so `aria-pressed` is the correct role there, not `role="tab"`.
6. **Reduced motion:** handled globally — a `prefers-reduced-motion: reduce` floor in `globals.css` neutralizes transitions, animations, and the slot-text roll. New motion inherits it automatically; don't hand-roll per-component guards.

**Target:** WCAG 2.1 AA. New work should meet it even though existing code doesn't everywhere yet.

---

## 10. Voice & copy

Sentence case, terse, confident, editorial. ALL-CAPS only for overlines, section heads, and the wordmark. Let the numbers carry the drama — present them large in Oswald tabular figures. Brand wordmark is always `FAIRFAX` + `Industries`.

---

## Changelog

- **2026-07-04** — Accessibility completion pass (Track A3): full contrast audit found and fixed three more sub-AA tokens beyond the earlier `--text-dim` fix — `--text-dim` itself re-raised (`#88837a`→`#8f8a81`, the prior value still failed on `--surface-raised`), `--parch-ink-soft` darkened (`#6a5634`→`#4a3c24`, was failing on every parchment sub-surface it's used on), `--danger-500` lightened (`#c5503e`→`#d96452`, was failing everywhere it's used as text). One site-level contrast fix: the buy-menu "Actives N/4" cap label no longer renders `--weapon-500` text on parchment (was ≈1.4:1) — the border/tint still carries the warning color, text uses `--parch-ink`. Keyboard: added a global `:focus-visible` ring (`globals.css`, using `--ring`) so controls that set `outline:none` for a custom look (shop tiles, search/number inputs) still show a visible keyboard focus indicator; made the progression-panel checkpoint row a real tab stop (`tabIndex` + Enter/Space, previously `role="button"` with no keyboard path at all); made `MiniStat` (VS-band mini stats) focusable so its tooltip opens on keyboard focus, not just mouse hover. ARIA: converted the Damage/Vitality/Spirit lens switcher to proper tabs semantics (`role="tablist"/"tab"`, `aria-selected`, `aria-controls`, matching `tabpanel`s, roving tabindex, arrow-key nav) since it swaps content panels rather than toggling a single control. Color-independence and the `BuildTabs` `aria-pressed` pattern were audited and left as-is (already adequate / correctly scoped). (§2, §9.)
- **2026-06-26** — Motion pass: shared motion tokens (`--motion-fast` / `--motion-base` / `--ease-out`) + a `num-pop` keyframe in `globals.css`. Three micro-interactions, all pure-CSS (no `framer-motion`): **slot-text copy roll** (`SlotText`) on the share button; **number pop** (`RollingNumber`, debounced) on the burst total + stat readouts + active compare column; **sliding tab indicators** on `OverviewTabs`/`BuildTabs` via `useTabIndicator`. Added a global `prefers-reduced-motion` floor that also covers the existing transitions. (§6, §8, §9.4.)
- **2026-06-25** — Feature-requests batch (FR-1…FR-8): build **progression panel** (ordered buy-order timeline + level checkpoints via `levelFromSouls`; click a step to preview the partial build without touching the live calc; reorder with arrows; order travels in the share code) — FR-1 flagship; sprint/stamina movement stats on the attacker readout; `MiniStat` hover-intent delay (~350ms); DoT copy/layout cleanup; bought-item readability fix (non-color "owned" ✓ badge + contrast-safe label); smaller VS-band avatars (80→64); hero pages now `/heroes/<slug>` (numeric back-compat) with a per-ability stat table; item browser searches descriptions + shows fuller text. (Compare UX rework handled concurrently in a sibling change.)
- **2026-06-25** — Wave 4 (execution plan): hero pages (`/heroes`, `/heroes/[id]`) + item browser (`/items`); shareable build pages (`/b/[code]`, server-decoded + crawlable, with `generateMetadata`); A/B build compare (lock build A → assemble an empty build B; the Compare button expands/minimizes without discarding either; A|B tabs swap which you edit; bar-graph deltas with green/red +/− plus defensive stats — additive); patch-stable share codes (name-hash, V1 back-compat); engine depth (procs folded into sustained DPS; melee surfaced); patch-history snapshots + `/patch-notes`; hard 12-item loadout cap. Nav gained Heroes/Items; footer links Methodology + Patch notes.
- **2026-06-25** — Wave 2 (execution plan): footer **data-freshness badge** (from `max(heroes.updatedAt)`); a `/methodology` page + a "How this is calculated" disclosure in the Damage panel; first-run **onboarding card** (localStorage-dismissed) and reusable **`InfoDot`** glossary popovers on stat labels; a transient **merge toast** when item upgrades collapse components; **`--text-dim` raised to AA** and category text labels added (resolves a11y gaps #1 and most of #2).
- **2026-06-25** — Wave 1 (execution plan): build tool made responsive via the `useIsNarrow` hook (containers stack ≤768px); all art moved to `next/image` (CDN whitelisted in `next.config.ts`, kills CLS); added the touch `ItemSheet` + keyboard-focus details path and `aria-pressed`/`aria-label` on shop and loadout controls. Resolves a11y gap #3 for the shop.
- **2026-06-25** — Initial style guide captured from the current implementation (warm matte noir + parchment armory; Oswald/Archivo; token system in `globals.css`).
