"use client";

import { useEffect, useMemo, useState } from "react";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";
import { simulate } from "@/lib/sim";
import { encodeBuild, decodeBuild } from "@/lib/build-code";
import BuyMenu from "@/components/buy-menu";

interface ProvingGroundProps {
    heroes: HeroWithAbilities[];
    items: ItemWithModifiers[];
}

type Category = "weapon" | "vitality" | "spirit";

const CAT_COLOR: Record<Category, string> = {
    weapon: "var(--weapon-400)",
    vitality: "var(--vitality-400)",
    spirit: "var(--spirit-400)",
};


export default function ProvingGround({ heroes, items }: ProvingGroundProps) {
    const [heroId, setHeroId] = useState<number | null>(heroes[0]?.id ?? null);
    const [targetId, setTargetId] = useState<number | null>(heroes[1]?.id ?? heroes[0]?.id ?? null);
    const [loadout, setLoadout] = useState<number[]>([]);
    const [targetLoadout, setTargetLoadout] = useState<number[]>([]);
    const [buyingFor, setBuyingFor] = useState<"attacker" | "target">("attacker");
    const [matchTargetLevel, setMatchTargetLevel] = useState(false);
    const [range, setRange] = useState(25);
    const [shots, setShots] = useState(8);
    const [headshots, setHeadshots] = useState(0);
    // Ultimates are off by default — most heroes don't ult in a burst. Toggleable per hero.
    const ultIdsOf = (id: number | null) =>
        (heroes.find((h) => h.id === id)?.abilities ?? []).filter((a) => a.type === "ultimate").map((a) => a.id);
    const [disabledAbilities, setDisabledAbilities] = useState<Set<number>>(() => new Set(ultIdsOf(heroes[0]?.id ?? null)));

    // Reset to "ultimate off" defaults whenever the attacker hero changes.
    useEffect(() => { setDisabledAbilities(new Set(ultIdsOf(heroId))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [heroId]);

    // Restore a shared build from the URL (?b=…) on first load.
    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("b");
        if (!code) return;
        const s = decodeBuild(code, heroes, items);
        if (!s) return;
        if (s.heroId != null) setHeroId(s.heroId);
        if (s.targetId != null) setTargetId(s.targetId);
        setLoadout(s.loadout);
        setTargetLoadout(s.targetLoadout);
        setRange(s.range);
        setShots(s.shots);
        setHeadshots(s.headshots);
        setMatchTargetLevel(s.matchTargetLevel);
        /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }, []);

    // Encode the current build into a shareable link and sync it into the address bar.
    const buildShareUrl = () => {
        const code = encodeBuild(
            { heroId, targetId, loadout, targetLoadout, range, shots, headshots, matchTargetLevel },
            heroes,
            items
        );
        const url = `${window.location.origin}${window.location.pathname}?b=${code}`;
        window.history.replaceState(null, "", url);
        return url;
    };

    const toggleAbility = (id: number) =>
        setDisabledAbilities((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const hero = useMemo(() => heroes.find((h) => h.id === heroId) ?? null, [heroes, heroId]);
    const target = useMemo(() => heroes.find((h) => h.id === targetId) ?? null, [heroes, targetId]);
    const equipped = useMemo(() => loadout.map((id) => items.find((i) => i.id === id)!).filter(Boolean), [loadout, items]);
    const targetEquipped = useMemo(() => targetLoadout.map((id) => items.find((i) => i.id === id)!).filter(Boolean), [targetLoadout, items]);

    const result = useMemo(() => {
        if (!hero || !target) return null;
        return simulate(
            { hero, items: equipped },
            { hero: target, items: targetEquipped, matchAttackerLevel: matchTargetLevel },
            { range, shots, headshots, disabledAbilityIds: [...disabledAbilities] }
        );
    }, [hero, target, equipped, targetEquipped, matchTargetLevel, range, shots, headshots, disabledAbilities]);

    // Transitive components for each item: every cheaper part it's built from, all the way down.
    // Buying an upgrade collapses the chain — you only ever hold the final item (and its cumulative cost).
    const componentIds = useMemo(() => {
        const byName = new Map(items.map((i) => [i.name, i.id]));
        const direct = new Map<number, number[]>();
        for (const it of items) {
            let names: string[] = [];
            try { const a = JSON.parse(it.components ?? "[]"); if (Array.isArray(a)) names = a; } catch { /* ignore */ }
            direct.set(it.id, names.map((n) => byName.get(n)).filter((x): x is number => x != null));
        }
        const trans = new Map<number, Set<number>>();
        const visit = (id: number): Set<number> => {
            const cached = trans.get(id);
            if (cached) return cached;
            const s = new Set<number>();
            trans.set(id, s); // set first to guard against cycles
            for (const c of direct.get(id) ?? []) { s.add(c); for (const x of visit(c)) s.add(x); }
            return s;
        };
        for (const it of items) visit(it.id);
        return trans;
    }, [items]);

    const addWithCollapse = (set: typeof setLoadout) => (id: number) =>
        set((l) => {
            // Already own this item, or own an upgrade that already includes it → no-op.
            if (l.includes(id) || l.some((owned) => componentIds.get(owned)?.has(id))) return l;
            const comps = componentIds.get(id);
            const filtered = comps ? l.filter((x) => !comps.has(x)) : l; // drop the parts it's built from
            return [...filtered, id];
        });

    const addItem = addWithCollapse(setLoadout);
    const removeItem = (id: number) => setLoadout((l) => l.filter((x) => x !== id));
    const addTargetItem = addWithCollapse(setTargetLoadout);
    const removeTargetItem = (id: number) => setTargetLoadout((l) => l.filter((x) => x !== id));

    const activeLoadout = buyingFor === "attacker" ? loadout : targetLoadout;
    const activeAdd = buyingFor === "attacker" ? addItem : addTargetItem;
    const activeRemove = buyingFor === "attacker" ? removeItem : removeTargetItem;

    if (!hero || !target || !result) {
        return <p style={{ color: "var(--text-muted)" }}>No hero data available.</p>;
    }

    const ts = result.targetStats;
    const hs = result.heroStats;
    const b = result.burst;
    const fmt = (n: number) => Math.round(n).toLocaleString();
    const ehpTip = (health: number, resistPct: number, kind: string) => {
        const v = Math.round((health * resistPct) / 100);
        return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString()} effective HP vs ${kind}`;
    };
    // crit_damage_received_scale -> headshot/crit damage reduction %. >0 = takes less (e.g. Seven 55).
    const critReductionPct = (scale: number | null | undefined) => Math.round((1 - (scale ?? 1)) * 100);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* VersusBand */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 20, alignItems: "stretch", padding: 18 }}>
                    {/* Attacker */}
                    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                        <HeroPortrait imageUrl={hero.imageUrl} size={80} level={result.level} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, minWidth: 0, flex: 1, alignItems: "flex-start", textAlign: "left" }}>
                            <SideLabel color="var(--brass-400)">Attacker</SideLabel>
                            <div style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: "0.01em", color: "var(--text)" }}>{hero.name}</div>
                            <div style={{ display: "flex", gap: 14 }}>
                                <MiniStat label="Health" value={fmt(hs.maxHealth)} color="var(--vitality-400)" align="left" />
                                <MiniStat label="Bullet res" value={Math.round(hs.bulletResist) + "%"} color="var(--weapon-400)" align="left" tip={ehpTip(hs.maxHealth, hs.bulletResist, "bullets")} />
                                <MiniStat label="Spirit res" value={Math.round(hs.spiritResist) + "%"} color="var(--spirit-400)" align="left" tip={ehpTip(hs.maxHealth, hs.spiritResist, "spirit")} />
                                {critReductionPct(hero.critDamageReceivedScale) !== 0 && (() => { const v = critReductionPct(hero.critDamageReceivedScale); return (
                                    <MiniStat label="Headshot" value={`${v >= 0 ? "−" : "+"}${Math.abs(v)}%`} color="var(--brass-300)" align="left" tip={`Takes ${Math.abs(v)}% ${v >= 0 ? "less" : "more"} headshot (crit) damage`} />
                                ); })()}
                            </div>
                            <div style={{ marginTop: 4, width: 200, maxWidth: "100%" }}>
                                <HeroSelect heroes={heroes} value={heroId} onChange={setHeroId} accentColor="var(--brass-400)" />
                            </div>
                        </div>
                        <CompactLoadout equipped={equipped} onRemove={removeItem} soulsSpent={result.soulsSpent} fmt={fmt} accent="var(--brass-400)" />
                    </div>

                    {/* VS divider */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 6px" }}>
                        <span style={{ width: 1, flex: 1, background: "linear-gradient(180deg, transparent, var(--border-strong), transparent)" }} />
                        <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 18, letterSpacing: "0.1em", color: "var(--brass-400)" }}>VS</span>
                        <span style={{ width: 1, flex: 1, background: "linear-gradient(180deg, transparent, var(--border-strong), transparent)" }} />
                    </div>

                    {/* Target */}
                    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexDirection: "row-reverse" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, flexShrink: 0 }}>
                            <HeroPortrait imageUrl={target.imageUrl} size={80} level={result.targetLevel} />
                            <MatchLevelButton active={matchTargetLevel} attackerLevel={result.level} onClick={() => setMatchTargetLevel((v) => !v)} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, minWidth: 0, flex: 1, alignItems: "flex-end", textAlign: "right" }}>
                            <SideLabel color="var(--danger-500)">Target</SideLabel>
                            <div style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: "0.01em", color: "var(--text)" }}>{target.name}</div>
                            <div style={{ display: "flex", gap: 14 }}>
                                <MiniStat label="Health" value={fmt(ts.maxHealth)} color="var(--vitality-400)" align="right" />
                                <MiniStat label="Bullet res" value={Math.round(ts.bulletResist) + "%"} color="var(--weapon-400)" align="right" tip={ehpTip(ts.maxHealth, ts.bulletResist, "bullets")} />
                                <MiniStat label="Spirit res" value={Math.round(ts.spiritResist) + "%"} color="var(--spirit-400)" align="right" tip={ehpTip(ts.maxHealth, ts.spiritResist, "spirit")} />
                                {critReductionPct(target.critDamageReceivedScale) !== 0 && (() => { const v = critReductionPct(target.critDamageReceivedScale); return (
                                    <MiniStat label="Headshot" value={`${v >= 0 ? "−" : "+"}${Math.abs(v)}%`} color="var(--brass-300)" align="right" tip={`Takes ${Math.abs(v)}% ${v >= 0 ? "less" : "more"} headshot (crit) damage`} />
                                ); })()}
                            </div>
                            <div style={{ marginTop: 4, width: 200, maxWidth: "100%" }}>
                                <HeroSelect heroes={heroes} value={targetId} onChange={setTargetId} accentColor="var(--danger-500)" align="right" />
                            </div>
                        </div>
                        <CompactLoadout equipped={targetEquipped} onRemove={removeTargetItem} soulsSpent={result.targetSoulsSpent} fmt={fmt} accent="var(--danger-500)" emptyHint />
                    </div>
                </div>

                {/* Level strip */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "11px 18px", background: "var(--surface-well)", borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-dim)" }}>Level</span>
                        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 24, color: "var(--brass-300)" }}>{result.level}</span>
                        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>· from <span style={{ fontFamily: "var(--font-numeric)", color: "var(--cash-500)" }}>{fmt(result.soulsSpent)}</span> souls of items</span>
                    </div>
                    <div style={{ flex: 1, position: "relative", height: 5, borderRadius: "var(--r-pill)", background: "var(--ink-700)", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${result.levelProgressPct}%`, background: "linear-gradient(90deg, var(--brass-600), var(--brass-300))" }} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums" }}>{result.levelProgressPct}% → Lvl {result.level + 1}</span>
                    <ShareBuildButton getUrl={buildShareUrl} />
                </div>
            </div>

            {/* Item shop */}
            <BuyMenu items={items} loadout={activeLoadout} onAdd={activeAdd} onRemove={activeRemove}
                buyingFor={buyingFor} onBuyingForChange={setBuyingFor}
                attackerName={hero.name} targetName={target.name} />

            {/* Abilities + Damage calculator */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "inset 0 1px 0 var(--line-soft)" }}>
                {/* Abilities */}
                <div style={{ padding: 18 }}>
                    <SectionHead title="Abilities" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {result.abilities.length === 0
                            ? <p style={{ fontSize: 13, color: "var(--text-dim)" }}>No abilities recorded for this hero yet.</p>
                            : result.abilities.map((a) => {
                                const off = disabledAbilities.has(a.id);
                                const toggleable = a.damageType !== "utility";
                                const c = (a.damageType === "utility" ? null : a.damageType) as Category | null;
                                return (
                                    <div key={a.id}
                                        onClick={toggleable ? () => toggleAbility(a.id) : undefined}
                                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: "var(--r-sm)", border: "1px solid var(--border)", background: off ? "transparent" : "var(--surface-raised)", cursor: toggleable ? "pointer" : "default", opacity: off ? 0.4 : 1, transition: "opacity 120ms, background 120ms" }}>
                                        {/* toggle dot */}
                                        {toggleable && (
                                            <span style={{ width: 14, height: 14, borderRadius: "var(--r-xs)", border: `1px solid ${off ? "var(--border-strong)" : (c ? CAT_COLOR[c] : "var(--border-strong)")}`, background: off ? "transparent" : (c ? `${CAT_COLOR[c]}22` : "transparent"), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                {!off && <span style={{ width: 6, height: 6, borderRadius: 2, background: c ? CAT_COLOR[c] : "var(--text)" }} />}
                                            </span>
                                        )}
                                        {a.imageUrl
                                            // eslint-disable-next-line @next/next/no-img-element
                                            ? <img src={a.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0 }} />
                                            : <span style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", background: "var(--surface-well)", flexShrink: 0 }} />}
                                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--text)" }}>{a.name}</span>
                                        {a.isUltimate && <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brass-400)" }}>ult</span>}
                                        {a.isDot && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>dot</span>}
                                        <span style={{ fontFamily: "var(--font-numeric)", fontSize: 12, color: "var(--text-dim)", width: 40, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                            {a.cooldown ? `${a.cooldown}s` : "—"}
                                        </span>
                                        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 13, color: c ? CAT_COLOR[c] : "var(--text-dim)", width: 52, textAlign: "right" }}>{a.display}</span>
                                    </div>
                                );
                            })}
                    </div>
                </div>

                {/* Damage calculator */}
                <div style={{ padding: 18, borderLeft: "1px solid var(--border)" }}>
                    <SectionHead title="Damage" />
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", whiteSpace: "nowrap" }}>Range</span>
                        <input type="range" min={0} max={80} step={1} value={range} onChange={(e) => setRange(Number(e.target.value))}
                            style={{ flex: 1, accentColor: "var(--brass-500)" }} />
                        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 14, color: "var(--text)", width: 44, textAlign: "right" }}>{range} m</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                        <StatReadout label="Sustained DPS" value={fmt(result.sustainedDps)} unit="dps" accent />
                        <StatReadout label="Time to kill" value={result.timeToKill != null ? result.timeToKill.toFixed(1) : "—"} unit="s" />
                        <StatReadout label="Dmg per shot" value={fmt(result.damagePerShot)} sub={`${result.heroStats?.weaponFireRate?.toFixed(2) ?? "—"}/s fire rate`} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center", marginBottom: 16 }}>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 4 }}>Total burst damage</div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                                <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 74, lineHeight: 0.92, letterSpacing: "0.01em", color: "var(--brass-300)", textShadow: "0 0 36px var(--brass-glow)" }}>{fmt(b.total)}</span>
                                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>vs {fmt(result.theirEhp)} EHP</span>
                            </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <NumberField label="Shots" value={shots} onChange={setShots} min={0} max={50} />
                            <NumberField label="Headshots" value={headshots} onChange={setHeadshots} min={0} max={shots} />
                        </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                        <BurstChip label="Ability damage" value={fmt(b.abilityDamage)} tone="spirit" />
                        <BurstChip label="Weapon damage" value={fmt(b.weaponDamage)} tone="weapon" count={shots} />
                        {b.headshotExtra > 0 && <BurstChip label="Headshot bonus" value={`+${fmt(b.headshotExtra)}`} tone="brass" count={headshots} />}
                        {b.dotBurst > 0 && <BurstChip label="DoT · 0.5s" value={`+${fmt(b.dotBurst)}`} tone="spirit" />}
                        {b.procs.map((p, i) => (
                            <BurstChip key={i} label={p.name ?? "Proc"} value={`+${fmt(p.dmg)}`} tone="brass" count={p.count} />
                        ))}
                    </div>
                    {b.dotFull > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--spirit-400)" }}>Damage over time</span>
                            <StatReadout label="Applied / sec" value={fmt(b.dotPerSec)} unit="dps" />
                            <StatReadout label="Full if they sit" value={fmt(b.dotFull)} sub="entire duration" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ---- Sub-components ---- */

