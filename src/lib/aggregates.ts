/**
 * Curated empirical aggregates — item win/pick rates (global) and per-hero
 * ability-order win stats — read from the separately baked `aggregates-data.json`.
 *
 * Kept in its own module + JSON (pattern: lane-lab.ts / lane-lab-data.json) so the
 * data is lazy-loaded only into the pages that need it (/items, /heroes/<slug>),
 * never inflating the shared baked-data.json main bundle.
 *
 * This is the ONLY interface the C1 (/items two-axis ranking), C2 (ability-order
 * table), and C3 (Hidden Gems / Risers / Droppers discovery surface) should use.
 * Data baked by scripts/sync-deadlock-api.ts.
 *
 * NOTE: `bucket=hero` on /v1/analytics/item-stats returns HTTP 500 upstream (a
 * persistent server-side DB error as of 2026-07-04); per-hero item data is fetched
 * via `?hero_ids=<id>` (plural — singular `hero_id` is honored on item-stats but
 * plural is used for consistency with the rest of the sync). Global item aggregates
 * use the un-bucketed call.
 *
 * HISTORY (C3): `item_stats` bakes as `{ current, previous }` — mirroring the
 * two-generation pattern `baked-data.json` already uses for stat snapshots (see
 * `src/lib/snapshot.ts` / `patch-diff.ts`). Each sync carries the prior run's
 * `current` forward as the new `previous` before overwriting, so deltas accumulate
 * across sync cycles. `previous` is `null` until a second real sync has run — never
 * fabricated. Ability orders have no history (C2 doesn't need "movement").
 */
import aggregates from "./aggregates-data.json";

/** One item's global empirical performance (for the /items two-axis ranking). */
export interface ItemAggregate {
  itemId: number; // DB item id
  winrate: number; // wins / matches, 0..1
  pickrate: number; // matches / (most-played item's matches), 0..1 — relative popularity
  matches: number; // sample size
}

/** How one item's winrate/pickrate moved between the two most recent syncs. */
export interface ItemAggregateDelta {
  itemId: number; // DB item id
  winrate: number; // current winrate, 0..1 (for display alongside the delta)
  pickrate: number; // current pickrate, 0..1
  matches: number; // current sample size
  winrateDelta: number; // current.winrate - previous.winrate (signed, e.g. +0.03)
  pickrateDelta: number; // current.pickrate - previous.pickrate (signed)
}

/** One observed skill order for a hero, with its empirical record. */
export interface AbilityOrderStat {
  abilities: number[]; // DB ability ids, in level order (up to 16 slots); unresolved ids dropped
  winrate: number; // wins / matches, 0..1
  matches: number; // sample size
}

type RawItemStatsRow = { item_id: number; wins: number; matches: number };

const agg = aggregates as unknown as {
  synced_at: string;
  params: Record<string, number>;
  item_stats: { current: RawItemStatsRow[]; previous: RawItemStatsRow[] | null };
  ability_orders: Record<string, { abilities: number[]; wins: number; matches: number }[]>;
};

const wr = (wins: number, matches: number) => (matches > 0 ? wins / matches : 0);

const currentItemStatsRows = (): RawItemStatsRow[] => agg.item_stats?.current ?? [];

/**
 * Global per-item win + pick rates, sorted by pickrate descending.
 * Pickrate is relative to the most-played item (=1.0) — a stable popularity axis
 * for the two-axis "popular vs winning" /items ranking.
 */
export function getItemAggregates(): ItemAggregate[] {
  const rows = currentItemStatsRows();
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
 * Winrate/pickrate movement between the two most recent aggregate syncs — powers
 * Risers/Droppers. Returns `null` when there's no previous generation yet (first
 * bake, or a legacy pre-history file) so the UI can hide the section cleanly
 * instead of showing fabricated/zeroed movement. Only items present in BOTH
 * generations are included (an item that's simply new this patch has no "before").
 */
export function getItemAggregateDeltas(): ItemAggregateDelta[] | null {
  const prevRows = agg.item_stats?.previous;
  if (!prevRows || prevRows.length === 0) return null;
  const maxCurrentMatches = currentItemStatsRows().reduce((m, r) => Math.max(m, r.matches), 0) || 1;
  const maxPrevMatches = prevRows.reduce((m, r) => Math.max(m, r.matches), 0) || 1;
  const prevByItem = new Map(prevRows.map((r) => [r.item_id, r]));
  return currentItemStatsRows()
    .filter((r) => prevByItem.has(r.item_id))
    .map((r) => {
      const prev = prevByItem.get(r.item_id)!;
      const winrate = wr(r.wins, r.matches);
      const pickrate = r.matches / maxCurrentMatches;
      const prevWinrate = wr(prev.wins, prev.matches);
      const prevPickrate = prev.matches / maxPrevMatches;
      return {
        itemId: r.item_id,
        winrate,
        pickrate,
        matches: r.matches,
        winrateDelta: winrate - prevWinrate,
        pickrateDelta: pickrate - prevPickrate,
      };
    });
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

/**
 * "Hidden Gems" — items that win a lot but are built rarely, computable from a single
 * snapshot (no history needed, unlike Risers/Droppers). Thresholds are deliberately
 * stricter than the plain /items ranking floor because a gem is a stronger claim
 * ("underrated") than a plain leaderboard row:
 *  - `winrate >= GEM_MIN_WINRATE` (0.56): comfortably above this dataset's own p75
 *    (~0.546 as of the 2026-07 bake) — a plain "good" item, not just noise around the
 *    ~0.51 median. (Per-item winrate here runs hotter than a symmetric 50/50 stat
 *    because it's win-rate-when-built, not a balanced 1v1 outcome, so the useful bar
 *    is "meaningfully above this pool's own middle," not a fixed universal number.)
 *  - `pickrate <= GEM_MAX_PICKRATE` (0.10): bottom of the popularity distribution
 *    relative to the most-picked item — genuinely under-the-radar, not just "not the
 *    single most popular thing."
 *  - `matches >= GEM_MIN_MATCHES` (400 = 2x the sync's own 200-match floor for ANY
 *    item aggregate): a stronger sample floor than the baseline ranking, since "this
 *    is secretly great" is a claim that must not ride a small-sample hot streak.
 * Sorted by winrate descending, caller should cap the displayed count (compact UI).
 */
const GEM_MIN_WINRATE = 0.56;
const GEM_MAX_PICKRATE = 0.1;
const GEM_MIN_MATCHES = 400;

export function getHiddenGems(): ItemAggregate[] {
  return getItemAggregates()
    .filter((r) => r.winrate >= GEM_MIN_WINRATE && r.pickrate <= GEM_MAX_PICKRATE && r.matches >= GEM_MIN_MATCHES)
    .sort((a, b) => b.winrate - a.winrate);
}

/** When the aggregates were last synced (for a freshness label). */
export function getAggregatesSyncedAt(): Date | null {
  return agg.synced_at ? new Date(agg.synced_at) : null;
}
