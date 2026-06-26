import ItemBrowser from "./item-browser";
import { getItems } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const items = getItems();

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

      <ItemBrowser items={items} />
    </div>
  );
}
