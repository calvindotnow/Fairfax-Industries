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

            {/* Transfer link — open current build in the Damage Calculator surface */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Link href={damageCalcHref} style={{ fontSize: 12.5, color: "var(--text-muted)", textDecoration: "none", fontWeight: 500 }}>Open in Damage Calc →</Link>
            </div>

            {build.hero && build.target && (
                <>
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
                        enemyItems={build.targetEquipped}
                        opts={build.counterOpts}
                        items={items}
                        onAddItem={build.addItem}
                        fmt={fmt}
                    />
                </>
            )}

            {/* Toast notifications — "Merged…" / "Loadout is full" */}
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
