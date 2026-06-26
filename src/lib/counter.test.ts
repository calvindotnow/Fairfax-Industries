import { test, expect } from "bun:test";
import { duelAdvantage, pickCandidates, rankByDuelShift } from "./counter";

test("duelAdvantage = theirTTK / yourTTK; 0 when you can't kill", () => {
  expect(duelAdvantage(2, 4)).toBe(2);        // you kill in 2s, they in 4s → 2.0 (you win)
  expect(duelAdvantage(4, 2)).toBe(0.5);
  expect(duelAdvantage(null, 4)).toBe(0);     // you can't kill them
});

test("pickCandidates merges counters+staples, drops owned, caps at topN", () => {
  expect(pickCandidates([1, 2, 3, 4], [2], [9], 3)).toEqual([1, 3, 4]); // 2 owned dropped, capped to 3 before staples
});

test("rankByDuelShift sorts by delta desc", () => {
  const r = rankByDuelShift([{ itemId: 1, base: 1, withItem: 1.5 }, { itemId: 2, base: 1, withItem: 2 }]);
  expect(r.map((x) => x.itemId)).toEqual([2, 1]);
  expect(r[0].deltaA).toBeCloseTo(1);
});
