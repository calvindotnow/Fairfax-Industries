/**
 * "Discoveries" — the build-guidance-only surface for what's underrated / what's
 * moving on /items. Strictly framed as build advice, never tracker/leaderboard
 * vibes (locked constraint — no "trending," no match feeds).
 *
 * Hidden Gems is computable from a single snapshot (win-a-lot, built-rarely items —
 * see `getHiddenGems` in `src/lib/aggregates.ts` for the exact thresholds + rationale).
 * Risers/Droppers need two sync generations of history and are gated behind
 * `getItemAggregateDeltas()` returning non-null — on the very first bake (or whenever
 * a previous generation isn't available yet) that section renders nothing at all,
 * rather than faking movement. Nothing here is a tracker: no match feed, no recent
 * games, no rank distribution — only the same win/pick aggregate C1 already uses.
 */
import Image from "next/image";
import { format } from "date-fns";
import type { ItemWithModifiers } from "@/db/schema";
import type { ItemAggregate, ItemAggregateDelta } from "@/lib/aggregates";

type Cat = "weapon" | "vitality" | "spirit";

const CAT_TEXT: Record<Cat, string> = {
  weapon: "text-weapon",
  vitality: "text-vitality",
  spirit: "text-spirit",
};

const compactCount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
};

// A meaningful move worth flagging, in absolute percentage points — smaller shifts are
// bake-to-bake noise, not a real riser/dropper.
const MIN_NOTABLE_DELTA = 0.02;

// Rows to show per list — keeps the strip compact regardless of how many items qualify.
const MAX_ROWS = 8;

export interface DiscoveryItemRow {
  item: ItemWithModifiers;
  agg: ItemAggregate;
}

export interface DiscoveryDeltaRow {
  item: ItemWithModifiers;
  delta: ItemAggregateDelta;
}

function ItemRow({
  rank,
  item,
  right,
  sub,
}: {
  rank: number;
  item: ItemWithModifiers;
  right: React.ReactNode;
  sub: React.ReactNode;
}) {
  const c = item.category as Cat;
  return (
    <div className="flex items-center gap-3 bg-background px-4 py-2.5">
      <span
        className="w-5 shrink-0 text-right text-xs text-muted-foreground"
        style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums" }}
      >
        {rank}
      </span>
      {item.imageUrl ? (
        <Image
          src={item.imageUrl}
          alt={item.name}
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 object-contain"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{item.name}</p>
        <p className="text-[10px] uppercase tracking-wider">
          <span className={CAT_TEXT[c]}>{item.category}</span>
          <span className="text-muted-foreground"> · Tier {item.tier}</span>
        </p>
      </div>
      <div className="shrink-0 text-right">
        {right}
        <p className="text-[10px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function HiddenGems({ rows, params }: { rows: DiscoveryItemRow[]; params: { itemMinMatches: number } }) {
  const gemMinMatches = Math.max(params.itemMinMatches * 2, 400);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="overline">Hidden gems</p>
      <div
        className="overflow-hidden rounded-lg border border-border bg-border"
        style={{ display: "flex", flexDirection: "column", gap: 1 }}
      >
        {rows.slice(0, MAX_ROWS).map((r, i) => (
          <ItemRow
            key={r.item.id}
            rank={i + 1}
            item={r.item}
            right={
              <p
                className="text-foreground"
                style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 14 }}
              >
                {Math.round(r.agg.winrate * 100)}%
              </p>
            }
            sub={`${Math.round(r.agg.pickrate * 100)}% pick · ${compactCount(r.agg.matches)} matches`}
          />
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Wins a lot, built rarely — win rate ≥ 56%, pick rate in the bottom 10% of the pool, min{" "}
        {gemMinMatches.toLocaleString()} matches so small samples can&apos;t sneak in. Build guidance,
        not a leaderboard: worth a look next time you&apos;re shopping.
      </p>
    </div>
  );
}

function MoversList({
  title,
  rows,
  positive,
}: {
  title: string;
  rows: DiscoveryDeltaRow[];
  positive: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="overline">{title}</p>
      <div
        className="overflow-hidden rounded-lg border border-border bg-border"
        style={{ display: "flex", flexDirection: "column", gap: 1 }}
      >
        {rows.slice(0, MAX_ROWS).map((r, i) => {
          const pts = Math.round(r.delta.winrateDelta * 1000) / 10;
          const color = positive ? "var(--cash-500)" : "var(--danger-500)";
          return (
            <ItemRow
              key={r.item.id}
              rank={i + 1}
              item={r.item}
              right={
                <p
                  style={{
                    fontFamily: "var(--font-numeric)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 14,
                    color,
                  }}
                >
                  {pts > 0 ? "+" : ""}
                  {pts.toFixed(1)}pp
                </p>
              }
              sub={`now ${Math.round(r.delta.winrate * 100)}% win · ${compactCount(r.delta.matches)} matches`}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function Discoveries({
  gems,
  risers,
  droppers,
  syncedAt,
  params,
}: {
  gems: DiscoveryItemRow[];
  risers: DiscoveryDeltaRow[];
  droppers: DiscoveryDeltaRow[];
  syncedAt: string | null;
  params: { minAverageBadge: number; itemMinMatches: number; windowDays: number };
}) {
  const hasMovement = risers.length > 0 || droppers.length > 0;
  if (gems.length === 0 && !hasMovement) return null;

  return (
    <section className="space-y-6">
      <p className="overline">Discoveries</p>
      <div className="grid gap-8 md:grid-cols-2">
        <HiddenGems rows={gems} params={params} />
        {hasMovement && (
          <div className="space-y-6">
            <MoversList title="Risers" rows={risers} positive />
            <MoversList title="Droppers" rows={droppers} positive={false} />
          </div>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        High-rank ranked matches, last {params.windowDays} days
        {syncedAt ? ` · synced ${format(new Date(syncedAt), "PP")}` : ""}. Global across all heroes —
        not hero-specific.
        {!hasMovement
          ? " Risers/Droppers need two sync cycles of history and will appear once there's a prior bake to compare against."
          : ` Risers/Droppers show items whose win rate moved at least ${(MIN_NOTABLE_DELTA * 100).toFixed(0)}pp since the previous sync.`}
      </p>
    </section>
  );
}
