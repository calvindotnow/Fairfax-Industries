"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { ItemWithModifiers, ItemStatModifier } from "@/db/schema";
import { parseEffects, STAT_DEFINITIONS, type ItemEffect } from "@/lib/sim";
import { useIsNarrow } from "@/lib/use-narrow";

// True on devices with a real hover-capable pointer (mouse/trackpad). On touch
// (`hover: none`) we open an explicit details sheet instead of relying on hover.
// Defaults to true so SSR matches the desktop-first render, then corrects on mount.
function useCanHover() {
    const [canHover, setCanHover] = useState(true);
    useEffect(() => {
        const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
        const update = () => setCanHover(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);
    return canHover;
}

const CAT_COLOR: Record<string, string> = {
    weapon: "var(--weapon-400)",
    vitality: "var(--vitality-400)",
    spirit: "var(--spirit-400)",
};

const TIERS = [1, 2, 3, 4];
const TIER_COST: Record<number, number> = { 1: 800, 2: 1600, 3: 3200, 4: 6400 };
const STAT_LABEL: Record<string, string> = Object.fromEntries(
    STAT_DEFINITIONS.map((d) => [d.key as string, d.label])
);

function statLine(m: ItemStatModifier): string {
    const label = STAT_LABEL[m.statName] ?? m.statName;
    if (m.percentBonus) return `+${m.percentBonus}% ${label}`;
    return `+${m.flatBonus} ${label}`;
}

function effectLine(e: ItemEffect): string {
    if (e.kind === "onHitProc")
        return e.valueType === "percentOfShot"
            ? `On hit: +${e.value}% of shot${e.procCooldown ? ` · ${e.procCooldown}s` : ""}`
            : `On hit: +${e.value} ${e.damageType}${e.procCooldown ? ` · ${e.procCooldown}s` : " · per shot"}`;
    if (e.kind === "onHitFlat") return `Headshot: +${e.value} ${e.damageType}`;
    if (e.kind === "conditionalWeaponPct")
        return e.rangeMin != null ? `+${e.value}% weapon ≥${e.rangeMin}m` : `+${e.value}% weapon ≤${e.rangeMax}m`;
    return "";
}

interface BuyMenuProps {
    items: ItemWithModifiers[];
    loadout: number[];
    onAdd: (id: number) => void;
    onRemove: (id: number) => void;
    buyingFor: "attacker" | "target";
    onBuyingForChange: (s: "attacker" | "target") => void;
    attackerName: string;
    targetName: string;
}

type Cat = "weapon" | "vitality" | "spirit";

export default function BuyMenu({ items, loadout, onAdd, onRemove, buyingFor, onBuyingForChange, attackerName, targetName }: BuyMenuProps) {
    const [cat, setCat] = useState<Cat>("weapon");
    const [search, setSearch] = useState("");
    const [hover, setHover] = useState<{ item: ItemWithModifiers; x: number; y: number } | null>(null);
    // On touch, tapping a tile opens this details sheet (with an explicit Buy/Sell
    // button) instead of buying blind. On hover devices, clicks still buy directly.
    const [selected, setSelected] = useState<ItemWithModifiers | null>(null);
    const canHover = useCanHover();
    const narrow = useIsNarrow();

    // Upgrade relationships: each item's direct components, and what each item builds into.
    const upgrades = useMemo(() => {
        const byName = new Map(items.map((i) => [i.name, i]));
        const components = new Map<number, string[]>();
        const buildsInto = new Map<number, string[]>();
        for (const it of items) {
            let names: string[] = [];
            try { const a = JSON.parse(it.components ?? "[]"); if (Array.isArray(a)) names = a; } catch { /* ignore */ }
            const present = names.filter((n) => byName.has(n));
            components.set(it.id, present);
            for (const n of present) {
                const comp = byName.get(n)!;
                const arr = buildsInto.get(comp.id) ?? [];
                arr.push(it.name);
                buildsInto.set(comp.id, arr);
            }
        }
        return { components, buildsInto };
    }, [items]);

    const pool = items.filter(
        (i) => i.category === cat && i.name.toLowerCase().includes(search.toLowerCase())
    );
    const isEq = (it: ItemWithModifiers) => loadout.includes(it.id);
    const toggle = (it: ItemWithModifiers) => (isEq(it) ? onRemove(it.id) : onAdd(it.id));
    const catCounts = { weapon: 0, vitality: 0, spirit: 0 } as Record<Cat, number>;
    items.forEach((i) => { if (i.category in catCounts) catCounts[i.category as Cat]++; });

    return (
        <section style={{
            position: "relative", background: "var(--tex-parchment)",
            border: "1px solid var(--parch-frame)", borderRadius: "var(--r-lg)", padding: 12,
            boxShadow: "0 2px 0 rgba(255,247,222,0.25) inset, 0 14px 36px -18px rgba(0,0,0,0.7)",
        }}>
            <DecoCorners />

            {/* Header */}
            <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", alignItems: narrow ? "stretch" : "center", justifyContent: "space-between", gap: narrow ? 10 : 16, padding: "4px 8px 14px", borderBottom: "1px solid var(--parch-line)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 24, letterSpacing: "0.06em", color: "var(--parch-ink)" }}>FAIRFAX</span>
                    <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 500, fontSize: 11, letterSpacing: "0.22em", color: "var(--parch-ink-soft)" }}>ARTILLERY BOUGHT &amp; SOLD</span>
                </div>
                <BuyForToggle value={buyingFor} onChange={onBuyingForChange} attackerName={attackerName} targetName={targetName} />
                <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 10px", gap: 7, minWidth: 180, background: "rgba(44,35,22,0.10)", border: "1px solid var(--parch-line)", borderRadius: "var(--r-sm)" }}>
                    <span style={{ color: "var(--parch-ink-soft)", fontSize: 13 }}>⌕</span>
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items" aria-label="Search items"
                        style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "var(--font-archivo)", fontSize: 13, color: "var(--parch-ink)" }} />
                </div>
            </div>

            {/* Category tabs */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "8px 4px 10px" }}>
                {(["weapon", "vitality", "spirit"] as Cat[]).map((c) => {
                    const on = cat === c;
                    return (
                        <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={on} aria-label={`${c} items (${catCounts[c]})`}
                            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 16px", cursor: "pointer",
                                borderRadius: "var(--r-sm)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 14,
                                letterSpacing: "0.05em", textTransform: "uppercase",
                                color: on ? "var(--parch-ink)" : "var(--parch-ink-soft)",
                                background: on ? `var(--${c}-tint)` : "transparent",
                                border: `1px solid ${on ? `var(--${c}-500)` : "transparent"}`,
                                boxShadow: on ? `inset 0 -3px 0 var(--${c}-500)` : "none",
                            }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: `var(--${c}-500)`, boxShadow: on ? `0 0 7px var(--${c}-500)` : "none" }} />
                            {c.charAt(0).toUpperCase() + c.slice(1)}
                            <span style={{ fontFamily: "var(--font-numeric)", fontSize: 12, opacity: 0.7 }}>{catCounts[c]}</span>
                        </button>
                    );
                })}
            </div>

            {/* Tier quadrants */}
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, 1fr)", gap: 8 }}>
                {TIERS.map((t) => {
                    const tierItems = pool.filter((i) => i.tier === t);
                    const dark = t === 4;
                    return (
                        <div key={t} style={{
                            position: "relative", borderRadius: "var(--r-md)", padding: "10px 8px 10px",
                            background: dark ? "linear-gradient(180deg, #1b1813, #131009)" : "rgba(255,247,222,0.28)",
                            border: `1px solid ${dark ? "#0e0c08" : "var(--parch-line)"}`,
                            boxShadow: dark ? "0 1px 10px rgba(0,0,0,0.4) inset" : "0 1px 0 rgba(255,247,222,0.5) inset",
                        }}>
                            {/* Column header */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingBottom: 7, borderBottom: `1px solid ${dark ? "rgba(217,136,65,0.3)" : "var(--parch-line)"}` }}>
                                <CostPill cost={TIER_COST[t]} />
                                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: dark ? "var(--weapon-400)" : "var(--parch-ink)" }}>Tier {t}</span>
                                {dark && <span style={{ fontFamily: "var(--font-oswald)", fontSize: 9, letterSpacing: "0.14em", color: "var(--weapon-500)", marginLeft: "auto" }}>EXPERTS</span>}
                            </div>

                            {/* Tiles */}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center" }}>
                                {tierItems.map((it) => {
                                    const eq = isEq(it);
                                    const color = CAT_COLOR[it.category] ?? "var(--text)";
                                    return (
                                        <button key={it.id}
                                            type="button"
                                            aria-pressed={eq}
                                            title={`${it.name} — ${eq ? "in loadout" : "buy"}`}
                                            onClick={() => (canHover ? toggle(it) : (setHover(null), setSelected(it)))}
                                            onMouseEnter={canHover ? (e) => setHover({ item: it, x: e.clientX, y: e.clientY }) : undefined}
                                            onMouseMove={canHover ? (e) => setHover((h) => (h && h.item.id === it.id ? { ...h, x: e.clientX, y: e.clientY } : { item: it, x: e.clientX, y: e.clientY })) : undefined}
                                            onMouseLeave={canHover ? () => setHover(null) : undefined}
                                            onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover({ item: it, x: r.right - 4, y: r.bottom - 8 }); }}
                                            onBlur={() => setHover(null)}
                                            style={{
                                                width: 64, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "2px 1px 3px",
                                                borderRadius: "var(--r-sm)", cursor: "pointer",
                                                background: eq ? (dark ? "rgba(255,255,255,0.08)" : "rgba(44,35,22,0.18)") : "transparent",
                                                border: eq ? `1px solid ${color}` : "1px solid transparent",
                                                boxShadow: eq ? `0 0 10px -4px ${color}` : "none",
                                                outline: "none",
                                            }}>
                                            <div style={{ position: "relative", width: 60, height: 60, borderRadius: "var(--r-sm)", background: dark ? "rgba(255,255,255,0.06)" : "rgba(44,35,22,0.12)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                                                {it.imageUrl
                                                    ? <Image src={it.imageUrl} alt={it.name} width={60} height={60} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                                                    : <span style={{ fontSize: 8, color: dark ? color : "var(--parch-ink-soft)", textAlign: "center", lineHeight: 1.2, padding: "0 2px" }}>{it.name}</span>}
                                                {/* Non-color "owned" indicator (FR-5) so it doesn't rely on hue alone */}
                                                {eq && <span aria-hidden style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: "50%", background: "var(--cash-500)", color: "#10160f", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 1.5px rgba(0,0,0,0.35)" }}>✓</span>}
                                            </div>
                                            {/* Label stays contrast-safe; "owned" is shown by the badge + border, not by recoloring text (FR-5) */}
                                            <span style={{ fontSize: 10, lineHeight: 1.25, textAlign: "center", fontWeight: eq ? 600 : 400, color: dark ? (eq ? "var(--text)" : "var(--text-muted)") : (eq ? "var(--parch-ink)" : "var(--parch-ink-soft)"), fontFamily: "var(--font-archivo)" }}>{it.name}</span>
                                        </button>
                                    );
                                })}
                                {tierItems.length === 0 && <span style={{ gridColumn: "1/-1", fontSize: 11, color: dark ? "var(--text-dim)" : "var(--parch-ink-soft)", padding: "8px 0", textAlign: "center" }}>—</span>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Hover / focus tooltip (pointer + keyboard) */}
            {hover && <ItemTooltip item={hover.item} x={hover.x} y={hover.y} equipped={isEq(hover.item)}
                components={upgrades.components.get(hover.item.id) ?? []}
                buildsInto={upgrades.buildsInto.get(hover.item.id) ?? []} />}

            {/* Tap details sheet (touch) — explicit Buy/Sell */}
            {selected && <ItemSheet item={selected} equipped={isEq(selected)}
                components={upgrades.components.get(selected.id) ?? []}
                buildsInto={upgrades.buildsInto.get(selected.id) ?? []}
                onBuy={() => { toggle(selected); setSelected(null); }}
                onClose={() => setSelected(null)} />}
        </section>
    );
}

