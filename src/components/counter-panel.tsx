"use client";

import { useMemo } from "react";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";
import { simulate } from "@/lib/sim";
import type { SimOptions } from "@/lib/sim";
import { getMatchup, getCounterItems } from "@/lib/lane-lab";
import { duelAdvantage, pickCandidates, valuePerSoul, splitByCost, withinLaneWindow, LANE_COST } from "@/lib/counter";

// Defensive staple names resolved at runtime so IDs don't need to be hardcoded.
// These augment the empirical counter pool; the empirical signal is primary.
// "Spirit Armor" is absent from the current data; STAPLES = [] is effectively
// fine — the empirical counters carry the candidates.
const STAPLE_NAMES = ["Metal Skin", "Plated Armor"];

export function CounterPanel({
    hero,
    enemy,
    yourItems,
    enemyItems,
    opts,
    items,
    onAddItem,
    fmt,
}: {
    hero: HeroWithAbilities;
    enemy: HeroWithAbilities;
    yourItems: ItemWithModifiers[];
    enemyItems: ItemWithModifiers[];
    opts: SimOptions;
    items: ItemWithModifiers[];
    onAddItem: (id: number) => void;
    fmt: (n: number) => string;
}) {
    const matchup = useMemo(() => getMatchup(hero.id, enemy.id), [hero.id, enemy.id]);
    const counterItems = useMemo(() => getCounterItems(hero.id, enemy.id), [hero.id, enemy.id]);
    const yourItemIds = useMemo(() => yourItems.map((it) => it.id), [yourItems]);

    // Staple ids resolved from the full items list
    const stapleIds = useMemo(
        () => items.filter((it) => STAPLE_NAMES.includes(it.name)).map((it) => it.id),
        [items]
    );

    // Sim-ranked candidates: each row carries deltaA, TTK/EHP deltas, soulCost, buyTimeS, winrate
    /* eslint-disable react-hooks/exhaustive-deps */
    const liftRows = useMemo(() => {
        const counterItemIds = counterItems.map((r) => r.itemId);
        const candidates = pickCandidates(counterItemIds, yourItemIds, stapleIds, 16);
        if (candidates.length === 0) return [];

        // Base sims — no candidate item added yet
        const baseFwd = simulate(
            { hero, items: yourItems },
            { hero: enemy, items: enemyItems },
            opts
        );
        const baseRev = simulate(
            { hero: enemy, items: enemyItems },
            { hero, items: yourItems },
            opts
        );
        const baseTTK = baseFwd.timeToKill;
        const baseYourEHP = baseRev.theirEhp;
        const base = duelAdvantage(baseTTK, baseRev.timeToKill);

        // Per-candidate: two sims each (forward = your offense, reverse = their offense on you)
        return candidates.flatMap((itemId) => {
            const itemObj = items.find((it) => it.id === itemId);
            if (!itemObj) return [];

            const fwd = simulate(
                { hero, items: [...yourItems, itemObj] },
                { hero: enemy, items: enemyItems },
                opts
            );
            // Reverse: enemy attacks you-with-item; theirEhp = your EHP as the target
            const rev = simulate(
                { hero: enemy, items: enemyItems },
                { hero, items: [...yourItems, itemObj] },
                opts
            );
            const yourTTK = fwd.timeToKill;
            const theirTTK = rev.timeToKill;
            const yourEHP = rev.theirEhp;
            const withItem = duelAdvantage(yourTTK, theirTTK);
            const deltaA = withItem - base;
            // Offense delta: how much faster you kill them (negative = better)
            const dTTK = yourTTK != null && baseTTK != null ? yourTTK - baseTTK : null;
            // Defense delta: how much more EHP you gain (positive = better)
            const dEHP = yourEHP - baseYourEHP;
            const soulCost = itemObj.soulCost ?? 0;
            const ctr = counterItems.find((r) => r.itemId === itemId);
            const buyTimeS = ctr?.buyTimeS ?? null;
            const winrate = ctr?.winrate ?? null;

            return [{ itemId, item: itemObj, deltaA, dTTK, dEHP, soulCost, buyTimeS, winrate }];
        });
    }, [hero.id, enemy.id, yourItems, enemyItems, opts, items, stapleIds, counterItems]);
    /* eslint-enable react-hooks/exhaustive-deps */

    // Split into lane (affordable) vs power-spike groups, sorted by the appropriate signal
    const { lane, powerSpike } = useMemo(() => {
        const split = splitByCost(liftRows);
        // Lane picks must be lane-timed, not just cheap: drop rows people actually buy
        // after ~15:00 on average (they'd be mid-game advice wearing a lane label).
        const laneSorted = [...withinLaneWindow(split.lane)].sort(
            (a, b) => valuePerSoul(b.deltaA, b.soulCost) - valuePerSoul(a.deltaA, a.soulCost)
        );
        const powerSorted = [...split.powerSpike].sort((a, b) => b.deltaA - a.deltaA);
        return { lane: laneSorted, powerSpike: powerSorted };
    }, [liftRows]);

    // deltaA → glyph: tuning thresholds — 0.1 / 0.3 are open knobs per the design spec
    const glyph = (deltaA: number) => {
        if (deltaA >= 0.3) return "▲▲";
        if (deltaA >= 0.1) return "▲";
        return "·";
    };

    // Matchup framing — honest: show who beats whom with actual winrate
    const matchupText = (() => {
        if (!matchup) return null;
        const wr = Math.round(matchup.winrate * 100);
        if (matchup.winrate >= 0.5) {
            return `${hero.name} beats ${enemy.name} ${wr}% in lane · ${matchup.matches.toLocaleString()} matches`;
        }
        return `${enemy.name} beats ${hero.name} ${100 - wr}% in lane · ${matchup.matches.toLocaleString()} matches`;
    })();

    // Shared add-button style
    const addBtnStyle: React.CSSProperties = {
        height: 22, padding: "0 8px", borderRadius: "var(--r-sm)",
        border: "1px solid var(--border-strong)", background: "var(--surface-raised)",
        color: "var(--text-dim)", fontFamily: "var(--font-archivo)", fontSize: 11,
        cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
    };

    // Row renderer shared between Lane counters and Power spikes
    type LiftRow = { itemId: number; item: ItemWithModifiers; deltaA: number; dTTK: number | null; dEHP: number; soulCost: number; buyTimeS: number | null; winrate: number | null };
    const renderCounterRow = (r: LiftRow) => {
        const gl = glyph(r.deltaA);
        const glyphColor =
            gl === "▲▲" ? "var(--vitality-400)"
            : gl === "▲" ? "var(--brass-300)"
            : "var(--text-dim)";
        const ttkStr =
            r.dTTK == null ? "—"
            : r.dTTK <= 0 ? `${r.dTTK.toFixed(1)}s`
            : `+${r.dTTK.toFixed(1)}s`;
        const ttkColor = r.dTTK != null && r.dTTK < 0 ? "var(--weapon-400)" : "var(--text-dim)";
        const ehpStr = r.dEHP >= 0 ? `+${fmt(Math.round(r.dEHP))}` : fmt(Math.round(r.dEHP));
        const ehpColor = r.dEHP > 0 ? "var(--vitality-400)" : "var(--text-dim)";
        const buyMin = r.buyTimeS != null ? `~${Math.round(r.buyTimeS / 60)}m` : null;

        return (
            <div key={r.itemId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.item.name}
                </span>
                {/* Soul cost */}
                <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--text-dim)", minWidth: 48, textAlign: "right", flexShrink: 0 }}>
                    §{r.soulCost.toLocaleString()}
                </span>
                {/* Net glyph */}
                <span style={{ fontFamily: "var(--font-numeric)", fontSize: 11, color: glyphColor, minWidth: 16, textAlign: "center", flexShrink: 0 }}>
                    {gl}
                </span>
                {/* Offense: TTK delta */}
                <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: ttkColor, minWidth: 52, textAlign: "right", flexShrink: 0 }}>
                    TTK {ttkStr}
                </span>
                {/* Defense: EHP delta */}
                <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: ehpColor, minWidth: 68, textAlign: "right", flexShrink: 0 }}>
                    EHP {ehpStr}
                </span>
                {/* Empirical winrate */}
                {r.winrate != null && (
                    <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--vitality-400)", minWidth: 34, textAlign: "right", flexShrink: 0 }}>
                        {Math.round(r.winrate * 100)}%
                    </span>
                )}
                {/* Typical buy time — context only */}
                {buyMin && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)", opacity: 0.6, minWidth: 28, textAlign: "right", flexShrink: 0 }}>
                        {buyMin}
                    </span>
                )}
                <button type="button" onClick={() => onAddItem(r.itemId)} style={addBtnStyle}>
                    + add
                </button>
            </div>
        );
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Section 1: Lane matchup header ── */}
            <div style={{ paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.14em",
                    textTransform: "uppercase", color: "var(--text-dim)",
                }}>
                    Lane matchup
                </span>
                {matchupText ? (
                    <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--text)" }}>
                        {matchupText}
                    </p>
                ) : (
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                        Not enough lane data for this matchup.
                    </p>
                )}
            </div>

            {/* ── Sections 2+3: Lane Counters + Power Spikes (consolidated) ── */}
            {liftRows.length === 0 ? (
                <div>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                        Not enough lane data — no counter candidates for this matchup.
                    </p>
                </div>
            ) : (
                <>
                    {/* Lane counters group */}
                    <div style={{ paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                        <span style={{
                            display: "block", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em",
                            textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8,
                        }}>
                            Lane counters
                        </span>
                        {lane.length === 0 ? (
                            <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                                No counters both affordable and bought early enough for lane — see power spikes below.
                            </p>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {lane.map((r) => renderCounterRow(r))}
                            </div>
                        )}
                        <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                            ranked by value per soul · affordable picks bought before 15:00 on average
                        </p>
                    </div>

                    {/* Power spikes group */}
                    <div>
                        <span style={{
                            display: "block", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em",
                            textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8,
                        }}>
                            Power spikes
                        </span>
                        {powerSpike.length === 0 ? (
                            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                                No tier-4 counter candidates for this matchup.
                            </p>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {powerSpike.map((r) => renderCounterRow(r))}
                            </div>
                        )}
                        <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                            strongest counters · usually tier-4
                        </p>
                    </div>
                </>
            )}

            {/* ── Disclosure ── */}
            <div style={{
                paddingTop: 12, borderTop: "1px solid var(--border)",
                fontSize: 11, color: "var(--text-dim)", lineHeight: 1.55,
            }}>
                Groups split by soul cost (lane = §{LANE_COST.toLocaleString()} or under; power spikes = above).
                Lane counters ranked by sim duel-shift per soul and limited to items bought before 15:00 on
                average in real matches — cheap items people actually buy mid-game don&apos;t qualify as lane advice.
                Power spikes are the save-toward-it exceptions (typically bought 20m+) and ranked by raw duel-shift.
                Winrate is vs baseline from Deadlock match data (Phantom+, same-lane filter).
            </div>

        </div>
    );
}