function ShareBuildButton({ getUrl }: { getUrl: () => string }) {
    const [copied, setCopied] = useState(false);
    const onClick = async () => {
        const url = getUrl();
        try { await navigator.clipboard.writeText(url); } catch { /* address bar still updated */ }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };
    return (
        <button type="button" onClick={onClick} title="Copy a shareable link to this exact build"
            style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 12px", cursor: "pointer", whiteSpace: "nowrap",
                borderRadius: "var(--r-sm)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
                border: `1px solid ${copied ? "var(--cash-500)" : "var(--border-strong)"}`,
                background: copied ? "color-mix(in srgb, var(--cash-500) 16%, transparent)" : "var(--surface-raised)",
                color: copied ? "var(--cash-500)" : "var(--text-muted)", transition: "color 120ms, background 120ms, border-color 120ms",
            }}>
            <span style={{ fontSize: 13 }}>{copied ? "✓" : "⎘"}</span>{copied ? "Link copied" : "Copy build link"}
        </button>
    );
}

function MatchLevelButton({ active, attackerLevel, onClick }: { active: boolean; attackerLevel: number; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick}
            title={active ? `Target pinned to attacker level (${attackerLevel})` : "Level the target to the attacker's level (no items)"}
            style={{
                width: 80, padding: "5px 4px", cursor: "pointer", textAlign: "center", lineHeight: 1.1,
                borderRadius: "var(--r-sm)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 9.5,
                letterSpacing: "0.06em", textTransform: "uppercase",
                border: `1px solid ${active ? "var(--brass-500)" : "var(--border-strong)"}`,
                background: active ? "color-mix(in srgb, var(--brass-500) 18%, transparent)" : "var(--surface-raised)",
                color: active ? "var(--brass-300)" : "var(--text-muted)",
            }}>
            {active ? `Lvl ${attackerLevel} ✓` : "Match level"}
        </button>
    );
}

