# Phase 0 — Polish + OG Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four independent, high-value polish items — a styled hero picker, fire-rate-aware default shots, default-on target level-matching, and rich OG link previews for `/b/<code>`.

**Architecture:** Items 1–3 are client-side changes in `src/components/hideout.tsx`, with pure logic extracted to a small tested `src/lib/hideout-utils.ts`. The hero picker is a new component on the already-installed `radix-ui` Popover. Item 4 adds a `next/og` `ImageResponse` route under the existing `/b/[code]` segment, sharing one decode/sim helper (`resolve.ts`) with the page. No damage-engine math changes.

**Tech Stack:** Next.js 16.2.9, React 19.2.3, `radix-ui` 1.4.3, `next/og`, Bun (`bun test`, `bun run build`), deploy via OpenNext → Cloudflare Workers.

## Global Constraints

- **No engine math changes** in Phase 0 — `src/lib/sim/engine.ts` damage logic stays untouched.
- **Share-code format unchanged** — `src/lib/build-code.ts` is not modified.
- **"Proving Ground" must never appear** in UI, routes, filenames, or docs (retired name).
- **No new runtime DB / no auth** — the app stays static/edge; the OG route is server/edge-only.
- **Respect reduced-motion** and follow `docs/style.md` UI conventions (surfaces, fonts, radii).
- **`next/og` JSX uses inline styles only** with literal hex colors (no CSS vars / Tailwind); every element with more than one child MUST set `display: "flex"` (Satori requirement).
- **Tests:** pure logic via `bun test`; UI/image work via `bun run lint` + `bun run build` + manual checks (the repo has **no** component-test harness — do not add one).
- **Commits** end with the footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

### Resolved palette (for the OG image inline styles)

`bg #1a1917` · `surface #211f1c` · `text #e9e5dc` · `muted #918c81` · `brass-300 #e4c389` · `brass-400 #d6ab6e` · `danger-500 #c5503e` · `cash-500 #6fae5e` · `border-strong rgba(233,229,220,0.16)`

---

## File Structure

- `src/lib/hideout-utils.ts` (**create**) — pure helpers: `defaultShotsForFireRate`, `secondsOfFire`, `filterHeroes`.
- `src/lib/hideout-utils.test.ts` (**create**) — `bun test` unit tests for the above.
- `src/components/hero-picker.tsx` (**create**) — `HeroPicker` Popover component (portrait-grid + search).
- `src/components/hideout.tsx` (**modify**) — matchTargetLevel default; shots default + time label; swap `HeroSelect` → `HeroPicker` with portrait triggers; delete unused `HeroSelect`.
- `src/app/globals.css` (**modify**) — `.hero-picker-grid` custom-scrollbar rules.
- `src/app/b/[code]/resolve.ts` (**create**) — extracted `loadData` + `resolveBuild`.
- `src/app/b/[code]/resolve.test.ts` (**create**) — `bun test` for `resolveBuild`.
- `src/app/b/[code]/page.tsx` (**modify**) — import `resolveBuild` from `./resolve`; add Twitter card meta.
- `src/app/b/[code]/opengraph-image.tsx` (**create**) — dynamic OG image.

---

## Task 1: Default the target to matching level

**Files:**
- Modify: `src/components/hideout.tsx:92`

**Interfaces:**
- Consumes: nothing.
- Produces: behavior change only (no exported symbols).

- [ ] **Step 1: Flip the default**

In `src/components/hideout.tsx:92`, change:

```tsx
const [matchTargetLevel, setMatchTargetLevel] = useState(initialBuild?.matchTargetLevel ?? false);
```

to:

```tsx
const [matchTargetLevel, setMatchTargetLevel] = useState(initialBuild?.matchTargetLevel ?? true);
```

- [ ] **Step 2: Lint + build**

Run: `bun run lint && bun run build`
Expected: no new errors.

- [ ] **Step 3: Manual check**

Run `bun run dev`, open `/hideout`. Confirm the target's "match level" control reads **active** by default, and the target level tracks the attacker's level as you buy attacker items. Open a previously-shared `?b=` link and confirm it still honors its stored value (toggle off → off).

- [ ] **Step 4: Commit**

