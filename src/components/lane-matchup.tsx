"use client";

import Link from "next/link";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";
import { encodeBuild, type ShareState } from "@/lib/build-code";
import { useIsNarrow } from "@/lib/use-narrow";
import { useBuild } from "@/lib/use-build";
import BuyMenu from "@/components/buy-menu";
import { VersusBand } from "@/components/versus-band";
import { CounterPanel } from "@/components/counter-panel";

interface LaneMatchupProps {
    heroes: HeroWithAbilities[];
    items: ItemWithModifiers[];
    initialHeroId?: number | null;
    initialBuild?: ShareState | null;
}

export default function LaneMatchup({ heroes, items, initialHeroId = null, initialBuild = null }: LaneMatchupProps) {
    const narrow = useIsNarrow();
    const build = useBuild({ heroes, items, initialHeroId, initialBuild });
    const { toast } = build;

    const fmt = (n: number) => Math.round(n).toLocaleString();
    const damageCalcHref = `/hideout?b=${encodeBuild({ heroId: build.heroId, targetId: build.targetId, loadout: build.loadout, targetLoadout: build.targetLoadout, range: build.range, shots: build.shots, headshots: build.headshots, matchTargetLevel: build.matchTargetLevel }, heroes, items)}`;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <VersusBand build={build} narrow={narrow} fmt={fmt} heroes={heroes} showCompare={false} />

            {/* Auto-enemy toggle + transfer link */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                {build.target && (
                    <AutoEnemyToggle
                        on={build.autoEnemy}
                        available={build.autoEnemyAvailable}
                        enemyName={build.target.name}
                        onToggle={() => build.setAutoEnemy((v: boolean) => !v)}
                    />
                )}
                <Link href={damageCalcHref} style={{ fontSize: 12.5, color: "var(--text-muted)", textDecoration: "none", fontWeight: 500, marginLeft: "auto" }}>Open in Damage Calc →</Link>
            </div>

            {build.hero && build.target && (
                <>
                    {build.autoEnemy && build.autoEnemyAvailable && (
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
                            Enemy: average {build.target.name} build at <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", color: "var(--cash-500)" }}>§{fmt(build.yourSouls)}</span> — scrub your build to advance it. Edit to take control.
                        </p>
                    )}
                    <BuyMenu
                        items={items}
                        loadout={build.activeLoadout}
                        onAdd={build.activeAdd}
                        onRemove={build.activeRemove}
                        buyingFor={build.buyingFor}
                        onBuyingForChange={build.setBuyingFor}
                        attackerName={build.hero.name}
                        targetName={build.target.name}
                    />
                    <CounterPanel
                        hero={build.hero}
                        enemy={build.target}
                        yourItems={build.equipped}
                        enemyItems={build.effectiveEnemyEquipped}
                        opts={build.counterOpts}
                        items={items}
                        onAddItem={build.addItem}
                        fmt={fmt}
                    />
                </>
            )}

            {/* Toast notifications — "Merged…" / "Loadout is full" / "Switched to a custom enemy build" */}
            <div aria-live="polite" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 400, pointerEvents: "none", display: "flex", justifyContent: "center", maxWidth: "92vw" }}>
                {toast && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: "var(--r-md)", background: "linear-gradient(180deg, var(--ink-820), var(--ink-870))", border: "1px solid var(--border-brass)", boxShadow: "var(--elev-pop)", fontSize: 12.5, color: "var(--text)" }}>
                        <span style={{ color: "var(--brass-400)", fontSize: 13 }}>⛃</span>{toast}
                    </div>
                )}
            </div>
        </div>
    );
}

// Lane Lab v2 (D1): the per-lane "Auto enemy build" switch. Brass-tinted when on;
// disabled with a tooltip when the enemy hero has no baked build path (no fabrication).
function AutoEnemyToggle({ on, available, enemyName, onToggle }: { on: boolean; available: boolean; enemyName: string; onToggle: () => void }) {
    const active = on && available;
    return (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
            <button
                type="button"
                onClick={available ? onToggle : undefined}
                disabled={!available}
                aria-pressed={available ? on : false}
                title={available ? undefined : `No average build data for ${enemyName}`}
                style={{
                    display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 12px",
                    cursor: available ? "pointer" : "not-allowed", whiteSpace: "nowrap",
                    borderRadius: "var(--r-sm)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 11,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    border: `1px solid ${active ? "var(--brass-500)" : "var(--border-strong)"}`,
                    background: active ? "color-mix(in srgb, var(--brass-500) 16%, transparent)" : "var(--surface-raised)",
                    color: active ? "var(--brass-300)" : "var(--text-muted)",
                    opacity: available ? 1 : 0.55,
                }}>
                <span style={{ fontSize: 13 }}>{active ? "◆" : "◇"}</span>Auto enemy build
            </button>
            <span style={{ fontSize: 10.5, color: "var(--text-dim)", letterSpacing: "0.01em" }}>
                {available ? `fills the average ${enemyName} build as your souls climb` : `no average build data for ${enemyName}`}
            </span>
        </span>
    );
}
