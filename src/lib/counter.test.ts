import { test, expect } from "bun:test";
import { duelAdvantage, pickCandidates, valuePerSoul, splitByCost, withinLaneWindow, LANE_COST, LANE_BUY_TIME_MAX_S } from "./counter";

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

test("withinLaneWindow: drops rows bought after 15:00 avg; keeps the boundary and unknown timing", () => {
  const rows = [
    { itemId: 1, buyTimeS: 8 * 60 },                 // 8:00 — genuinely early, kept
    { itemId: 2, buyTimeS: LANE_BUY_TIME_MAX_S },    // exactly 15:00 — boundary kept
    { itemId: 3, buyTimeS: LANE_BUY_TIME_MAX_S + 1 },// 15:01 — dropped
    { itemId: 4, buyTimeS: 33 * 60 },                // 33:00 — the cheap-but-midgame case, dropped
    { itemId: 5, buyTimeS: null },                   // staples/no data — kept (can't call it late without evidence)
  ];
  expect(withinLaneWindow(rows).map((r) => r.itemId)).toEqual([1, 2, 5]);
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
