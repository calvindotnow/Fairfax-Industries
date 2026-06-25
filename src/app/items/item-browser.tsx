"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { ItemWithModifiers, ItemStatModifier } from "@/db/schema";
import { STAT_DEFINITIONS } from "@/lib/sim";

type Cat = "weapon" | "vitality" | "spirit";

const CATS: Cat[] = ["weapon", "vitality", "spirit"];
const TIERS = [1, 2, 3, 4];

// Tailwind text-color token per category (mapped in globals.css @theme).
const CAT_TEXT: Record<Cat, string> = {
  weapon: "text-weapon",
  vitality: "text-vitality",
  spirit: "text-spirit",
};

const STAT_LABEL: Record<string, string> = Object.fromEntries(
  STAT_DEFINITIONS.map((d) => [d.key as string, d.label]),
);

function statLine(m: ItemStatModifier): string {
  const label = STAT_LABEL[m.statName] ?? m.statName;
  if (m.percentBonus) return `+${m.percentBonus}% ${label}`;
  return `+${m.flatBonus} ${label}`;
}

export default function ItemBrowser({ items }: { items: ItemWithModifiers[] }) {
  const [cat, setCat] = useState<Cat | "all">("all");
  const [tier, setTier] = useState<number | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        (cat === "all" || i.category === cat) &&
        (tier === "all" || i.tier === tier) &&
        (q === "" ||
          i.name.toLowerCase().includes(q) ||
          (i.description ?? "").toLowerCase().includes(q)),
    );
  }, [items, cat, tier, search]);

  const pill = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm transition-colors ${
      active
        ? "border-[var(--border-strong)] bg-[var(--surface-raised)] text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setCat("all")} className={pill(cat === "all")}>
            All
          </button>
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`${pill(cat === c)} capitalize ${cat === c ? CAT_TEXT[c] : ""}`}
            >
              {c}
            </button>
          ))}
        </div>

        <span className="h-5 w-px bg-border" />

        <div className="flex flex-wrap gap-1">
          <button onClick={() => setTier("all")} className={pill(tier === "all")}>
            All tiers
          </button>
          {TIERS.map((t) => (
            <button key={t} onClick={() => setTier(t)} className={pill(tier === t)}>
              Tier {t}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items"
          aria-label="Search items"
          className="ml-auto min-w-[160px] rounded-md border border-border bg-[var(--surface-raised)] px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">{filtered.length}</span>{" "}
        {filtered.length === 1 ? "item" : "items"}
      </p>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((it) => {
          const c = it.category as Cat;
          return (
            <div key={it.id} className="surface flex gap-3 rounded-lg p-4">
              {it.imageUrl ? (
                <Image
                  src={it.imageUrl}
                  alt={it.name}
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 object-contain"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-base text-foreground">{it.name}</p>
                  <span className="shrink-0 font-display text-sm text-[var(--cash-500)]">
                    §{it.soulCost.toLocaleString()}
                  </span>
                </div>
                <p className="mt-0.5 text-xs uppercase tracking-wider">
                  <span className={CAT_TEXT[c]}>{it.category}</span>
                  <span className="text-muted-foreground"> · Tier {it.tier}</span>
                  {it.isActive ? (
                    <span className="text-weapon"> · Active</span>
                  ) : null}
                </p>
                {it.description ? (
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {it.description}
                  </p>
                ) : null}
                {it.modifiers.length > 0 ? (
                  <ul className="mt-2 space-y-0.5">
                    {it.modifiers.map((m) => (
                      <li key={m.id} className={`text-sm ${CAT_TEXT[c]}`}>
                        {statLine(m)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No items match those filters.
        </p>
      ) : null}
    </div>
  );
}
