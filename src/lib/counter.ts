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

/** Counters at/under this soul cost are "affordable/lane" picks; above = tier-4 power spikes. Tunable. */
export const LANE_COST = 4000;

/**
 * Lane suggestions must be lane-relevant by REAL timing, not just price: an item that's
 * cheap but bought at 25min on average is not lane advice. Rows whose average purchase
 * lands later than this are dropped from the lane list (they can still appear as power
 * spikes — zero tier-4 counter rows average under 15:00, so gating spikes by this window
 * would empty that section for every matchup; measured 2026-07-05).
 * Unknown timing (staples / no data) is kept — we can't call an item "late" without evidence.
 * Tunable; 15:00 chosen 2026-07-05 (owner call).
 */
export const LANE_BUY_TIME_MAX_S = 15 * 60;

/** Filter rows to those plausibly bought during the lane window (see LANE_BUY_TIME_MAX_S). */
export function withinLaneWindow<T extends { buyTimeS: number | null }>(
  rows: T[], maxS: number = LANE_BUY_TIME_MAX_S,
): T[] {
  return rows.filter((r) => r.buyTimeS == null || r.buyTimeS <= maxS);
}

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