function BuyForToggle({ value, onChange, attackerName, targetName }: { value: "attacker" | "target"; onChange: (s: "attacker" | "target") => void; attackerName: string; targetName: string }) {
    const opts: { key: "attacker" | "target"; role: string; name: string; color: string }[] = [
        { key: "attacker", role: "Attacker", name: attackerName, color: "var(--brass-500)" },
        { key: "target", role: "Target", name: targetName, color: "var(--danger-500)" },
    ];
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--parch-ink-soft)", whiteSpace: "nowrap" }}>Buying for</span>
            <div style={{ display: "inline-flex", padding: 2, gap: 2, background: "rgba(44,35,22,0.10)", border: "1px solid var(--parch-line)", borderRadius: "var(--r-sm)" }}>
                {opts.map((o) => {
                    const on = value === o.key;
                    return (
                        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={on} aria-label={`Buy for ${o.role} (${o.name})`}
                            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 12px", cursor: "pointer",
                                borderRadius: "var(--r-xs)", border: `1px solid ${on ? o.color : "transparent"}`,
                                background: on ? `color-mix(in srgb, ${o.color} 16%, transparent)` : "transparent",
                                boxShadow: on ? `inset 0 -2px 0 ${o.color}` : "none" }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: o.color, boxShadow: on ? `0 0 7px ${o.color}` : "none", flexShrink: 0 }} />
                            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1 }}>
                                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase", color: on ? "var(--parch-ink)" : "var(--parch-ink-soft)" }}>{o.role}</span>
                                <span style={{ fontFamily: "var(--font-archivo)", fontSize: 9.5, color: "var(--parch-ink-soft)", marginTop: 2, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function DecoCorners({ color = "var(--parch-frame)", size = 14, inset = 5 }: { color?: string; size?: number; inset?: number }) {
    const base: React.CSSProperties = { position: "absolute", width: size, height: size, borderColor: color, borderStyle: "solid", pointerEvents: "none" };
    return (
        <>
            <span style={{ ...base, top: inset, left: inset, borderWidth: "2px 0 0 2px" }} />
            <span style={{ ...base, top: inset, right: inset, borderWidth: "2px 2px 0 0" }} />
            <span style={{ ...base, bottom: inset, left: inset, borderWidth: "0 0 2px 2px" }} />
            <span style={{ ...base, bottom: inset, right: inset, borderWidth: "0 2px 2px 0" }} />
        </>
    );
}

function CostPill({ cost }: { cost: number }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 20, padding: "0 8px",
            borderRadius: "var(--r-sm)", background: "var(--cash-pill-bg)", border: "1px solid var(--cash-pill-bd)",
            color: "var(--cash-pill-fg)", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
            fontSize: 13, letterSpacing: "0.02em" }}>
            <span style={{ color: "var(--cash-500)", fontWeight: 600 }}>§</span>{cost.toLocaleString()}
        </span>
    );
}

