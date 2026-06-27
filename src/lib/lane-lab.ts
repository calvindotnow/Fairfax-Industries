/**
 * Lane Lab analytics accessors — reads from the separately baked lane-lab-data.json.
 * Kept in its own module so the 379 KB JSON is only bundled into the Counter tab
 * chunk (lazy-loaded), not the main /hideout first-load JS.
 */
import laneLab from "./lane-lab-data.json";

const ll = laneLab as unknown as {
  counter_stats: { hero_id: number; enemy_hero_id: number; wins: number; matches_played: number }[];
  counter_item_stats: Record<string, Record<string, { item_id: number; wins: number; losses: number; matches: number }[]>>;
  item_stats: Record<string, { item_id: number; wins: number; losses: number; matches: number }[]>;
};

const wr = (wins: number, total: number) => (total > 0 ? wins / total : 0);

export function getMatchup(youId: number, enemyId: number): { winrate: number; matches: number } | null {
  const row = ll.counter_stats.find((r) => r.hero_id === youId && r.enemy_hero_id === enemyId);
  return row ? { winrate: wr(row.wins, row.matches_played), matches: row.matches_played } : null;
}

export function getCounterItems(youId: number, enemyId: number): { itemId: number; winrate: number; matches: number }[] {
  const rows = ll.counter_item_stats[youId]?.[enemyId] ?? [];
  return rows.map((r) => ({ itemId: r.item_id, winrate: wr(r.wins, r.wins + r.losses), matches: r.matches }))
             .sort((a, b) => b.winrate - a.winrate);
}

export function getItemStats(youId: number): { itemId: number; winrate: number; matches: number }[] {
  const rows = ll.item_stats[youId] ?? [];
  return rows.map((r) => ({ itemId: r.item_id, winrate: wr(r.wins, r.wins + r.losses), matches: r.matches }));
}
