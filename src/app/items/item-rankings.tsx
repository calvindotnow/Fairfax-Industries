"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { format } from "date-fns";
import type { ItemWithModifiers } from "@/db/schema";
import type { ItemAggregate } from "@/lib/aggregates";

type Cat = "weapon" | "vitality" | "spirit";

// Tailwind text-color token per category (mapped in globals.css @theme).
const CAT_TEXT: Record<Cat, string> = {
  weapon: "text-weapon",
  vitality: "text-vitality",
  spirit: "text-spirit",
};

const compactMatches = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
};

export interface RankedItemRow {
  item: ItemWithModifiers;
  agg: ItemAggregate;
}

type Sort = "popular" | "winrate";

export default function ItemRankings({
  rows,
  syncedAt,
  params,
}: {
  rows: RankedItemRow[];
  syncedAt: string | null;
  params: { minAverageBadge: number; itemMinMatches: number; windowDays: number };
}) {
  const [sort, setSort] = useState<Sort>("popular");

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sort === "popular") copy.sort((a, b) => b.agg.pickrate - a.agg.pickrate);
    else copy.sort((a, b) => b.agg.winrate - a.agg.winrate);
    return copy.slice(0, 10);
  }, [rows, sort]);

  if (rows.length === 0) return null;

  const tabBtn = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm transition-colors ${
      active
        ? "border-[var(--border-strong)] bg-[var(--surface-raised)] text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="overline">What people build</p>
        <div className="flex gap-1" role="tablist" aria-label="Sort item rankings">
          <button
            type="button"
            role="tab"
            aria-selected={sort === "popular"}
            onClick={() => setSort("popular")}
            className={tabBtn(sort === "popular")}
          >
            Most picked
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sort === "winrate"}
            onClick={() => setSort("winrate")}
            className={tabBtn(sort === "winrate")}
          >
            Highest win rate
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-border" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {sorted.map((r, i) => {
          const c = r.item.category as Cat;
          return (
            <div key={r.item.id} className="flex items-center gap-3 bg-background px-4 py-2.5">
              <span
                className="w-5 shrink-0 text-right text-xs text-muted-foreground"
                style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums" }}
              >
                {i + 1}
              </span>
              {r.item.imageUrl ? (
                <Image
                  src={r.item.imageUrl}
                  alt={r.item.name}
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 object-contain"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{r.item.name}</p>
                <p className="text-[10px] uppercase tracking-wider">
                  <span className={CAT_TEXT[c]}>{r.item.category}</span>
                  <span className="text-muted-foreground"> · Tier {r.item.tier}</span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className="text-foreground"
                  style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 14 }}
                >
                  {Math.round(r.agg.winrate * 100)}%
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {compactMatches(r.agg.matches)} matches
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Win/pick rates from high-rank ranked matches, last {params.windowDays} days
        {syncedAt ? ` · synced ${format(new Date(syncedAt), "PP")}` : ""}. Global across all
        heroes — not hero-specific. Minimum {params.itemMinMatches.toLocaleString()} matches per
        item.
      </p>
    </section>
  );
}
