/**
 * Permanent cross-file integrity guard. The sync regenerates hero/item/ability ids
 * every run; baked-data.json + lane-lab-data.json + aggregates-data.json must always
 * be written from ONE run so their ids stay mutually consistent. On 2026-07-04 a
 * partial write left all 27k+ lane-lab item refs pointing at absent ids — this test
 * would have caught it. If it fails, the three JSONs are out of sync: re-run `bun run sync`.
 */
import { test, expect } from "bun:test";
import { getHeroes, getItems } from "./data";
import laneLab from "./lane-lab-data.json";
import aggregates from "./aggregates-data.json";

const ll = laneLab as unknown as {
  counter_stats: { hero_id: number; enemy_hero_id: number }[];
  counter_item_stats: Record<string, Record<string, { item_id: number }[]>>;
  item_stats: Record<string, { item_id: number }[]>;
  build_paths?: Record<string, { itemId: number }[]>;
};
const agg = aggregates as unknown as {
  item_stats: { item_id: number }[];
  ability_orders: Record<string, { abilities: number[] }[]>;
};

const itemIds = () => new Set(getItems().map((i) => i.id));
const heroIds = () => new Set(getHeroes().map((h) => h.id));
const abilityIds = () => new Set(getHeroes().flatMap((h) => h.abilities.map((a) => a.id)));

test("every lane-lab counter_item_stats item ref resolves against baked items", () => {
  const ids = itemIds();
  for (const enemyMap of Object.values(ll.counter_item_stats))
    for (const rows of Object.values(enemyMap))
      for (const r of rows) expect(ids.has(r.item_id)).toBe(true);
});

test("every lane-lab item_stats + build_paths item ref resolves against baked items", () => {
  const ids = itemIds();
  for (const rows of Object.values(ll.item_stats)) for (const r of rows) expect(ids.has(r.item_id)).toBe(true);
  for (const steps of Object.values(ll.build_paths ?? {})) for (const s of steps) expect(ids.has(s.itemId)).toBe(true);
});

test("every lane-lab counter_stats hero ref resolves against baked heroes", () => {
  const ids = heroIds();
  for (const r of ll.counter_stats) { expect(ids.has(r.hero_id)).toBe(true); expect(ids.has(r.enemy_hero_id)).toBe(true); }
});

test("every aggregates item + ability ref resolves against baked data", () => {
  const items = itemIds();
  for (const r of agg.item_stats) expect(items.has(r.item_id)).toBe(true);
  const abilities = abilityIds();
  for (const orders of Object.values(agg.ability_orders))
    for (const o of orders) for (const a of o.abilities) expect(abilities.has(a)).toBe(true);
});
