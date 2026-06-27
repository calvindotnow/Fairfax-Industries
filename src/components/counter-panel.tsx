"use client";

import { useMemo } from "react";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";
import { simulate } from "@/lib/sim";
import type { SimOptions } from "@/lib/sim";
import { getMatchup, getCounterItems } from "@/lib/data";
import { duelAdvantage, pickCandidates, rankByDuelShift } from "@/lib/counter";

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

    // Section 2: empirical top counters, excluding already-owned items
    const topCounters = useMemo(
        () => counterItems.filter((r) => !yourItemIds.includes(r.itemId)).slice(0, 8),
        [counterItems, yourItemIds]
    );

    // Staple ids resolved from the full items list
    const stapleIds = useMemo(
        () => items.filter((it) => STAPLE_NAMES.includes(it.name)).map((it) => it.id),
        [items]
    );

    // Section 3: sim-ranked biggest-lift candidates
    /* eslint-disable react-hooks/exhaustive-deps */
    const liftRows = useMemo(() => {
        const counterItemIds = counterItems.map((r) => r.itemId);
        const candidates = pickCandidates(counterItemIds, yourItemIds, stapleIds, 10);
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
        const rows = candidates.flatMap((itemId) => {
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

            return [{ itemId, item: itemObj, base, withItem, yourTTK, baseTTK, yourEHP, baseYourEHP }];
        });

        const ranked = rankByDuelShift(rows);

        return ranked.map(({ itemId, deltaA }) => {
            const r = rows.find((row) => row.itemId === itemId)!;
            // Offense delta: how much faster you kill them (negative = better)
            const dTTK =
                r.yourTTK != null && r.baseTTK != null ? r.yourTTK - r.baseTTK : null;
            // Defense delta: how much more EHP you gain (positive = better)
            const dEHP = r.yourEHP - r.baseYourEHP;
            return { itemId, item: r.item, deltaA, dTTK, dEHP };
        });
    }, [hero.id, enemy.id, yourItems, enemyItems, opts, items, stapleIds, counterItems]);
    /* eslint-enable react-hooks/exhaustive-deps */

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

            {/* ── Section 2: Top counter items (empirical) ── */}
            <div style={{ paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                <span style={{
                    display: "block", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em",
                    textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8,
                }}>
                    Top counters
                </span>
                {topCounters.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                        No counter-item data for this matchup.
                    </p>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {topCounters.map((r) => {
                            const it = items.find((x) => x.id === r.itemId);
                            const name = it?.name ?? `Item ${r.itemId}`;
                            return (
                                <div key={r.itemId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                    <span style={{ flex: 1, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {name}
                                    </span>
                                    <span style={{
                                        fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
                                        fontSize: 12, color: "var(--vitality-400)", minWidth: 34, textAlign: "right",
                                    }}>
                                        {Math.round(r.winrate * 100)}%
                                    </span>
                                    <span style={{
                                        fontSize: 11, color: "var(--text-dim)",
                                        minWidth: 44, textAlign: "right",
                                    }}>
                                        {r.matches >= 1000
                                            ? `${(r.matches / 1000).toFixed(0)}k`
                                            : r.matches.toString()}
                                    </span>
                                    <button type="button" onClick={() => onAddItem(r.itemId)} style={addBtnStyle}>
                                        + add
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                    Winrate vs baseline — items with the highest win frequency when playing this matchup.
                </p>
            </div>

            {/* ── Section 3: Biggest lift (sim-ranked) ── */}
            <div>
                <span style={{
                    display: "block", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em",
                    textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8,
                }}>
                    Biggest lift
                </span>
                {liftRows.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                        No candidates — add counter items to the enemy build first, or check that hero/enemy are set.
                    </p>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {liftRows.map((r) => {
                            const gl = glyph(r.deltaA);
                            const glyphColor =
                                gl === "▲▲" ? "var(--vitality-400)"
                                : gl === "▲" ? "var(--brass-300)"
                                : "var(--text-dim)";
                            // Offense: Δ yourTTK (negative = faster kill)
                            const ttkStr =
                                r.dTTK == null ? "—"
                                : r.dTTK <= 0 ? `${r.dTTK.toFixed(1)}s`
                                : `+${r.dTTK.toFixed(1)}s`;
                            const ttkColor =
                                r.dTTK != null && r.dTTK < 0 ? "var(--weapon-400)" : "var(--text-dim)";
                            // Defense: Δ yourEHP (positive = more survivable)
                            const ehpStr =
                                r.dEHP >= 0
                                    ? `+${fmt(Math.round(r.dEHP))}`
                                    : fmt(Math.round(r.dEHP));
                            const ehpColor = r.dEHP > 0 ? "var(--vitality-400)" : "var(--text-dim)";

                            return (
                                <div key={r.itemId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                    <span style={{
                                        flex: 1, color: "var(--text)", minWidth: 0,
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>
                                        {r.item.name}
                                    </span>
                                    {/* Net glyph */}
                                    <span style={{
                                        fontFamily: "var(--font-numeric)", fontSize: 11,
                                        color: glyphColor, minWidth: 16, textAlign: "center", flexShrink: 0,
                                    }}>
                                        {gl}
                                    </span>
                                    {/* Offense: TTK delta */}
                                    <span style={{
                                        fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
                                        fontSize: 11, color: ttkColor, minWidth: 52, textAlign: "right", flexShrink: 0,
                                    }}>
                                        TTK {ttkStr}
                                    </span>
                                    {/* Defense: EHP delta */}
                                    <span style={{
                                        fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
                                        fontSize: 11, color: ehpColor, minWidth: 68, textAlign: "right", flexShrink: 0,
                                    }}>
                                        EHP {ehpStr}
                                    </span>
                                    <button type="button" onClick={() => onAddItem(r.itemId)} style={addBtnStyle}>
                                        + add
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Disclosure ── */}
            <div style={{
                paddingTop: 12, borderTop: "1px solid var(--border)",
                fontSize: 11, color: "var(--text-dim)", lineHeight: 1.55,
            }}>
                Matchup and counter-item winrates from Deadlock match data (same-lane filter, min 100 matches).
                Sim deltas compare your build + each candidate — its stats plus the level gain from its soul cost — against the current enemy build; not a causal winrate projection.
                Net lift (▲▲/▲/·) = two-sided duel-advantage shift via the Fairfax engine.
            </div>

        </div>
    );
}
