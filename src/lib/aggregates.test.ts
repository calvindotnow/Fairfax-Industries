import { test, expect } from "bun:test";
import { getHeroes, getItems } from "./data";
import { getItemAggregates, getAbilityOrderStats, getItemAggregateDeltas, getHiddenGems } from "./aggregates";

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

test("getItemAggregateDeltas is null or a valid delta array, never fabricated", () => {
  const deltas = getItemAggregateDeltas();
  // Absence is a legitimate, expected state (no previous snapshot yet) — must not throw
  // or silently coerce to [] (that would look identical to "checked, no movement").
  if (deltas === null) return;
  expect(Array.isArray(deltas)).toBe(true);
  const itemIds = new Set(getItems().map((i) => i.id));
  for (const d of deltas) {
    expect(itemIds.has(d.itemId)).toBe(true);
    expect(d.winrate).toBeGreaterThanOrEqual(0);
    expect(d.winrate).toBeLessThanOrEqual(1);
    expect(d.pickrate).toBeGreaterThanOrEqual(0);
    expect(d.pickrate).toBeLessThanOrEqual(1);
    expect(Number.isFinite(d.winrateDelta)).toBe(true);
    expect(Number.isFinite(d.pickrateDelta)).toBe(true);
  }
});

test("getHiddenGems only returns items meeting the winrate/pickrate/matches bar", () => {
  const gems = getHiddenGems();
  const itemIds = new Set(getItems().map((i) => i.id));
  for (const g of gems) {
    expect(itemIds.has(g.itemId)).toBe(true);
    expect(g.winrate).toBeGreaterThanOrEqual(0.56);
    expect(g.pickrate).toBeLessThanOrEqual(0.1);
    expect(g.matches).toBeGreaterThanOrEqual(400);
  }
  // Sorted by winrate descending.
  for (let i = 1; i < gems.length; i++) expect(gems[i - 1].winrate).toBeGreaterThanOrEqual(gems[i].winrate);
});
