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