function SideLabel({ color, children }: { color: string; children: React.ReactNode }) {
    return <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color }}>{children}</span>;
}

function CompactLoadout({ equipped, onRemove, soulsSpent, fmt, accent = "var(--text-dim)", emptyHint = false }: { equipped: ItemWithModifiers[]; onRemove: (id: number) => void; soulsSpent: number; fmt: (n: number) => string; accent?: string; emptyHint?: boolean }) {
    return (
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 7, paddingTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: accent }}>Loadout</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cash-500)", boxShadow: "0 0 6px var(--cash-500)" }} />
                    <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "var(--cash-500)" }}>{fmt(soulsSpent)}</span>
                </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 31px)", gridAutoRows: "31px", gap: 5 }}>
                {Array.from({ length: 12 }).map((_, i) => {
                    const it = equipped[i];
                    if (it) {
                        const c = it.category as Category;
                        return (
                            <button key={i} onClick={() => onRemove(it.id)} title={`${it.name} — remove`}
                                style={{ borderRadius: "var(--r-xs)", background: "var(--surface-raised)", border: `1px solid ${CAT_COLOR[c]}44`, cursor: "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                                {it.imageUrl
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={it.imageUrl} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                                    : <span style={{ fontSize: 6, color: CAT_COLOR[c], textAlign: "center", lineHeight: 1.1 }}>{it.name}</span>}
                                <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: CAT_COLOR[c] }} />
                            </button>
                        );
                    }
                    return <div key={i} style={{ borderRadius: "var(--r-xs)", border: "1px dashed var(--border-strong)", background: "var(--surface-well)" }} />;
                })}
            </div>
            {emptyHint && equipped.length === 0 && (
                <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", textAlign: "right" }}>Base stats · no items</span>
            )}
        </div>
    );
}

