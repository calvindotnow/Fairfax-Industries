/**
 * Curated empirical aggregates — item win/pick rates (global) and per-hero
 * ability-order win stats — read from the separately baked `aggregates-data.json`.
 *
 * Kept in its own module + JSON (pattern: lane-lab.ts / lane-lab-data.json) so the
 * data is lazy-loaded only into the pages that need it (/items, /heroes/<slug>),
 * never inflating the shared baked-data.json main bundle.
 *
 * This is the ONLY interface the C1 (/items two-axis ranking) and C2 (ability-order
 * table) surfaces should use. Data baked by scripts/sync-deadlock-api.ts.
 *
 * NOTE: `bucket=hero` on /v1/analytics/item-stats returns HTTP 500 upstream (a
 * persistent server-side DB error as of 2026-07-04); per-hero item data is fetched
 * via `?hero_ids=<id>` (plural — singular `hero_id` is honored on item-stats but
 * plural is used for consistency with the rest of the sync). Global item aggregates
 * use the un-bucketed call.
 */
import aggregates from "./aggregates-data.json";

/** One item's global empirical performance (for the /items two-axis ranking). */
export interface ItemAggregate {
  itemId: number; // DB item id
  winrate: number; // wins / matches, 0..1
  pickrate: number; // matches / (most-played item's matches), 0..1 — relative popularity
  matches: number; // sample size
}

/** One observed skill order for a hero, with its empirical record. */
export interface AbilityOrderStat {
  abilities: number[]; // DB ability ids, in level order (up to 16 slots); unresolved ids dropped
  winrate: number; // wins / matches, 0..1
  matches: number; // sample size
}

const agg = aggregates as unknown as {
  synced_at: string;
  params: Record<string, number>;
  item_stats: { item_id: number; wins: number; matches: number }[];
  ability_orders: Record<string, { abilities: number[]; wins: number; matches: number }[]>;
};

const wr = (wins: number, matches: number) => (matches > 0 ? wins / matches : 0);

/**
 * Global per-item win + pick rates, sorted by pickrate descending.
 * Pickrate is relative to the most-played item (=1.0) — a stable popularity axis
 * for the two-axis "popular vs winning" /items ranking.
 */
export function getItemAggregates(): ItemAggregate[] {
  const rows = agg.item_stats ?? [];
  const maxMatches = rows.reduce((m, r) => Math.max(m, r.matches), 0) || 1;
  return rows
    .map((r) => ({
      itemId: r.item_id,
      winrate: wr(r.wins, r.matches),
      pickrate: r.matches / maxMatches,
      matches: r.matches,
    }))
    .sort((a, b) => b.pickrate - a.pickrate);
}

/**
 * Per-hero skill-order win stats — "which skill order actually wins" — sorted by
 * matches descending (most-common orders first). `heroId` is the DB hero id.
 */
export function getAbilityOrderStats(heroId: number): AbilityOrderStat[] {
  const rows = agg.ability_orders?.[heroId] ?? [];
  return rows
    .map((r) => ({ abilities: r.abilities, winrate: wr(r.wins, r.matches), matches: r.matches }))
    .sort((a, b) => b.matches - a.matches);
}

/** When the aggregates were last synced (for a freshness label). */
export function getAggregatesSyncedAt(): Date | null {
  return agg.synced_at ? new Date(agg.synced_at) : null;
}
