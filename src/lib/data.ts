/**
 * Read access to the game data, baked into the build by the sync script
 * (`src/lib/baked-data.json`). The app reads from here instead of a runtime
 * database, so it deploys to any serverless host with no DB connection. To
 * refresh the data, run `bun run sync` (regenerates the JSON) and redeploy.
 */
import type { HeroWithAbilities, ItemWithModifiers, StatSnapshot } from "@/db/schema";
import baked from "./baked-data.json";

// JSON dates arrive as strings; the read paths don't use the row timestamps
// (freshness comes from `getSyncedAt`), so the structural cast is safe.
const data = baked as unknown as {
    syncedAt: string;
    heroes: HeroWithAbilities[];
    items: ItemWithModifiers[];
    snapshots: StatSnapshot[];
};

export function getHeroes(): HeroWithAbilities[] {
    return data.heroes;
}

export function getItems(): ItemWithModifiers[] {
    return data.items;
}

/** The two most recent stat snapshots, newest first — for the patch-notes diff.
 *  `takenAt` is revived from its baked ISO string back into a Date. */
export function getSnapshots(): StatSnapshot[] {
    return data.snapshots.map((s) => ({ ...s, takenAt: new Date(s.takenAt as unknown as string) }));
}

/** When the baked data was last synced (for the data-freshness badge). */
export function getSyncedAt(): Date | null {
    return data.syncedAt ? new Date(data.syncedAt) : null;
}

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
