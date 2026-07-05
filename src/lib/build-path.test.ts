import { test, expect } from "bun:test";
import { distillBuildPath, fillToSouls } from "./build-path";

test("distill de-dups an item across columns by max matches, keeps the winning node's souls", () => {
  const nodes = [
    { column: 0, item_id: 10, wins: 40, matches: 100, avg_net_worth_at_buy: 9000 }, // noisy col-0
    { column: 1, item_id: 10, wins: 300, matches: 600, avg_net_worth_at_buy: 8500 }, // real, more matches
    { column: 0, item_id: 20, wins: 30, matches: 300, avg_net_worth_at_buy: 4000 },
  ];
  const path = distillBuildPath(nodes, 1000, 0.08);
  expect(path.map((s) => s.itemId)).toEqual([20, 10]); // ascending by souls
  expect(path[1]).toMatchObject({ itemId: 10, souls: 8500 });
  expect(path[1].pickrate).toBeCloseTo(0.6);
  expect(path[1].winrate).toBeCloseTo(0.5);
});

test("distill drops items below the pickrate floor and handles empty", () => {
  const nodes = [{ column: 0, item_id: 99, wins: 5, matches: 50, avg_net_worth_at_buy: 4000 }]; // 5% pick
  expect(distillBuildPath(nodes, 1000, 0.08)).toEqual([]);
  expect(distillBuildPath([], 1000, 0.08)).toEqual([]);
});

test("distill tolerates zero totalMatches without dividing by zero", () => {
  const nodes = [{ column: 0, item_id: 1, wins: 5, matches: 10, avg_net_worth_at_buy: 4000 }];
  const path = distillBuildPath(nodes, 0, 0); // total coerced to 1
  expect(path[0].pickrate).toBe(10);
});

test("fillToSouls returns owned items at a soul count, capped by pickrate", () => {
  const path = [
    { itemId: 1, souls: 4000, pickrate: 0.9, winrate: 0.5 },
    { itemId: 2, souls: 9000, pickrate: 0.6, winrate: 0.5 },
    { itemId: 3, souls: 9500, pickrate: 0.3, winrate: 0.5 },
  ];
  expect(fillToSouls(path, 9200, 12)).toEqual([1, 2]); // 3 not yet reached
  expect(fillToSouls(path, 100000, 2)).toEqual([1, 2]); // cap 2 → highest pickrate two, souls order
  expect(fillToSouls(path, 0, 12)).toEqual([]);
});
