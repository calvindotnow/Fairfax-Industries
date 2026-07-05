"use client";

import Image from "next/image";
import type { ItemWithModifiers } from "@/db/schema";
import { levelFromSouls, type SimResult } from "@/lib/sim";
import type { BuildPath } from "@/lib/build-path";

// FR-1: the ordered purchase timeline with level checkpoints + a scrub preview.
// Lane Lab v2 (C4): an optional `buildPath` (this hero's average path) overlays
// "your plan vs what people actually buy" on the same souls axis. Omitted / empty ⇒
// the panel renders exactly as before (graceful no-op).
export function ProgressionPanel({ steps, checkpoint, onCheckpoint, onMove, previewResult, fmt, open, onToggle, buildLabel, buildPath = [] }: {
    steps: ItemWithModifiers[];
    checkpoint: number | null;
    onCheckpoint: (n: number | null) => void;
    onMove: (i: number, dir: -1 | 1) => void;
    previewResult: SimResult | null;
    fmt: (n: number) => string;
    open: boolean;
    onToggle: () => void;
    buildLabel: "A" | "B" | null;
    buildPath?: BuildPath;
}) {
    const CAT: Record<string, string> = { weapon: "var(--weapon-400)", vitality: "var(--vitality-400)", spirit: "var(--spirit-400)" };
    const hasAvg = buildPath.length > 0;
    // Average items owned by a given souls count (steps priced at or below it).
    const avgOwnedBy = (souls: number) => buildPath.filter((s) => s.souls <= souls).length;
    const rows = steps.map((it, i) => {
        const cumulative = steps.slice(0, i + 1).reduce((s, x) => s + (x.soulCost ?? 0), 0);
        return { it, i, cumulative, level: levelFromSouls(cumulative), avgOwned: hasAvg ? avgOwnedBy(cumulative) : null };
    });
    return (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
            <button type="button" onClick={onToggle} aria-expanded={open}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", background: "transparent", border: "none", borderBottom: open ? "1px solid var(--border)" : "none", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 10, color: "var(--brass-400)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▶</span>
                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>Build progression</span>
                {buildLabel && <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brass-300)", background: "color-mix(in srgb, var(--brass-500) 18%, transparent)", border: "1px solid var(--border-brass)", borderRadius: "var(--r-xs)", padding: "1px 6px" }}>Build {buildLabel}</span>}
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>{steps.length} purchase{steps.length === 1 ? "" : "s"}</span>
            </button>
            {open && (
                <div style={{ padding: "12px 18px 16px" }}>
                    <p style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
                        {hasAvg
                            ? "Your build vs the average path — click a step to preview the build at that point; reorder with the arrows. The dim ⌀ count is how many items the average build owns by that soul count."
                            : "Your suggested buy order — click a step to preview the build at that point; reorder with the arrows. Level is derived from the souls spent by each step."}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {rows.map(({ it, i, cumulative, level, avgOwned }) => {
                            const isCp = checkpoint === i;
                            const owned = checkpoint != null && i <= checkpoint;
                            const dimmed = checkpoint != null && i > checkpoint;
                            const c = CAT[it.category] ?? "var(--text)";
                            return (
                                <div key={i} role="button" tabIndex={0} aria-pressed={isCp}
                                    aria-label={`${it.name} — step ${i + 1}${isCp ? ", currently previewing" : ""}`}
                                    title="Preview the build at this step"
                                    onClick={() => onCheckpoint(isCp ? null : i)}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCheckpoint(isCp ? null : i); } }}
                                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: "var(--r-sm)", cursor: "pointer", opacity: dimmed ? 0.45 : 1,
                                        border: `1px solid ${isCp ? "var(--border-brass)" : "var(--border)"}`,
                                        background: isCp ? "color-mix(in srgb, var(--brass-500) 10%, transparent)" : owned ? "var(--surface-raised)" : "transparent" }}>
                                    <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--text-dim)", width: 16, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
                                    <span style={{ width: 26, height: 26, borderRadius: "var(--r-xs)", background: "var(--surface-well)", border: `1px solid ${c}44`, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        {it.imageUrl ? <Image src={it.imageUrl} alt="" width={26} height={26} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null}
                                    </span>
                                    <span style={{ flex: 1, fontSize: 13, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                                    <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--cash-500)", whiteSpace: "nowrap" }}>+§{fmt(it.soulCost)}</span>
                                    <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", width: 104, textAlign: "right" }}>§{fmt(cumulative)} · Lvl {level}</span>
                                    {avgOwned != null && (
                                        <span title={`The average build owns ${avgOwned} item${avgOwned === 1 ? "" : "s"} by §${fmt(cumulative)}`}
                                            style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--text-dim)", opacity: 0.7, whiteSpace: "nowrap", width: 52, textAlign: "right", flexShrink: 0 }}>
                                            ⌀ {avgOwned}
                                        </span>
                                    )}
                                    <span style={{ display: "flex", gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                        <ReorderBtn label="↑" disabled={i === 0} onClick={() => onMove(i, -1)} />
                                        <ReorderBtn label="↓" disabled={i === rows.length - 1} onClick={() => onMove(i, 1)} />
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {checkpoint != null && previewResult && (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, marginTop: 12, padding: "10px 14px", borderRadius: "var(--r-sm)", background: "var(--surface-well)", border: "1px solid var(--border-brass)" }}>
                            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brass-300)" }}>At step {checkpoint + 1}</span>
                            <PreviewStat label="Level" value={String(previewResult.level)} />
                            <PreviewStat label="Souls" value={fmt(previewResult.soulsSpent)} />
                            <PreviewStat label="Burst" value={fmt(previewResult.burst.total)} />
                            <PreviewStat label="Sustained DPS" value={fmt(previewResult.sustainedDps)} />
                            <button type="button" onClick={() => onCheckpoint(null)}
                                style={{ marginLeft: "auto", height: 26, padding: "0 10px", cursor: "pointer", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "var(--surface-raised)", color: "var(--text-muted)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>Full build →</button>
                        </div>
                    )}
                    {hasAvg && (
                        <p style={{ margin: "12px 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--text-dim)" }}>
                            ⌀ Average path from Deadlock match data (Phantom+) — an empirical average, not a prescription.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

export function ReorderBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
    return (
        <button type="button" disabled={disabled} onClick={onClick} aria-label={label === "↑" ? "Move earlier" : "Move later"}
            style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-xs)", border: "1px solid var(--border-strong)", background: "var(--surface-raised)", color: "var(--text-muted)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1, fontSize: 11 }}>
            {label}
        </button>
    );
}

export function PreviewStat({ label, value }: { label: string; value: string }) {
    return (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</span>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 16, color: "var(--text)" }}>{value}</span>
        </span>
    );
}
