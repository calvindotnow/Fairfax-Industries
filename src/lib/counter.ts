/** Two-sided duel advantage: how the time-to-kill race favors you (>1 = you win). 0 if you can't kill them. */
export function duelAdvantage(yourTTKonThem: number | null, theirTTKonYou: number | null): number {
  if (yourTTKonThem == null || yourTTKonThem <= 0) return 0;
  if (theirTTKonYou == null || theirTTKonYou <= 0) return 999; // finite sentinel — Infinity causes NaN in withItem − base
  return theirTTKonYou / yourTTKonThem;
}

/** Candidate pool: empirical counters first, then staples, minus owned, capped at topN. */
export function pickCandidates(counterItemIds: number[], ownedIds: number[], staples: number[], topN: number): number[] {
  const owned = new Set(ownedIds);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of [...counterItemIds, ...staples]) {
    if (owned.has(id) || seen.has(id)) continue;
    seen.add(id); out.push(id);
    if (out.length >= topN) break;
  }
  return out;
}

/** Rank candidates by net duel shift (withItem − base), desc. */
export function rankByDuelShift(rows: { itemId: number; base: number; withItem: number }[]): { itemId: number; deltaA: number }[] {
  return rows.map((r) => ({ itemId: r.itemId, deltaA: r.withItem - r.base }))
             .sort((a, b) => b.deltaA - a.deltaA);
}

/** Counters at/under this soul cost are "affordable/lane" picks; above = tier-4 power spikes. Tunable. */
export const LANE_COST = 4000;

/** Counter value normalized by cost — efficient cheap picks beat marginal expensive ones. */
export function valuePerSoul(deltaA: number, soulCost: number): number {
  return soulCost > 0 ? deltaA / soulCost : 0;
}

/** Split candidate rows into lane (affordable) vs power-spike (expensive/tier-4). */
export function splitByCost<T extends { soulCost: number }>(
  rows: T[], laneCostMax: number = LANE_COST,
): { lane: T[]; powerSpike: T[] } {
  const lane: T[] = []; const powerSpike: T[] = [];
  for (const r of rows) (r.soulCost > 0 && r.soulCost <= laneCostMax ? lane : powerSpike).push(r);
  return { lane, powerSpike };
}
