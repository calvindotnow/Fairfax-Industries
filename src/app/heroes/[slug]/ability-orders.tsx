import Image from "next/image";
import { format } from "date-fns";
import type { Ability } from "@/db/schema";
import type { AbilityOrderStat } from "@/lib/aggregates";

const compactMatches = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
};

export default function AbilityOrders({
  orders,
  abilities,
  syncedAt,
  params,
}: {
  orders: AbilityOrderStat[];
  abilities: Ability[];
  syncedAt: string | null;
  params: { abilityOrderMinMatches: number; windowDays: number };
}) {
  if (orders.length === 0) return null;

  const abilityById = new Map(abilities.map((a) => [a.id, a]));
  const top = orders.slice(0, 5);

  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl text-foreground">Which skill order wins</h2>
      <div className="overflow-hidden rounded-lg border border-border bg-border" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {top.map((order, i) => (
          <div key={i} className="flex items-center gap-3 bg-background px-4 py-3">
            <span
              className="w-4 shrink-0 text-right text-xs text-muted-foreground"
              style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums" }}
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {order.abilities.map((abilityId, j) => {
                const ability = abilityById.get(abilityId);
                if (!ability) return null;
                return (
                  <span
                    key={`${abilityId}-${j}`}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-[var(--surface-raised)] px-1.5 py-1"
                    title={ability.name}
                  >
                    {ability.imageUrl ? (
                      <Image
                        src={ability.imageUrl}
                        alt=""
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px] object-contain"
                      />
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">{j + 1}</span>
                  </span>
                );
              })}
            </div>
            <div className="shrink-0 text-right">
              <p
                className="text-foreground"
                style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 14 }}
              >
                {Math.round(order.winrate * 100)}%
              </p>
              <p className="text-[10px] text-muted-foreground">
                {compactMatches(order.matches)} matches
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Level-up order 1–{top[0]?.abilities.length ?? 16}, from high-rank ranked matches, last{" "}
        {params.windowDays} days
        {syncedAt ? ` · synced ${format(new Date(syncedAt), "PP")}` : ""}. Minimum{" "}
        {params.abilityOrderMinMatches.toLocaleString()} matches per order.
      </p>
    </section>
  );
}
