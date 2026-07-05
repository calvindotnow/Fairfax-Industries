import ItemBrowser from "./item-browser";
import ItemRankings, { type RankedItemRow } from "./item-rankings";
import Discoveries, { type DiscoveryItemRow, type DiscoveryDeltaRow } from "./discoveries";
import { getItems } from "@/lib/data";
import {
  getItemAggregates,
  getAggregatesSyncedAt,
  getHiddenGems,
  getItemAggregateDeltas,
} from "@/lib/aggregates";

const AGG_PARAMS = { minAverageBadge: 80, itemMinMatches: 200, windowDays: 30 };
const MIN_NOTABLE_DELTA = 0.02; // 2 percentage points — smaller moves are bake-to-bake noise

export default async function ItemsPage() {
  const items = getItems();
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const rankedRows: RankedItemRow[] = getItemAggregates()
    .map((agg) => {
      const item = itemsById.get(agg.itemId);
      return item ? { item, agg } : null;
    })
    .filter((r): r is RankedItemRow => r !== null);
  const syncedAt = getAggregatesSyncedAt();

  const gemRows: DiscoveryItemRow[] = getHiddenGems()
    .map((agg) => {
      const item = itemsById.get(agg.itemId);
      return item ? { item, agg } : null;
    })
    .filter((r): r is DiscoveryItemRow => r !== null);

  const deltas = getItemAggregateDeltas();
  const notable = (deltas ?? []).filter((d) => Math.abs(d.winrateDelta) >= MIN_NOTABLE_DELTA);
  const toDeltaRow = (d: (typeof notable)[number]): DiscoveryDeltaRow | null => {
    const item = itemsById.get(d.itemId);
    return item ? { item, delta: d } : null;
  };
  const riserRows: DiscoveryDeltaRow[] = notable
    .filter((d) => d.winrateDelta > 0)
    .sort((a, b) => b.winrateDelta - a.winrateDelta)
    .map(toDeltaRow)
    .filter((r): r is DiscoveryDeltaRow => r !== null);
  const dropperRows: DiscoveryDeltaRow[] = notable
    .filter((d) => d.winrateDelta < 0)
    .sort((a, b) => a.winrateDelta - b.winrateDelta)
    .map(toDeltaRow)
    .filter((r): r is DiscoveryDeltaRow => r !== null);

  return (
    <div className="space-y-10">
      <section className="max-w-2xl">
        <p className="overline mb-5">Armory</p>
        <h1 className="font-display text-4xl leading-[1.05] text-foreground md:text-5xl">
          Items
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          The full shop for the current patch. Filter by category, tier, or
          name — every stat is the cumulative total at that tier.
        </p>
      </section>

      <ItemRankings
        rows={rankedRows}
        syncedAt={syncedAt ? syncedAt.toISOString() : null}
        params={AGG_PARAMS}
      />

      <Discoveries
        gems={gemRows}
        risers={riserRows}
        droppers={dropperRows}
        syncedAt={syncedAt ? syncedAt.toISOString() : null}
        params={AGG_PARAMS}
      />

      <ItemBrowser items={items} />
    </div>
  );
}
