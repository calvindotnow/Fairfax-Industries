import { test, expect } from "bun:test";
import { getHeroes } from "./data";
import { getMatchup, getCounterItems, getItemStats } from "./lane-lab";

test("getMatchup returns a [0,1] winrate with sample, or null", () => {
  const heroes = getHeroes();
  const [a, b] = [heroes[0].id, heroes[1].id];
  const m = getMatchup(a, b);
  if (m) { expect(m.winrate).toBeGreaterThanOrEqual(0); expect(m.winrate).toBeLessThanOrEqual(1); expect(m.matches).toBeGreaterThan(0); }
  expect(getMatchup(-1, -2)).toBeNull();
});

test("getCounterItems is sorted desc by winrate and excludes nothing structurally", () => {
  const heroes = getHeroes();
  const items = getCounterItems(heroes[0].id, heroes[1].id);
  for (let i = 1; i < items.length; i++) expect(items[i - 1].winrate).toBeGreaterThanOrEqual(items[i].winrate);
});

test("getItemStats returns winrate-derived rows for a hero", () => {
  const rows = getItemStats(getHeroes()[0].id);
  expect(Array.isArray(rows)).toBe(true);
  for (const r of rows) { expect(r.winrate).toBeGreaterThanOrEqual(0); expect(r.winrate).toBeLessThanOrEqual(1); }
});
