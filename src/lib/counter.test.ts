import { test, expect } from "bun:test";
import { duelAdvantage, pickCandidates, valuePerSoul, splitByCost, LANE_COST } from "./counter";

test("duelAdvantage = theirTTK / yourTTK; 0 when you can't kill; 999 sentinel when they can't kill you", () => {
  expect(duelAdvantage(2, 4)).toBe(2);        // you kill in 2s, they in 4s → 2.0 (you win)
  expect(duelAdvantage(4, 2)).toBe(0.5);
  expect(duelAdvantage(null, 4)).toBe(0);     // you can't kill them
  expect(duelAdvantage(2, null)).toBe(999);   // they can't kill you → finite sentinel (not Infinity, avoids NaN in delta)
  expect(duelAdvantage(2, 0)).toBe(999);      // theirTTK=0 is degenerate → same sentinel
});

test("pickCandidates merges counters+staples, drops owned, caps at topN", () => {
  expect(pickCandidates([1, 2, 3, 4], [2], [9], 3)).toEqual([1, 3, 4]); // 2 owned dropped, capped to 3 before staples
});

test("valuePerSoul = deltaA/soulCost, guards zero cost", () => {
  expect(valuePerSoul(1.2, 1200)).toBeCloseTo(0.001);
  expect(valuePerSoul(1, 0)).toBe(0);
});

test("splitByCost: <=LANE_COST is lane (affordable), above is power-spike", () => {
  const rows = [
    { itemId: 1, soulCost: 1600 }, { itemId: 2, soulCost: 6400 },
    { itemId: 3, soulCost: LANE_COST }, { itemId: 4, soulCost: 3200 },
  ];
  const { lane, powerSpike } = splitByCost(rows);
  expect(lane.map(r => r.itemId)).toEqual([1, 3, 4]);
  expect(powerSpike.map(r => r.itemId)).toEqual([2]);
});
