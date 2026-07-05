import ItemBrowser from "./item-browser";
import ItemRankings, { type RankedItemRow } from "./item-rankings";
import { getItems } from "@/lib/data";
import { getItemAggregates, getAggregatesSyncedAt } from "@/lib/aggregates";

const AGG_PARAMS = { minAverageBadge: 80, itemMinMatches: 200, windowDays: 30 };

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

      <ItemBrowser items={items} />
    </div>
  );
}