function MiniStat({ label, value, color, align = "right", tip }: { label: string; value: string; color: string; align?: "left" | "right"; tip?: string }) {
    const [show, setShow] = useState(false);
    return (
        <div
            onMouseEnter={tip ? () => setShow(true) : undefined}
            onMouseLeave={tip ? () => setShow(false) : undefined}
            style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2, alignItems: align === "right" ? "flex-end" : "flex-start", cursor: tip ? "help" : "default" }}>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 18, color }}>{value}</span>
            <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", borderBottom: tip ? "1px dotted var(--border-strong)" : "none", paddingBottom: tip ? 1 : 0 }}>{label}</span>
            {tip && show && (
                <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: align === "right" ? "auto" : 0, right: align === "right" ? 0 : "auto", zIndex: 50, whiteSpace: "nowrap", pointerEvents: "none",
                    padding: "6px 9px", borderRadius: "var(--r-sm)", background: "linear-gradient(180deg, var(--ink-820), var(--ink-870))",
                    border: `1px solid ${color}`, boxShadow: "var(--elev-pop)", fontSize: 11.5, color: "var(--text)", fontFamily: "var(--font-archivo)" }}>
                    {tip}
                </div>
            )}
        </div>
    );
}

function HeroPortrait({ imageUrl, size, level }: { imageUrl?: string | null; size: number; level?: number }) {
    const src = imageUrl || null;
    return (
        <div style={{ position: "relative", flexShrink: 0 }}>
            {src
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={src} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: "var(--r-md)", border: "1px solid var(--border-strong)" }} />
                : <div style={{ width: size, height: size, borderRadius: "var(--r-md)", background: "var(--surface-raised)", border: "1px solid var(--border-strong)" }} />}
            {level != null && (
                <span style={{ position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)", background: "var(--ink-820)", border: "1px solid var(--border-brass)", borderRadius: "var(--r-pill)", padding: "1px 7px", fontFamily: "var(--font-numeric)", fontSize: 11, color: "var(--brass-400)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {level}
                </span>
            )}
        </div>
    );
}

