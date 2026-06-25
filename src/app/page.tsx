import { db } from "@/db";
import { heroes, items } from "@/db/schema";
import { sql, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [heroRow] = await db.select({ count: sql<number>`count(*)` }).from(heroes);
  const [itemRow] = await db.select({ count: sql<number>`count(*)` }).from(items);

  const portraits = await db
    .select({ name: heroes.name, image: heroes.imageUrl })
    .from(heroes)
    .where(isNotNull(heroes.imageUrl))
    .limit(12);

  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="max-w-2xl">
        <p className="overline mb-5">Deadlock theorycrafting</p>
        <h1 className="font-display text-5xl md:text-6xl leading-[1.05] text-foreground">
          Build it.{" "}
          <span className="italic text-primary">Prove</span> it.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Assemble a hero and items, then watch real damage, breakpoints, and
          time-to-kill computed against any enemy — backed by live patch data.
          No more doing the math by hand in the practice range.
        </p>
        <div className="mt-8 flex items-center gap-4">
          <Link
            href="/proving-ground"
            className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open the Proving Ground
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Roster strip */}
      <section>
        <div className="flex flex-wrap gap-2.5">
          {portraits.map((h) => (
            <div
              key={h.name}
              title={h.name}
              className="h-14 w-14 overflow-hidden rounded-md surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={h.image!}
                alt={h.name}
                className="h-full w-full object-cover opacity-90 transition-opacity hover:opacity-100"
              />
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          <span className="text-foreground">{heroRow.count}</span> heroes ·{" "}
          <span className="text-foreground">{itemRow.count}</span> items · synced
          from live game data
        </p>
      </section>

      {/* What it does */}
      <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
        {[
          {
            title: "Simulate damage",
            body: "Exact DPS, burst combos, and time-to-kill against any hero's resistances.",
          },
          {
            title: "Find breakpoints",
            body: "See where each item stops being worth its souls before you commit.",
          },
          {
            title: "Compare builds",
            body: "Put two builds side by side and settle the argument with numbers.",
          },
        ].map((f) => (
          <div key={f.title} className="bg-background p-6">
            <h3 className="text-lg text-foreground">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {f.body}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
