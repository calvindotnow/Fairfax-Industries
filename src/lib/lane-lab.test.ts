import { test, expect } from "bun:test";
import { getHeroes } from "./data";
import { getItems } from "./data";
import { getMatchup, getCounterItems, getItemStats, getBuildPath, buildPathAtSouls } from "./lane-lab";

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

test("getCounterItems exposes buyTimeS", () => {
  const heroes = getHeroes();
  const rows = getCounterItems(heroes[0].id, heroes[1].id);
  for (const r of rows) expect(r.buyTimeS === null || r.buyTimeS > 0).toBe(true);
});

test("getItemStats returns winrate-derived rows for a hero", () => {
  const rows = getItemStats(getHeroes()[0].id);
  expect(Array.isArray(rows)).toBe(true);
  for (const r of rows) { expect(r.winrate).toBeGreaterThanOrEqual(0); expect(r.winrate).toBeLessThanOrEqual(1); }
});

test("getBuildPath is ascending by souls with valid fields", () => {
  const heroes = getHeroes();
  const hid = heroes.find((h) => getBuildPath(h.id).length > 0)?.id ?? heroes[0].id;
  const path = getBuildPath(hid);
  for (let i = 1; i < path.length; i++) expect(path[i].souls).toBeGreaterThanOrEqual(path[i - 1].souls);
  for (const s of path) { expect(s.pickrate).toBeGreaterThan(0); expect(s.winrate).toBeGreaterThanOrEqual(0); }
});

test("getBuildPath item ids resolve against baked items", () => {
  const itemIds = new Set(getItems().map((i) => i.id));
  const heroes = getHeroes();
  const hid = heroes.find((h) => getBuildPath(h.id).length > 0)?.id ?? heroes[0].id;
  for (const s of getBuildPath(hid)) expect(itemIds.has(s.itemId)).toBe(true);
});

test("buildPathAtSouls grows monotonically and respects the cap", () => {
  const heroes = getHeroes();
  const hid = heroes.find((h) => getBuildPath(h.id).length > 2)?.id ?? heroes[0].id;
  expect(buildPathAtSouls(hid, 0).length).toBe(0);
  const mid = buildPathAtSouls(hid, 12000).length;
  const late = buildPathAtSouls(hid, 60000).length;
  expect(late).toBeGreaterThanOrEqual(mid);
  expect(buildPathAtSouls(hid, 60000, 5).length).toBeLessThanOrEqual(5);
});
