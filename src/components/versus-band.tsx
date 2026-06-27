"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";
import { HeroPicker } from "@/components/hero-picker";
import SlotText from "@/components/slot-text";
import type { Build } from "@/lib/use-build";

type Category = "weapon" | "vitality" | "spirit";
const MAX_LOADOUT = 12;
const CAT_COLOR: Record<Category, string> = {
    weapon: "var(--weapon-400)",
    vitality: "var(--vitality-400)",
    spirit: "var(--spirit-400)",
};

export function VersusBand({ build, narrow, fmt, heroes }: {
    build: Build;
    narrow: boolean;
    fmt: (n: number) => string;
    heroes: HeroWithAbilities[];
}) {
    const {
        heroId, setHeroId, setShotsTouched,
        hero, result,
        equipped, removeItem,
        targetId, setTargetId,
        target, matchTargetLevel, setMatchTargetLevel,
        targetEquipped, removeTargetItem,
        compareOn, compareView, activeBuild,
        onCompareClick, buildShareUrl,
    } = build;

    if (!hero || !target || !result) return null;

    const ts = result.targetStats;
    const hs = result.heroStats;

    const ehpTip = (health: number, resistPct: number, kind: string) => {
        const v = Math.round((health * resistPct) / 100);
        return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString()} effective HP vs ${kind}`;
    };
    const critReductionPct = (scale: number | null | undefined) => Math.round((1 - (scale ?? 1)) * 100);

    return (
        <div data-tour="versus" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr auto 1fr", gap: narrow ? 14 : 20, alignItems: "stretch", padding: narrow ? 14 : 18 }}>
                {/* Attacker */}
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: narrow ? "wrap" : "nowrap" }}>
                    <HeroPicker heroes={heroes} value={heroId} onChange={(id) => { setHeroId(id); setShotsTouched(false); }} accentColor="var(--brass-400)">
                      <button type="button" title="Change hero" aria-label="Change attacker hero" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", borderRadius: 8 }}>
                        <HeroPortrait imageUrl={hero.imageUrl} size={64} level={result.level} />
                      </button>
                    </HeroPicker>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, minWidth: 0, flex: 1, alignItems: "flex-start", textAlign: "left" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <SideLabel color="var(--brass-400)">Attacker</SideLabel>
                            {compareOn && (
                                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brass-300)", background: "color-mix(in srgb, var(--brass-500) 18%, transparent)", border: "1px solid var(--border-brass)", borderRadius: "var(--r-xs)", padding: "1px 6px" }}>Build {activeBuild}</span>
                            )}
                        </span>
                        <div style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: "0.01em", color: "var(--text)" }}>{hero.name}</div>
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                            <MiniStat label="Health" value={fmt(hs.maxHealth)} color="var(--vitality-400)" align="left" />
                            <MiniStat label="Bullet res" value={Math.round(hs.bulletResist) + "%"} color="var(--weapon-400)" align="left" tip={ehpTip(hs.maxHealth, hs.bulletResist, "bullets")} />
                            <MiniStat label="Spirit res" value={Math.round(hs.spiritResist) + "%"} color="var(--spirit-400)" align="left" tip={ehpTip(hs.maxHealth, hs.spiritResist, "spirit")} />
                            {critReductionPct(hero.critDamageReceivedScale) !== 0 && (() => { const v = critReductionPct(hero.critDamageReceivedScale); return (
                                <MiniStat label="Headshot" value={`${v >= 0 ? "−" : "+"}${Math.abs(v)}%`} color="var(--brass-300)" align="left" tip={`Takes ${Math.abs(v)}% ${v >= 0 ? "less" : "more"} headshot (crit) damage`} />
                            ); })()}
                        </div>
                        {/* Movement (FR-2) — secondary stats under the primary line */}
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                            <MiniStat label="Sprint" value={hs.sprintSpeed.toFixed(1)} color="var(--text-muted)" align="left" tip={`Sprinting at ${hs.sprintSpeed.toFixed(1)} m/s · base move speed ${hs.moveSpeed.toFixed(1)} m/s`} />
                            <MiniStat label="Stamina" value={fmt(hs.stamina)} color="var(--text-muted)" align="left" tip="Stamina charges — spent on dashes and air-jumps. (Regen time isn't in the current data feed.)" />
                        </div>
                    </div>
                    <CompactLoadout equipped={equipped} onRemove={removeItem} soulsSpent={result.soulsSpent} fmt={fmt} accent="var(--brass-400)" />
                </div>

                {/* VS divider */}
                <div style={{ display: "flex", flexDirection: narrow ? "row" : "column", alignItems: "center", justifyContent: "center", gap: 8, padding: narrow ? "2px 0" : "0 6px" }}>
                    <span style={{ width: narrow ? "auto" : 1, height: narrow ? 1 : "auto", flex: 1, background: `linear-gradient(${narrow ? "90deg" : "180deg"}, transparent, var(--border-strong), transparent)` }} />
                    <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 18, letterSpacing: "0.1em", color: "var(--brass-400)" }}>VS</span>
                    <span style={{ width: narrow ? "auto" : 1, height: narrow ? 1 : "auto", flex: 1, background: `linear-gradient(${narrow ? "90deg" : "180deg"}, transparent, var(--border-strong), transparent)` }} />
                </div>

                {/* Target */}
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexDirection: narrow ? "row" : "row-reverse", flexWrap: narrow ? "wrap" : "nowrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, flexShrink: 0 }}>
                        <HeroPicker heroes={heroes} value={targetId} onChange={setTargetId} accentColor="var(--danger-500)" align="right">
                          <button type="button" title="Change hero" aria-label="Change target hero" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", borderRadius: 8 }}>
                            <HeroPortrait imageUrl={target.imageUrl} size={64} level={result.targetLevel} />
                          </button>
                        </HeroPicker>
                        <MatchLevelButton active={matchTargetLevel} attackerLevel={result.level} onClick={() => setMatchTargetLevel((v) => !v)} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, minWidth: 0, flex: 1, alignItems: "flex-end", textAlign: "right" }}>
                        <SideLabel color="var(--danger-500)">Target</SideLabel>
                        <div style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: "0.01em", color: "var(--text)" }}>{target.name}</div>
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                            <MiniStat label="Health" value={fmt(ts.maxHealth)} color="var(--vitality-400)" align="right" />
                            <MiniStat label="Bullet res" value={Math.round(ts.bulletResist) + "%"} color="var(--weapon-400)" align="right" tip={ehpTip(ts.maxHealth, ts.bulletResist, "bullets")} />
                            <MiniStat label="Spirit res" value={Math.round(ts.spiritResist) + "%"} color="var(--spirit-400)" align="right" tip={ehpTip(ts.maxHealth, ts.spiritResist, "spirit")} />
                            {critReductionPct(target.critDamageReceivedScale) !== 0 && (() => { const v = critReductionPct(target.critDamageReceivedScale); return (
                                <MiniStat label="Headshot" value={`${v >= 0 ? "−" : "+"}${Math.abs(v)}%`} color="var(--brass-300)" align="right" tip={`Takes ${Math.abs(v)}% ${v >= 0 ? "less" : "more"} headshot (crit) damage`} />
                            ); })()}
                        </div>
                    </div>
                    <CompactLoadout equipped={targetEquipped} onRemove={removeTargetItem} soulsSpent={result.targetSoulsSpent} fmt={fmt} accent="var(--danger-500)" emptyHint />
                </div>
            </div>

            {/* Level strip */}
            <div style={{ display: "flex", alignItems: "center", gap: narrow ? 10 : 16, padding: narrow ? "11px 14px" : "11px 18px", background: "var(--surface-well)", borderTop: "1px solid var(--border)", flexWrap: narrow ? "wrap" : "nowrap" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>Level</span>
                        <InfoDot tip="Your level is set by the souls your build costs — the level you'd actually be at that net worth. There's no slider; it moves as you buy items." />
                    </span>
                    <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 24, color: "var(--brass-300)" }}>{result.level}</span>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>· from <span style={{ fontFamily: "var(--font-numeric)", color: "var(--cash-500)" }}>{fmt(result.soulsSpent)}</span> souls of items</span>
                </div>
                <div style={{ flex: 1, position: "relative", height: 5, borderRadius: "var(--r-pill)", background: "var(--ink-700)", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${result.levelProgressPct}%`, background: "linear-gradient(90deg, var(--brass-600), var(--brass-300))" }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums" }}>{result.levelProgressPct}% → Lvl {result.level + 1}</span>
                <span data-tour="compare" style={{ display: "inline-flex" }}><CompareToggle compareOn={compareOn} view={compareView} onClick={onCompareClick} /></span>
                <span data-tour="share" style={{ display: "inline-flex" }}><ShareBuildButton getUrl={buildShareUrl} /></span>
            </div>
        </div>
    );
}

