import { test, expect } from "bun:test";
import { defaultShotsForFireRate, secondsOfFire, filterHeroes, effectiveEnemyLoadout, takeControlSeed } from "./hideout-utils";

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

// ── Lane Lab v2 (D1): auto-enemy selection + one-way take-control ──────────────

test("effectiveEnemyLoadout: auto ON + available reads the derived (auto) loadout", () => {
  expect(effectiveEnemyLoadout(true, true, [1, 2, 3], [9])).toEqual([1, 2, 3]);
});

test("effectiveEnemyLoadout: auto OFF returns the manual loadout byte-identical (the no-op invariant)", () => {
  const manual = [9, 8, 7];
  // Same reference back out — auto-off never substitutes the derived path.
  expect(effectiveEnemyLoadout(false, true, [1, 2, 3], manual)).toBe(manual);
});

test("effectiveEnemyLoadout: auto ON but UNAVAILABLE (no build-path) falls back to manual, never fabricates", () => {
  const manual = [5];
  expect(effectiveEnemyLoadout(true, false, [1, 2, 3], manual)).toBe(manual);
  // And an empty enemy stays empty — no fabricated items.
  expect(effectiveEnemyLoadout(true, false, [1, 2, 3], [])).toEqual([]);
});

test("takeControlSeed: the manual seed on a take-control ADD keeps the derived enemy + the added item", () => {
  // The user was seeing the auto build [1,2,3]; they add item 4 → seed is [1,2,3,4].
  expect(takeControlSeed([1, 2, 3], { type: "add", id: 4 }, 12)).toEqual([1, 2, 3, 4]);
});

test("takeControlSeed: a take-control REMOVE keeps the derived enemy minus the removed item", () => {
  expect(takeControlSeed([1, 2, 3], { type: "remove", id: 2 }, 12)).toEqual([1, 3]);
});

test("takeControlSeed: never derives from targetLoadout — the derived path is the only seed source", () => {
  // Even with a rich (hypothetical) hand-built loadout elsewhere, the seed comes purely
  // from the auto loadout argument; there is no manual-loadout input to clobber.
  expect(takeControlSeed([10, 20], { type: "add", id: 30 }, 12)).toEqual([10, 20, 30]);
});

test("takeControlSeed: add respects the cap and de-dups", () => {
  const full = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  expect(takeControlSeed(full, { type: "add", id: 13 }, 12)).toEqual(full); // full → no-op add
  expect(takeControlSeed([1, 2], { type: "add", id: 2 }, 12)).toEqual([1, 2]); // already owned → no-op
});