function UpgradeLine({ label, names, color }: { label: string; names: string[]; color: string }) {
    return (
        <div style={{ display: "flex", gap: 6, fontSize: 11.5, lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", paddingTop: 1 }}>{label}</span>
            <span style={{ color }}>{names.join(", ")}</span>
        </div>
    );
}

// Shared details content — reused by the hover/focus tooltip and the touch sheet.
function ItemDetailsBody({ item, components, buildsInto, footer }: { item: ItemWithModifiers; components: string[]; buildsInto: string[]; footer?: React.ReactNode }) {
    const c = item.category;
    const effects = parseEffects(item.effects);
    return (
        <div style={{ padding: "13px 14px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 17, letterSpacing: "0.01em", color: "var(--text)", lineHeight: 1.1 }}>{item.name}</span>
                <CostPill cost={item.soulCost} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: CAT_COLOR[c] ?? "var(--text-muted)" }}>{c}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>· Tier {item.tier}</span>
                {item.isActive && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "var(--weapon-500)", alignSelf: "center" }}>ACTIVE</span>}
            </div>
            {item.description && (
                <p style={{ marginTop: 9, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)", whiteSpace: "pre-line" }}>{item.description}</p>
            )}
            {item.modifiers.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                    {item.modifiers.map((m) => (
                        <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                            <span style={{ color: "var(--text-muted)" }}>{STAT_LABEL[m.statName] ?? m.statName}</span>
                            <span style={{ fontFamily: "var(--font-numeric)", color: CAT_COLOR[c] ?? "var(--text)" }}>{statLine(m)}</span>
                        </div>
                    ))}
                </div>
            )}
            {effects.map((e, i) => (
                <p key={i} style={{ marginTop: 6, fontSize: 12, color: CAT_COLOR[c] ?? "var(--text)", lineHeight: 1.45 }}>{effectLine(e)}</p>
            ))}
            {(components.length > 0 || buildsInto.length > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                    {components.length > 0 && <UpgradeLine label="Upgrades from" names={components} color={CAT_COLOR[c] ?? "var(--text)"} />}
                    {buildsInto.length > 0 && <UpgradeLine label="Builds into" names={buildsInto} color={CAT_COLOR[c] ?? "var(--text)"} />}
                </div>
            )}
            {footer}
        </div>
    );
}

