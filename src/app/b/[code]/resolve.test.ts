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
