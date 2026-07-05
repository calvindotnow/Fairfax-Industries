/**
 * Pure build-path distillation + soul-fill helpers (no I/O, fully testable).
 *
 * `distillBuildPath` turns raw `item-flow-stats` nodes (the API's 4-phase build graph,
 * with `avg_net_worth_at_buy` as the souls anchor) into a per-hero, souls-ordered
 * timeline. `fillToSouls` answers "which items does the average enemy own at soul N?".
 *
 * Shared by the sync (bakes `build_paths` into lane-lab-data.json) and the lane-lab
 * accessors. See docs/superpowers/specs/2026-07-04-lane-lab-v2-auto-enemy-design.md.
 */

/** One item on a hero's average build path. `souls` = avg net worth at purchase (the timeline anchor). */
export interface BuildPathStep {
  itemId: number; // DB item id (translated from the api item_id at sync time, like counter items)
  souls: number; // round(avg_net_worth_at_buy) — the souls axis; ascending across the path
  pickrate: number; // matches / hero_total_matches — 0..1, how common this item is on this hero
  winrate: number; // wins / matches for this node — honest context, never prescriptive
}

/** A hero's distilled average build path: steps ascending by `souls`. */
export type BuildPath = BuildPathStep[];

/** Raw item-flow node (only the fields we use). */
export interface FlowNode {
  column: number;
  item_id: number;
  wins: number;
  matches: number;
  avg_net_worth_at_buy: number;
}

/**
 * Distill nodes → ascending-by-souls path. An item can appear in several build phases
 * (columns); keep the node with the MOST matches (kills the noisy col-0 entries), map
 * `avg_net_worth_at_buy` → souls, drop items below `minPickrate`, sort ascending by souls.
 */
export function distillBuildPath(
  nodes: FlowNode[],
  totalMatches: number,
  minPickrate: number,
): BuildPathStep[] {
  const byItem = new Map<number, FlowNode>();
  for (const n of nodes) {
    const cur = byItem.get(n.item_id);
    if (!cur || n.matches > cur.matches) byItem.set(n.item_id, n); // de-dup by max matches
  }
  const total = totalMatches > 0 ? totalMatches : 1;
  return [...byItem.values()]
    .map((n) => ({
      itemId: n.item_id,
      souls: Math.round(n.avg_net_worth_at_buy),
      pickrate: n.matches / total,
      winrate: n.matches > 0 ? n.wins / n.matches : 0,
    }))
    .filter((s) => s.pickrate >= minPickrate)
    .sort((a, b) => a.souls - b.souls);
}

/**
 * Items owned at `souls`: every step with `souls <= souls`, capped at `maxItems`.
 * On overflow keep the highest-pickrate `maxItems`, then restore souls order for
 * stable display. Returns item ids.
 */
export function fillToSouls(path: BuildPath, souls: number, maxItems: number): number[] {
  const owned = path.filter((s) => s.souls <= souls);
  if (owned.length <= maxItems) return owned.map((s) => s.itemId);
  const keep = new Set(
    [...owned]
      .sort((a, b) => b.pickrate - a.pickrate)
      .slice(0, maxItems)
      .map((s) => s.itemId),
  );
  return owned.filter((s) => keep.has(s.itemId)).map((s) => s.itemId);
}
