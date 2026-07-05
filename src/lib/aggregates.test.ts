import { test, expect } from "bun:test";
import { getHeroes, getItems } from "./data";
import { getItemAggregates, getAbilityOrderStats } from "./aggregates";

test("getItemAggregates returns valid [0,1] win/pick rates sorted by pickrate desc", () => {
  const rows = getItemAggregates();
  expect(Array.isArray(rows)).toBe(true);
  for (const r of rows) {
    expect(r.winrate).toBeGreaterThanOrEqual(0);
    expect(r.winrate).toBeLessThanOrEqual(1);
    expect(r.pickrate).toBeGreaterThanOrEqual(0);
    expect(r.pickrate).toBeLessThanOrEqual(1);
    expect(r.matches).toBeGreaterThan(0);
  }
  for (let i = 1; i < rows.length; i++) expect(rows[i - 1].pickrate).toBeGreaterThanOrEqual(rows[i].pickrate);
});

test("getItemAggregates item ids resolve against baked items", () => {
  const itemIds = new Set(getItems().map((i) => i.id));
  const rows = getItemAggregates();
  if (rows.length > 0) for (const r of rows) expect(itemIds.has(r.itemId)).toBe(true);
});

test("getAbilityOrderStats returns valid winrate rows sorted by matches desc", () => {
  const heroes = getHeroes();
  const hid = heroes.find((h) => getAbilityOrderStats(h.id).length > 0)?.id ?? heroes[0].id;
  const rows = getAbilityOrderStats(hid);
  for (const r of rows) {
    expect(r.winrate).toBeGreaterThanOrEqual(0);
    expect(r.winrate).toBeLessThanOrEqual(1);
    expect(r.matches).toBeGreaterThan(0);
    expect(Array.isArray(r.abilities)).toBe(true);
  }
  for (let i = 1; i < rows.length; i++) expect(rows[i - 1].matches).toBeGreaterThanOrEqual(rows[i].matches);
});

test("getAbilityOrderStats ability ids resolve against baked abilities", () => {
  const abilityIds = new Set(getHeroes().flatMap((h) => h.abilities.map((a) => a.id)));
  const heroes = getHeroes();
  const hid = heroes.find((h) => getAbilityOrderStats(h.id).length > 0)?.id ?? heroes[0].id;
  for (const row of getAbilityOrderStats(hid)) {
    for (const aid of row.abilities) expect(abilityIds.has(aid)).toBe(true);
  }
});

test("getAbilityOrderStats returns [] for an unknown hero", () => {
  expect(getAbilityOrderStats(-1)).toEqual([]);
});
