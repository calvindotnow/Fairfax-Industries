/**
 * Lane Lab analytics accessors — reads from the separately baked lane-lab-data.json.
 * Kept in its own module so the 379 KB JSON is only bundled into the Counter tab
 * chunk (lazy-loaded), not the main /hideout first-load JS.
 */
import laneLab from "./lane-lab-data.json";
import { fillToSouls, type BuildPath } from "./build-path";

const ll = laneLab as unknown as {
  counter_stats: { hero_id: number; enemy_hero_id: number; wins: number; matches_played: number }[];
  counter_item_stats: Record<string, Record<string, { item_id: number; wins: number; losses: number; matches: number; median_buy_time_s?: number | null; avg_buy_time_s?: number | null }[]>>;
  item_stats: Record<string, { item_id: number; wins: number; losses: number; matches: number }[]>;
  build_paths?: Record<string, { itemId: number; souls: number; pickrate: number; winrate: number }[]>;
};

const wr = (wins: number, total: number) => (total > 0 ? wins / total : 0);

export function getMatchup(youId: number, enemyId: number): { winrate: number; matches: number } | null {
  const row = ll.counter_stats.find((r) => r.hero_id === youId && r.enemy_hero_id === enemyId);
  return row ? { winrate: wr(row.wins, row.matches_played), matches: row.matches_played } : null;
}

export function getCounterItems(youId: number, enemyId: number): { itemId: number; winrate: number; matches: number; buyTimeS: number | null }[] {
  const rows = ll.counter_item_stats[youId]?.[enemyId] ?? [];
  // buyTimeS is the MEDIAN purchase time (minute resolution) — the mean gets dragged late by
  // players buying cheap items as mid-game slot fillers, which over-triggered the 15:00 lane
  // gate. avg_buy_time_s is the pre-2026-07-05 field, kept as a fallback so the app works
  // against a not-yet-re-baked data file.
  return rows.map((r) => ({ itemId: r.item_id, winrate: wr(r.wins, r.wins + r.losses), matches: r.matches, buyTimeS: r.median_buy_time_s ?? r.avg_buy_time_s ?? null }))
             .sort((a, b) => b.winrate - a.winrate);
}

export function getItemStats(youId: number): { itemId: number; winrate: number; matches: number }[] {
  const rows = ll.item_stats[youId] ?? [];
  return rows.map((r) => ({ itemId: r.item_id, winrate: wr(r.wins, r.wins + r.losses), matches: r.matches }));
}

/** A hero's distilled average build path, steps ascending by souls (empty if no data). */
export function getBuildPath(heroId: number): BuildPath {
  return (ll.build_paths?.[heroId] ?? []) as BuildPath; // already ascending + typed at bake time
}

/** DB item ids the average enemy of `heroId` owns at `souls` (≤ `maxItems`, highest-pickrate on overflow). */
export function buildPathAtSouls(heroId: number, souls: number, maxItems = 12): number[] {
  return fillToSouls(getBuildPath(heroId), souls, maxItems);
}