/* ---- Helper components (moved from hideout.tsx) ---- */

function CompareToggle({ compareOn, view, onClick }: { compareOn: boolean; view: "expanded" | "min"; onClick: () => void }) {
    const label = !compareOn ? "Compare" : view === "expanded" ? "A vs B ▾" : "A vs B ▴";
    return (
        <button type="button" onClick={onClick} aria-pressed={compareOn}
            title={!compareOn ? "Lock this build as A and start an empty build B to compare" : view === "expanded" ? "Minimize the comparison (both builds are kept)" : "Expand the comparison"}
            style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 12px", cursor: "pointer", whiteSpace: "nowrap",
                borderRadius: "var(--r-sm)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
                border: `1px solid ${compareOn ? "var(--brass-500)" : "var(--border-strong)"}`,
                background: compareOn ? "color-mix(in srgb, var(--brass-500) 16%, transparent)" : "var(--surface-raised)",
                color: compareOn ? "var(--brass-300)" : "var(--text-muted)",
            }}>
            <span style={{ fontSize: 13 }}>⊞</span>{label}
        </button>
    );
}

// Small "i" affordance that reveals a glossary popover on hover, focus, or tap.
export function InfoDot({ tip, align = "left" }: { tip: string; align?: "left" | "right" }) {
    const [show, setShow] = useState(false);
    return (
        <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
            <button type="button" aria-label={tip}
                onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
                onFocus={() => setShow(true)} onBlur={() => setShow(false)}
                onClick={(e) => { e.preventDefault(); setShow((v) => !v); }}
                style={{ width: 13, height: 13, padding: 0, borderRadius: "50%", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-muted)", fontSize: 9, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1, cursor: "help", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>i</button>
            {show && (
                <span role="tooltip" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: align === "right" ? "auto" : 0, right: align === "right" ? 0 : "auto", zIndex: 80, width: 210,
                    padding: "8px 10px", borderRadius: "var(--r-sm)", background: "linear-gradient(180deg, var(--ink-820), var(--ink-870))", border: "1px solid var(--border-brass)", boxShadow: "var(--elev-pop)",
                    fontSize: 11.5, fontWeight: 400, lineHeight: 1.45, letterSpacing: "normal", textTransform: "none", color: "var(--text)", fontFamily: "var(--font-archivo)", pointerEvents: "none", whiteSpace: "normal" }}>{tip}</span>
            )}
        </span>
    );
}