function ItemTooltip({ item, x, y, equipped, components, buildsInto }: { item: ItemWithModifiers; x: number; y: number; equipped: boolean; components: string[]; buildsInto: string[] }) {
    const c = item.category;
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 16, top: y + 12 });

    // Place at the cursor's bottom-right by default, but flip to the opposite
    // side of the cursor when it would spill past a screen edge — so the tooltip
    // never covers the hovered item near the corners.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const m = 8; // viewport margin
        let left = x + 16;
        if (left + w > vw - m) left = x - 16 - w; // flip to cursor's left
        left = Math.max(m, Math.min(left, vw - w - m));
        let top = y + 12;
        if (top + h > vh - m) top = y - 12 - h; // flip above cursor
        top = Math.max(m, Math.min(top, vh - h - m));
        setPos({ left, top });
    }, [x, y, item]);

    return (
        <div ref={ref} style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            width: 264, zIndex: 200, pointerEvents: "none",
            background: "linear-gradient(180deg, var(--ink-820), var(--ink-870))",
            border: `1px solid var(--${c}-frame)`, borderRadius: "var(--r-md)", boxShadow: "var(--elev-pop)", overflow: "hidden",
        }}>
            <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `var(--${c}-500)` }} />
            <ItemDetailsBody item={item} components={components} buildsInto={buildsInto}
                footer={<div style={{ marginTop: 11, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: equipped ? "var(--danger-500)" : "var(--cash-500)" }}>{equipped ? "Click to sell" : "Click to buy"}</div>} />
        </div>
    );
}