function HeroSelect({ heroes, value, onChange, accentColor, align = "left" }: { heroes: HeroWithAbilities[]; value: number | null; onChange: (id: number) => void; accentColor: string; align?: "left" | "right" }) {
    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", background: "var(--surface-raised)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", width: "100%" }}>
            <span style={{ color: accentColor, fontSize: 8 }}>◆</span>
            <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "var(--font-archivo)", fontSize: 13, color: "var(--text)", textAlign: align === "right" ? "right" : "left", cursor: "pointer" }}>
                {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
        </div>
    );
}

function SectionHead({ title, right }: { title: string; right?: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text)" }}>{title}</span>
            {right}
        </div>
    );
}

function StatReadout({ label, value, unit, sub, accent }: { label: string; value: string; unit?: string; sub?: string; accent?: boolean }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: accent ? 28 : 22, lineHeight: 1, color: accent ? "var(--brass-300)" : "var(--text)", textShadow: accent ? "0 0 20px var(--brass-glow)" : "none" }}>{value}</span>
                {unit && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{unit}</span>}
            </div>
            {sub && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{sub}</span>}
        </div>
    );
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</span>
            <input type="number" min={min} max={max} value={value}
                onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
                style={{ width: 56, height: 34, borderRadius: "var(--r-sm)", background: "var(--surface-raised)", border: "1px solid var(--border-strong)", outline: "none", textAlign: "center", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 18, color: "var(--text)" }} />
        </div>
    );
}

const CHIP_TONES: Record<string, { fg: string; bg: string; bd: string }> = {
    weapon:   { fg: "var(--weapon-400)",   bg: "var(--weapon-tint)",   bd: "var(--weapon-frame)" },
    vitality: { fg: "var(--vitality-400)", bg: "var(--vitality-tint)", bd: "var(--vitality-frame)" },
    spirit:   { fg: "var(--spirit-400)",   bg: "var(--spirit-tint)",   bd: "var(--spirit-frame)" },
    brass:    { fg: "var(--brass-300)",    bg: "rgba(200,155,92,0.10)", bd: "var(--line-brass)" },
};

function BurstChip({ label, value, tone, count }: { label: string; value: string; tone: string; count?: number }) {
    const t = CHIP_TONES[tone] ?? CHIP_TONES.brass;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "7px 11px", borderRadius: "var(--r-sm)", background: t.bg, border: `1px solid ${t.bd}` }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: t.fg }}>{label}{count != null && count > 0 ? ` ×${count}` : ""}</span>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 17, color: t.fg }}>{value}</span>
        </div>
    );
}