// First-run intro card — dismissible, remembered in localStorage (see Hideout).
function ShareBuildButton({ getUrl }: { getUrl: () => string }) {
    // "idle" → ready · "copied" → clipboard write succeeded · "fallback" → clipboard
    // unavailable (insecure context / denied), so we surface a selectable field instead.
    const [status, setStatus] = useState<"idle" | "copied" | "fallback">("idle");
    const [url, setUrl] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const onClick = async () => {
        const u = getUrl(); // also syncs the link into the address bar
        setUrl(u);
        try {
            await navigator.clipboard.writeText(u);
            setStatus("copied");
            setTimeout(() => setStatus("idle"), 1600);
        } catch {
            setStatus("fallback");
            requestAnimationFrame(() => inputRef.current?.select());
        }
    };

    const copied = status === "copied";
    const label = copied ? "Link copied" : status === "fallback" ? "Select to copy" : "Copy build link";

    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={onClick} title="Copy a shareable link to this exact build"
                style={{
                    display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 12px", cursor: "pointer", whiteSpace: "nowrap",
                    borderRadius: "var(--r-sm)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
                    border: `1px solid ${copied ? "var(--cash-500)" : "var(--border-strong)"}`,
                    background: copied ? "color-mix(in srgb, var(--cash-500) 16%, transparent)" : "var(--surface-raised)",
                    color: copied ? "var(--cash-500)" : "var(--text-muted)", transition: "color 120ms, background 120ms, border-color 120ms",
                }}>
                <span style={{ fontSize: 13 }}>{copied ? "✓" : "⎘"}</span>
                <SlotText text={label} />
            </button>
            {status === "fallback" && (
                <input ref={inputRef} readOnly value={url} onFocus={(e) => e.currentTarget.select()}
                    aria-label="Shareable build link — select and copy"
                    style={{
                        width: 200, maxWidth: "40vw", height: 28, padding: "0 8px", borderRadius: "var(--r-sm)",
                        background: "var(--surface-well)", border: "1px solid var(--border-strong)", outline: "none",
                        fontFamily: "var(--font-numeric)", fontSize: 11, color: "var(--text-muted)",
                    }} />
            )}
            <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
                {copied ? "Build link copied to clipboard." : status === "fallback" ? "Link is in the address bar — select the field to copy it." : ""}
            </span>
        </div>
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
                {Array.from({ length: MAX_LOADOUT }).map((_, i) => {
                    const it = equipped[i];
                    if (it) {
                        const c = it.category as Category;
                        return (
                            <button key={i} type="button" onClick={() => onRemove(it.id)} title={`${it.name} — remove`} aria-label={`Remove ${it.name} from loadout`}
                                style={{ borderRadius: "var(--r-xs)", background: "var(--surface-raised)", border: `1px solid ${CAT_COLOR[c]}44`, cursor: "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                                {it.imageUrl
                                    ? <Image src={it.imageUrl} alt={it.name} width={31} height={31} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
    // Hover-intent delay (FR-3): wait before opening so a passing cursor doesn't flash the tip.
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const open = () => { timer.current = setTimeout(() => setShow(true), 350); };
    const close = () => { if (timer.current) clearTimeout(timer.current); setShow(false); };
    return (
        <div
            onMouseEnter={tip ? open : undefined}
            onMouseLeave={tip ? close : undefined}
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
                ? <Image src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "cover", borderRadius: "var(--r-md)", border: "1px solid var(--border-strong)" }} />
                : <div style={{ width: size, height: size, borderRadius: "var(--r-md)", background: "var(--surface-raised)", border: "1px solid var(--border-strong)" }} />}
            {level != null && (
                <span style={{ position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)", background: "var(--ink-820)", border: "1px solid var(--border-brass)", borderRadius: "var(--r-pill)", padding: "1px 7px", fontFamily: "var(--font-numeric)", fontSize: 11, color: "var(--brass-400)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {level}
                </span>
            )}
        </div>
    );
}