```bash
git add src/components/hideout.tsx
git commit -m "Default enemy target to matching attacker level

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure hideout helpers (TDD)

**Files:**
- Create: `src/lib/hideout-utils.ts`
- Test: `src/lib/hideout-utils.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FIRE_WINDOW_SECONDS: number` (= 1.5)
  - `defaultShotsForFireRate(fireRate: number): number`
  - `secondsOfFire(shots: number, fireRate: number): number`
  - `filterHeroes<T extends { name: string }>(heroes: T[], query: string): T[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/hideout-utils.test.ts`:

```ts
import { test, expect } from "bun:test";
import { defaultShotsForFireRate, secondsOfFire, filterHeroes } from "./hideout-utils";

test("defaultShotsForFireRate is ~1.5s of fire, min 1", () => {
  expect(defaultShotsForFireRate(6.67)).toBe(10); // 6.67 * 1.5 = 10.005 → 10
  expect(defaultShotsForFireRate(1)).toBe(2);      // 1.5 → 2
  expect(defaultShotsForFireRate(10)).toBe(15);
  expect(defaultShotsForFireRate(0)).toBe(1);      // floor
  expect(defaultShotsForFireRate(-3)).toBe(1);
});

test("secondsOfFire inverts shots / fireRate, 0 when no fire rate", () => {
  expect(secondsOfFire(15, 10)).toBeCloseTo(1.5);
  expect(secondsOfFire(5, 0)).toBe(0);
});

test("filterHeroes: case-insensitive substring; empty query returns all", () => {
  const hs = [{ name: "Seven" }, { name: "Warden" }, { name: "Lash" }];
  expect(filterHeroes(hs, "")).toHaveLength(3);
  expect(filterHeroes(hs, "se").map((h) => h.name)).toEqual(["Seven"]);
  expect(filterHeroes(hs, "AR").map((h) => h.name)).toEqual(["Warden"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/hideout-utils.test.ts`
Expected: FAIL — `Cannot find module './hideout-utils'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/hideout-utils.ts`:

```ts
/** Length of the default burst window, in seconds. Tunable in one place. */
export const FIRE_WINDOW_SECONDS = 1.5;

/** Shots that fit in ~1.5s of fire at the given (items-included) fire rate. Min 1. */
export function defaultShotsForFireRate(fireRate: number): number {
  if (!Number.isFinite(fireRate) || fireRate <= 0) return 1;
  return Math.max(1, Math.round(fireRate * FIRE_WINDOW_SECONDS));
}

/** Seconds of fire that `shots` represents at `fireRate`. 0 when fireRate <= 0. */
export function secondsOfFire(shots: number, fireRate: number): number {
  if (!Number.isFinite(fireRate) || fireRate <= 0) return 0;
  return shots / fireRate;
}

/** Case-insensitive name filter for the hero picker. Empty query → all. */
export function filterHeroes<T extends { name: string }>(heroes: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return heroes;
  return heroes.filter((h) => h.name.toLowerCase().includes(q));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/hideout-utils.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hideout-utils.ts src/lib/hideout-utils.test.ts
git commit -m "Add hideout-utils: fire-rate default shots + hero filter helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Fire-rate-aware default shots + time label

**Files:**
- Modify: `src/components/hideout.tsx` (imports; state near `:94`; an effect after `result`; the Shots `NumberField` at `:682`)

**Interfaces:**
- Consumes: `defaultShotsForFireRate`, `secondsOfFire` from `@/lib/hideout-utils`; `result.heroStats.weaponFireRate` (existing `SimResult`).
- Produces: behavior only.

- [ ] **Step 1: Import the helpers**

At the top of `src/components/hideout.tsx`, add:

```tsx
import { defaultShotsForFireRate, secondsOfFire } from "@/lib/hideout-utils";
```

- [ ] **Step 2: Add the `shotsTouched` flag**

Immediately after the `shots` / `headshots` state (around `:94–95`), add:

```tsx
// A shared ?b= build carries an explicit shots count → treat as user-set so links render as shared.
const [shotsTouched, setShotsTouched] = useState(initialBuild?.shots != null);
```

- [ ] **Step 3: Auto-default shots from the current build's fire rate**

After `result` is derived (the `const result = activeBuild === "B" ? resultB : resultA;` line), add:

```tsx
// Default the burst window to ~1.5s of fire for the *current* build (items included),
// until the user edits Shots. Buying a fire-rate item bumps the default up.
const equippedFireRate = result?.heroStats.weaponFireRate ?? 0;
useEffect(() => {
  if (shotsTouched || equippedFireRate <= 0) return;
  const def = defaultShotsForFireRate(equippedFireRate);
  setShots(def);
  setHeadshots((h) => Math.min(h, def));
}, [equippedFireRate, shotsTouched]);
```

(If `react-hooks/exhaustive-deps` complains about the stable setters, follow the file's existing convention — it already brackets sim memos with `eslint-disable react-hooks/exhaustive-deps`.)

- [ ] **Step 4: Mark shots as touched on manual edit + add the time label**

At `:682`, change the Shots field's `onChange` to set the touched flag, and add a time label after the Headshots field (`:683`):

```tsx
<NumberField label="Shots" value={shots} onChange={(v) => { setShots(v); setHeadshots((h) => Math.min(h, v)); setShotsTouched(true); }} min={0} max={50} />
<NumberField label="Headshots" value={headshots} onChange={setHeadshots} min={0} max={shots} />
<span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-numeric)", whiteSpace: "nowrap", alignSelf: "center" }}>
  ≈{secondsOfFire(shots, equippedFireRate).toFixed(1)}s of fire
</span>
```

- [ ] **Step 5: Lint, build, and re-run the unit tests**

Run: `bun run lint && bun run build && bun test`
Expected: no new lint/build errors; all `bun test` suites still pass (no engine change).

- [ ] **Step 6: Manual check**

`bun run dev`, open `/hideout`:
- Fresh load: Shots shows ~1.5s of fire for the default hero; the "≈1.5s of fire" label matches.
- Switch heroes: Shots updates to the new hero's default.
- Buy a fire-rate item (e.g. a weapon fire-rate item): Shots increases.
- Edit Shots manually: it sticks and no longer auto-updates when the build changes.
- Open a `?b=` link with an explicit shots value: it renders exactly as shared.

- [ ] **Step 7: Commit**

```bash
git add src/components/hideout.tsx
git commit -m "Default burst shots to ~1.5s of fire for the equipped build

Auto-sets the Shots field from the current build's fire rate (items included)
until the user edits it; adds a live time label. Shared links stay exact.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: HeroPicker component (portrait-grid) + wire-in

**Files:**
- Create: `src/components/hero-picker.tsx`
- Modify: `src/app/globals.css` (append `.hero-picker-grid` rules)
- Modify: `src/components/hideout.tsx` (wrap both `HeroPortrait`s as triggers `:399,:438`; remove the two `HeroSelect` blocks `:421–423,:452–454`; delete the `HeroSelect` function `:1195–1205`)

**Interfaces:**
- Consumes: `filterHeroes` from `@/lib/hideout-utils`; `HeroWithAbilities` from `@/lib/sim`; `radix-ui` `Popover`.
- Produces: `HeroPicker({ heroes, value, onChange, accentColor, align?, children })` — `children` is the trigger element (the portrait).

- [ ] **Step 1: Create the component**

Create `src/components/hero-picker.tsx`:

```tsx
"use client";
import { useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import Image from "next/image";
import type { HeroWithAbilities } from "@/lib/sim";
import { filterHeroes } from "@/lib/hideout-utils";

export function HeroPicker({
  heroes, value, onChange, accentColor, align = "left", children,
}: {
  heroes: HeroWithAbilities[];
  value: number | null;
  onChange: (id: number) => void;
  accentColor: string;
  align?: "left" | "right";
  children: ReactNode; // the trigger (hero portrait)
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = filterHeroes(heroes, query);

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align === "right" ? "end" : "start"}
          sideOffset={8}
          style={{
            width: 320, padding: 10, zIndex: 50,
            background: "var(--surface-raised)", border: "1px solid var(--border-strong)",
            borderRadius: "var(--r-md, 10px)", boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          }}
        >
          <input
            autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search heroes…"
            style={{
              width: "100%", height: 32, padding: "0 10px", marginBottom: 8,
              background: "var(--surface-well)", border: "1px solid var(--border)",
              borderRadius: "var(--r-sm, 6px)", color: "var(--text)",
              fontFamily: "var(--font-archivo)", fontSize: 13, outline: "none",
            }}
          />
          <div className="hero-picker-grid">
            {shown.map((h) => {
              const selected = h.id === value;
              return (
                <button
                  key={h.id} type="button"
                  onClick={() => { onChange(h.id); setOpen(false); }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    padding: 6, background: "transparent", cursor: "pointer",
                    border: `1px solid ${selected ? accentColor : "transparent"}`,
                    borderRadius: "var(--r-sm, 6px)", color: "var(--text)",
                  }}
                >
                  <span style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "var(--surface-well)" }}>
                    {h.imageUrl ? <Image src={h.imageUrl} alt="" width={44} height={44} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                  </span>
                  <span style={{ fontSize: 10, lineHeight: 1.1, textAlign: "center", color: selected ? accentColor : "var(--text-muted)" }}>{h.name}</span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <div style={{ gridColumn: "1 / -1", padding: 12, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No heroes</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 2: Add the custom-scrollbar grid CSS**

Append to `src/app/globals.css`:

```css
.hero-picker-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
.hero-picker-grid::-webkit-scrollbar { width: 8px; }
.hero-picker-grid::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
.hero-picker-grid::-webkit-scrollbar-track { background: transparent; }
```

- [ ] **Step 3: Import HeroPicker into hideout**

At the top of `src/components/hideout.tsx`, add:

```tsx
import { HeroPicker } from "@/components/hero-picker";
```

- [ ] **Step 4: Make the attacker portrait the picker trigger**

Replace the attacker `HeroPortrait` (`:399`):

```tsx
<HeroPortrait imageUrl={hero.imageUrl} size={64} level={result.level} />
```

with:

```tsx
<HeroPicker heroes={heroes} value={heroId} onChange={setHeroId} accentColor="var(--brass-400)">
  <button type="button" title="Change hero" aria-label="Change attacker hero" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", borderRadius: 8 }}>
    <HeroPortrait imageUrl={hero.imageUrl} size={64} level={result.level} />
  </button>
</HeroPicker>
```

Then delete the now-redundant attacker select block (`:421–423`):

```tsx
<div style={{ marginTop: 4, width: 200, maxWidth: "100%" }}>
  <HeroSelect heroes={heroes} value={heroId} onChange={setHeroId} accentColor="var(--brass-400)" />
</div>
```

- [ ] **Step 5: Make the target portrait the picker trigger**

Replace the target `HeroPortrait` (`:438`):

```tsx
<HeroPortrait imageUrl={target.imageUrl} size={64} level={result.targetLevel} />
```

with:

```tsx
<HeroPicker heroes={heroes} value={targetId} onChange={setTargetId} accentColor="var(--danger-500)" align="right">
  <button type="button" title="Change hero" aria-label="Change target hero" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", borderRadius: 8 }}>
    <HeroPortrait imageUrl={target.imageUrl} size={64} level={result.targetLevel} />
  </button>
</HeroPicker>
```

Then delete the now-redundant target select block (`:452–454`):

```tsx
<div style={{ marginTop: 4, width: 200, maxWidth: "100%" }}>
  <HeroSelect heroes={heroes} value={targetId} onChange={setTargetId} accentColor="var(--danger-500)" align="right" />
</div>
```

- [ ] **Step 6: Delete the unused HeroSelect function**

Remove the `function HeroSelect(...) { ... }` definition (`:1195–1205`). Confirm no other references remain:

Run: `grep -n "HeroSelect" src/components/hideout.tsx`
Expected: no matches.

- [ ] **Step 7: Lint + build**

Run: `bun run lint && bun run build`
Expected: no errors (no unused-symbol or missing-import warnings).

- [ ] **Step 8: Manual check**

`bun run dev`, `/hideout`:
- Click the **attacker portrait** → grid popover opens with a search box and **no native OS scrollbar** (custom thin scrollbar). Type to filter; click a hero → attacker updates, popover closes.
- Click the **target portrait** → same, right-aligned, danger accent; selecting updates the target.
- `Esc` and outside-click close it (radix). Selected hero shows the accent ring.

- [ ] **Step 9: Commit**

```bash
git add src/components/hero-picker.tsx src/components/hideout.tsx src/app/globals.css
git commit -m "Add styled HeroPicker; open it by clicking the hero portraits

Replaces the native <select> with a radix Popover portrait-grid picker
(search + custom scrollbar). Reusable for Lane Lab's lanemate/enemy picks.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Extract `resolveBuild` into a shared module (TDD)

**Files:**
- Create: `src/app/b/[code]/resolve.ts`
- Create: `src/app/b/[code]/resolve.test.ts`
- Modify: `src/app/b/[code]/page.tsx` (remove inline `loadData`/`resolveBuild`; import from `./resolve`)

**Interfaces:**
- Consumes: `getHeroes`, `getItems` (`@/lib/data`); `decodeBuild` (`@/lib/build-code`); `simulate` (`@/lib/sim`).
- Produces: `resolveBuild(code: string): Promise<{ hero, target, equipped, targetEquipped, result } | null>`.

- [ ] **Step 1: Write the failing test**

Create `src/app/b/[code]/resolve.test.ts` (relative imports, matching the engine test's convention):

```ts
import { test, expect } from "bun:test";
import { getHeroes, getItems } from "../../../lib/data";
import { encodeBuild } from "../../../lib/build-code";
import { resolveBuild } from "./resolve";

test("resolveBuild decodes a share code into heroes + a positive burst", async () => {
  const heroes = getHeroes();
  const items = getItems();
  const hero = heroes[0];
  const target = heroes[1] ?? heroes[0];
  const loadout = items.slice(0, 2).map((i) => i.id);

  const code = encodeBuild(
    { heroId: hero.id, targetId: target.id, loadout, targetLoadout: [], range: 25, shots: 8, headshots: 0, matchTargetLevel: true },
    heroes, items,
  );

  const b = await resolveBuild(code);
  expect(b).not.toBeNull();
  expect(b!.hero.id).toBe(hero.id);
  expect(b!.target.id).toBe(target.id);
  expect(b!.result.burst.total).toBeGreaterThan(0);
});

test("resolveBuild returns null for an invalid code", async () => {
  expect(await resolveBuild("not-a-real-code")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/b/[code]/resolve.test.ts`
Expected: FAIL — `Cannot find module './resolve'`.

- [ ] **Step 3: Create the module (move the existing logic verbatim)**

Create `src/app/b/[code]/resolve.ts` by moving `loadData` + `resolveBuild` out of `page.tsx` (currently `page.tsx:18–40`):

```ts
import { getHeroes, getItems } from "@/lib/data";
import { decodeBuild } from "@/lib/build-code";
import { simulate } from "@/lib/sim";
import type { ItemWithModifiers } from "@/db/schema";

async function loadData() {
  return { heroes: getHeroes(), items: getItems() };
}

// Resolve a share code into the heroes, items, and simulated result. Ultimates
// default off, mirroring the build tool, since the code doesn't store ability toggles.
export async function resolveBuild(code: string) {
  const { heroes, items } = await loadData();
  const s = decodeBuild(code, heroes, items);
  if (!s) return null;
  const hero = heroes.find((h) => h.id === s.heroId) ?? null;
  const target = heroes.find((h) => h.id === s.targetId) ?? null;
  if (!hero || !target) return null;
  const equipped = s.loadout.map((id) => items.find((i) => i.id === id)).filter(Boolean) as ItemWithModifiers[];
  const targetEquipped = s.targetLoadout.map((id) => items.find((i) => i.id === id)).filter(Boolean) as ItemWithModifiers[];
  const ultIds = hero.abilities.filter((a) => a.type === "ultimate").map((a) => a.id);
  const result = simulate(
    { hero, items: equipped },
    { hero: target, items: targetEquipped, matchAttackerLevel: s.matchTargetLevel },
    { range: s.range, shots: s.shots, headshots: s.headshots, disabledAbilityIds: ultIds },
  );
  return { hero, target, equipped, targetEquipped, result };
}
```

- [ ] **Step 4: Point `page.tsx` at the shared module**

In `src/app/b/[code]/page.tsx`: delete the local `loadData` and `resolveBuild` (`:18–40`) and the now-unused `decodeBuild`/`simulate` imports, then add:

```tsx
import { resolveBuild } from "./resolve";
```

(Keep `getHeroes`/`getItems` imports only if still used elsewhere in the file; otherwise remove them too. `generateMetadata` and the default export keep calling `resolveBuild(code)` unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/app/b/[code]/resolve.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Lint + build**

Run: `bun run lint && bun run build`
Expected: no errors; `/b/[code]` still builds.

- [ ] **Step 7: Commit**

```bash
git add "src/app/b/[code]/resolve.ts" "src/app/b/[code]/resolve.test.ts" "src/app/b/[code]/page.tsx"
git commit -m "Extract resolveBuild into a shared module for /b/[code]

Lets the page and the upcoming OG image share one decode+simulate path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: OG image route + Twitter card

**Files:**
- Create: `src/app/b/[code]/opengraph-image.tsx`
- Modify: `src/app/b/[code]/page.tsx` (`generateMetadata` → add `twitter` card)

**Interfaces:**
- Consumes: `resolveBuild` (`./resolve`); `ImageResponse` (`next/og`).
- Produces: a 1200×630 PNG at `/b/<code>/opengraph-image`; `og:image` auto-injected by the file convention.

- [ ] **Step 1: Create the OG image route**

Create `src/app/b/[code]/opengraph-image.tsx`:

```tsx
import { ImageResponse } from "next/og";
import { resolveBuild } from "./resolve";

export const runtime = "edge";
export const alt = "Deadlock build matchup — Fairfax Industries";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const C = {
  bg: "#1a1917", text: "#e9e5dc", muted: "#918c81",
  brass: "#e4c389", brass400: "#d6ab6e", danger: "#c5503e", border: "rgba(233,229,220,0.16)",
};

export default async function OgImage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const b = await resolveBuild(code);

  if (!b) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.muted, fontSize: 40 }}>
          Build not found · Fairfax Industries
        </div>
      ),
      size,
    );
  }

  const { hero, target, result } = b;
  const num = (n: number) => Math.round(n).toLocaleString();
  const stats: [string, string, string][] = [
    ["Burst", num(result.burst.total), C.brass],
    ["DPS", num(result.sustainedDps), C.text],
    ["TTK", result.timeToKill != null ? `${result.timeToKill.toFixed(1)}s` : "—", C.text],
    ["Target EHP", num(result.theirEhp), C.text],
  ];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.text, padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            {hero.imageUrl ? <img src={hero.imageUrl} width={160} height={160} style={{ borderRadius: 16 }} /> : null}
            <div style={{ display: "flex", marginTop: 16, fontSize: 52, color: C.brass }}>{hero.name}</div>
            <div style={{ display: "flex", fontSize: 24, color: C.muted }}>Attacker · Lvl {result.level}</div>
          </div>
          <div style={{ display: "flex", fontSize: 48, color: C.brass400 }}>VS</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            {target.imageUrl ? <img src={target.imageUrl} width={160} height={160} style={{ borderRadius: 16 }} /> : null}
            <div style={{ display: "flex", marginTop: 16, fontSize: 52, color: C.danger }}>{target.name}</div>
            <div style={{ display: "flex", fontSize: 24, color: C.muted }}>Target</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: 28 }}>
          {stats.map(([label, value, color]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 20, color: C.muted, letterSpacing: 2 }}>{label.toUpperCase()}</div>
              <div style={{ display: "flex", fontSize: 44, color }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 20, color: C.muted }}>fairfax.industries · Deadlock theorycrafting</div>
      </div>
    ),
    size,
  );
}
```

- [ ] **Step 2: Add the Twitter card to metadata**

In `src/app/b/[code]/page.tsx`, update the `generateMetadata` return (`:48`) to include a Twitter large-image card:

```tsx
return {
  title,
  description,
  openGraph: { title, description },
  twitter: { card: "summary_large_image", title, description },
};
```

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: builds successfully; `/b/[code]/opengraph-image` appears in the route output.

- [ ] **Step 4: Runtime check (dev server)**

Run `bun run dev`. Get a real code: open `/hideout`, click **Share**, copy the `?b=<code>` value from the URL. Then:

Run: `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:3000/b/<code>/opengraph-image"`
Expected: `200 image/png`.

Open `http://localhost:3000/b/<code>/opengraph-image` in a browser and confirm the hero-vs-hero card renders with the four numbers. Paste the `/b/<code>` URL into a card validator (e.g. opengraph.xyz) and confirm `og:image` + `twitter:card`.

- [ ] **Step 5: Cloudflare preview check**

Run: `bun run cf:preview`
Open the preview URL's `/b/<code>` page and confirm the OG image renders on the Workers runtime (validates `next/og` under OpenNext).

**Fallback (only if Step 5 fails):** convert the route to an explicit API route — create `src/app/b/[code]/og/route.tsx` exporting `GET` that returns the same `ImageResponse` (the shape OpenNext's e2e example uses), and add `openGraph.images: [\`/b/${code}/og\`]` to `generateMetadata`. Last resort: a single static branded image in `public/` referenced as `openGraph.images`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/b/[code]/opengraph-image.tsx" "src/app/b/[code]/page.tsx"
git commit -m "Add rich OG image for shared builds (/b/[code])

Dynamic hero-vs-hero card with burst/DPS/TTK/EHP via next/og, plus a
summary_large_image Twitter card, so build links unfurl in Discord.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7 (optional polish): Vendor Oswald for the OG card

Only do this if the default `next/og` font looks off-brand. The card already ships legibly on the built-in font from Task 6.

**Files:**
- Create: `src/app/b/[code]/Oswald-SemiBold.ttf` (a **static** 600-weight TTF — Satori does not accept woff2)
- Modify: `src/app/b/[code]/opengraph-image.tsx` (load + pass the font)

- [ ] **Step 1: Vendor a static TTF**

Download a static Oswald SemiBold TTF into the route folder (the `google/fonts` repo ships a variable font; export/convert a static 600 instance, or use any static Oswald-SemiBold.ttf). Confirm it is `.ttf`, not `.woff2`.

- [ ] **Step 2: Load and pass the font**

In `opengraph-image.tsx`, read the file and pass it to `ImageResponse`, and set `fontFamily: "Oswald"` on the headline/number text:

```tsx
import { readFile } from "node:fs/promises";
import { join } from "node:path";
// ...inside the default export, before building the response:
const oswald = await readFile(join(process.cwd(), "src/app/b/[code]/Oswald-SemiBold.ttf"));
// ...pass options:
return new ImageResponse(<...>, {
  ...size,
  fonts: [{ name: "Oswald", data: oswald, weight: 600, style: "normal" }],
});
```

(If `readFile` from the route folder is awkward under the edge bundle, move the TTF to `public/og/Oswald-SemiBold.ttf` and `fetch(new URL("/og/Oswald-SemiBold.ttf", origin))` at gen time instead. If either path is flaky, keep the default font — this task is cosmetic.)

- [ ] **Step 3: Build + re-check**

Run: `bun run build` then repeat Task 6 Steps 4–5. Commit with:

```bash
git add "src/app/b/[code]/opengraph-image.tsx" "src/app/b/[code]/Oswald-SemiBold.ttf"
git commit -m "Use Oswald in the OG card for on-brand typography

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (hero picker, portrait-trigger, embedded scrollbar) → Tasks 2 (`filterHeroes`) + 4. ✓
- Item 2 (fire-rate default shots, 1.5s, equipped fire rate, exact control + time label) → Tasks 2 + 3. ✓
- Item 3 (default match level) → Task 1. ✓
- Item 4 (OG previews, shared `resolveBuild`, Twitter card, Workers feasibility + fallback) → Tasks 5 + 6, font in 7. ✓

**Placeholder scan:** All code blocks are complete; colors and field names are literal; the only deliberately-optional/uncertain bits (font vendoring) are isolated in Task 7 with explicit fallbacks. ✓

**Type consistency:** `resolveBuild` return shape is defined once (Task 5) and consumed unchanged by Task 6. `defaultShotsForFireRate` / `secondsOfFire` / `filterHeroes` signatures match between Task 2 (definition), Task 3, and Task 4 (consumers). `HeroPicker` props match between Task 4's definition and its two call sites. `result.heroStats.weaponFireRate` matches `SimResult.heroStats: ComputedStats` / `ComputedStats.weaponFireRate: number`. ✓

## Verification (whole batch)

- `bun test` — all suites green (engine unchanged; new `hideout-utils` + `resolve` suites pass).
- `bun run lint && bun run build` — clean.
- Manual `/hideout`: match-level default-on; fire-rate-aware sticky shots + time label; portrait-click grid picker with custom scrollbar.
- `/b/<code>`: OG image returns `200 image/png`, renders hero-vs-hero + 4 numbers, unfurls with `og:image` + `twitter:card`; verified on a `cf:preview` Workers build.