// Touch path: a modal sheet with full item details and an explicit Buy/Sell button.
function ItemSheet({ item, equipped, components, buildsInto, onBuy, onClose }: { item: ItemWithModifiers; equipped: boolean; components: string[]; buildsInto: string[]; onBuy: () => void; onClose: () => void }) {
    const c = item.category;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(10,9,8,0.62)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 8 }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${item.name} details`}
                style={{ position: "relative", width: "100%", maxWidth: 420, background: "linear-gradient(180deg, var(--ink-820), var(--ink-870))", border: `1px solid var(--${c}-frame)`, borderRadius: "var(--r-lg)", boxShadow: "var(--elev-pop)", overflow: "hidden" }}>
                <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `var(--${c}-500)` }} />
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "7px 7px 0" }}>
                    <button type="button" onClick={onClose} aria-label="Close details"
                        style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "var(--surface-raised)", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                </div>
                <ItemDetailsBody item={item} components={components} buildsInto={buildsInto}
                    footer={
                        <button type="button" onClick={onBuy}
                            style={{ marginTop: 13, width: "100%", height: 42, cursor: "pointer", borderRadius: "var(--r-sm)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase",
                                border: `1px solid ${equipped ? "var(--danger-500)" : "var(--cash-500)"}`,
                                background: `color-mix(in srgb, ${equipped ? "var(--danger-500)" : "var(--cash-500)"} 16%, transparent)`,
                                color: equipped ? "var(--danger-500)" : "var(--cash-500)" }}>
                            {equipped ? "Sell item" : `Buy · §${item.soulCost.toLocaleString()}`}
                        </button>
                    } />
            </div>
        </div>
    );
}
