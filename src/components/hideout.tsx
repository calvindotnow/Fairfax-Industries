"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";
import { simulate, levelFromSouls, type SimResult } from "@/lib/sim";
import { encodeBuild, type ShareState } from "@/lib/build-code";
import { useIsNarrow } from "@/lib/use-narrow";
import BuyMenu from "@/components/buy-menu";
import OnboardingTour, { type TourStep } from "@/components/onboarding-tour";

interface HideoutProps {
    heroes: HeroWithAbilities[];
    items: ItemWithModifiers[];
    initialHeroId?: number | null;
    initialBuild?: ShareState | null;
}

type Category = "weapon" | "vitality" | "spirit";

const MAX_LOADOUT = 12; // Deadlock caps a build at 12 active items.

const CAT_COLOR: Record<Category, string> = {
    weapon: "var(--weapon-400)",
    vitality: "var(--vitality-400)",
    spirit: "var(--spirit-400)",
};

// First-run walkthrough — each step spotlights a real section by its data-tour id.
const emph = (s: string) => <strong style={{ color: "var(--text)", fontWeight: 600 }}>{s}</strong>;
const TOUR_STEPS: TourStep[] = [
    {
        target: "versus",
        title: "Pick a matchup",
        body: <>Choose an {emph("attacker")} and a {emph("target")} — every number on the page recalculates live. Match the target&apos;s level to yours with the level button, too.</>,
    },
    {
        target: "shop",
        title: "Buy items",
        body: <>Add items from the shop; {emph("hover or tap")} any item for its stats. Your {emph("level")} rises with the souls your build costs — there&apos;s no separate slider.</>,
    },
    {
        target: "abilities",
        title: "Abilities & scaling",
        body: <>Each ability lists {emph("CD / DMG / DUR / CHG")}. Toggle one to include or exclude it from burst. A {emph("↗")} marks abilities that scale with Spirit Power — those numbers grow as your Spirit does.</>,
    },
    {
        target: "damage",
        title: "Read the damage",
        body: <>See {emph("burst")}, sustained DPS, and time-to-kill for the matchup. The {emph("ⓘ")} dots and &ldquo;How this is calculated&rdquo; break down every number.</>,
    },
    {
        target: "progression",
        title: "Build progression",
        body: <>Your items become a {emph("buy order")} with the level you&apos;d be at each step. Click a step to preview the build at that point, or drag the arrows to reorder.</>,
    },
    {
        target: "compare",
        title: "Compare two builds",
        body: <>Hit {emph("Compare")} to lock build A and edit a second build B side by side. Green/red reads from the build you&apos;re editing — green when it&apos;s ahead, red when it&apos;s behind.</>,
    },
    {
        target: "share",
        title: "Share your build",
        body: <>{emph("Share")} copies a link that restores this exact loadout, hero, and scenario. Open the {emph("Build progression")} panel below for a buy order with level checkpoints.</>,
    },
];


export default function Hideout({ heroes, items, initialHeroId = null, initialBuild = null }: HideoutProps) {
    const narrow = useIsNarrow();
    const searchParams = useSearchParams();
    // A shared build code (?b=) wins over a single ?hero= portrait link; both are
    // resolved server-side and arrive as props, so the first paint is already correct.
    const startHeroId = initialBuild?.heroId ?? initialHeroId ?? heroes[0]?.id ?? null;
    const [heroId, setHeroId] = useState<number | null>(startHeroId);
    const [targetId, setTargetId] = useState<number | null>(initialBuild?.targetId ?? heroes[1]?.id ?? heroes[0]?.id ?? null);
    const [loadoutA, setLoadoutA] = useState<number[]>((initialBuild?.loadout ?? []).slice(0, MAX_LOADOUT));
    const [targetLoadout, setTargetLoadout] = useState<number[]>((initialBuild?.targetLoadout ?? []).slice(0, MAX_LOADOUT));
    // A/B compare (additive, same hero + target): build A is the primary loadout;
    // "Compare" locks it and opens an empty build B you edit alongside it. The panel
    // expands/minimizes without ever discarding either build.
    const [loadoutB, setLoadoutB] = useState<number[]>([]);
    const [compareOn, setCompareOn] = useState(false);
    const [compareView, setCompareView] = useState<"expanded" | "min">("expanded");
    const [activeBuild, setActiveBuild] = useState<"A" | "B">("A");
    const [buyingFor, setBuyingFor] = useState<"attacker" | "target">("attacker");
    const [matchTargetLevel, setMatchTargetLevel] = useState(initialBuild?.matchTargetLevel ?? false);
    const [range, setRange] = useState(initialBuild?.range ?? 25);
    const [shots, setShots] = useState(initialBuild?.shots ?? 8);
    const [headshots, setHeadshots] = useState(initialBuild?.headshots ?? 0);

    // The attacker loadout the whole tool reads/writes: build A normally, build B
    // while comparing and editing B. Switching activeBuild swaps what's on screen.
    const loadout = activeBuild === "B" ? loadoutB : loadoutA;
    const setAttackerLoadout = activeBuild === "B" ? setLoadoutB : setLoadoutA;

    // Ultimates are off by default — most heroes don't ult in a burst. Toggleable per hero.
    const ultIdsOf = (id: number | null) =>
        (heroes.find((h) => h.id === id)?.abilities ?? []).filter((a) => a.type === "ultimate").map((a) => a.id);
    const [disabledAbilities, setDisabledAbilities] = useState<Set<number>>(() => new Set(ultIdsOf(startHeroId)));
    const [showCalc, setShowCalc] = useState(false);
    // Build progression (FR-1): scrub the ordered purchase timeline. `checkpoint`
    // is an index into the active loadout being previewed (null = full build).
    const [checkpoint, setCheckpoint] = useState<number | null>(null);
    const [showProgression, setShowProgression] = useState(true);
    const [showOnboard, setShowOnboard] = useState(false);
    // True while the tour is showing a demo build we injected (so the shop,
    // ability damage, and progression panel all have something to spotlight).
    // We restore the user's empty build when the tour closes.
    const seededForTour = useRef(false);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = (msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 2600);
    };

    // A 3-item starter (cheapest of each category) used only to make the tour live.
    const demoLoadout = () =>
        (["weapon", "vitality", "spirit"] as const)
            .map((cat) => items.filter((it) => it.category === cat).sort((x, y) => x.soulCost - y.soulCost)[0]?.id)
            .filter((id): id is number => id != null);

    const startTour = () => {
        // Seed a demo build only when starting from a truly empty A loadout, so a
        // replay over a real build never clobbers it.
        if (!seededForTour.current && loadoutA.length === 0 && !compareOn) {
            const demo = demoLoadout();
            if (demo.length) {
                setActiveBuild("A");
                setLoadoutA(demo);
                seededForTour.current = true;
            }
        }
        setShowProgression(true);
        setShowOnboard(true);
    };

    // Tour triggers. Keyed on the URL query so the footer "Replay" link works even
    // when we're already on /hideout (client nav doesn't remount the component):
    //   • ?tour=1  → force-start, then strip the param.  (works on every click)
    //   • otherwise → auto-start once on first visit (localStorage), guarded so a
    //     later query change can't re-trigger it.
    const tourInitDone = useRef(false);
    useEffect(() => {
        try {
            if (searchParams.get("tour") === "1") {
                const sp = new URLSearchParams(searchParams.toString());
                sp.delete("tour");
                const qs = sp.toString();
                window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
                startTour();
                tourInitDone.current = true;
                return;
            }
            if (!tourInitDone.current && !localStorage.getItem("fairfax_onboarded")) {
                startTour();
                tourInitDone.current = true;
            }
        } catch { /* SSR/denied */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);
    const dismissOnboard = () => {
        setShowOnboard(false);
        if (seededForTour.current) {
            setLoadoutA([]); // restore the empty build we borrowed for the demo
            seededForTour.current = false;
        }
        try { localStorage.setItem("fairfax_onboarded", "1"); } catch { /* denied */ }
    };

    // Reset to "ultimate off" defaults whenever the attacker hero changes.
    useEffect(() => {
        setDisabledAbilities(new Set(ultIdsOf(heroId)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [heroId]);

    // (URL state — ?b= build codes and ?hero= portrait links — is decoded
    // server-side in page.tsx and seeded via props, so there's no mount-time
    // restore effect and no flash of the default build.)

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
    const equippedA = useMemo(() => loadoutA.map((id) => items.find((i) => i.id === id)!).filter(Boolean), [loadoutA, items]);
    const equippedB = useMemo(() => loadoutB.map((id) => items.find((i) => i.id === id)!).filter(Boolean), [loadoutB, items]);
    const targetEquipped = useMemo(() => targetLoadout.map((id) => items.find((i) => i.id === id)!).filter(Boolean), [targetLoadout, items]);

    // Both builds run against the same hero, target, and scenario.
    const sharedSim = { hero, target, targetEquipped, matchTargetLevel, range, shots, headshots, disabledAbilities };
    const simAttacker = (atkItems: ItemWithModifiers[]) =>
        !hero || !target
            ? null
            : simulate(
                  { hero, items: atkItems },
                  { hero: target, items: targetEquipped, matchAttackerLevel: matchTargetLevel },
                  { range, shots, headshots, disabledAbilityIds: [...disabledAbilities] }
              );
    /* eslint-disable react-hooks/exhaustive-deps */
    const resultA = useMemo(() => simAttacker(equippedA), [equippedA, sharedSim]);
    const resultB = useMemo(() => (compareOn ? simAttacker(equippedB) : null), [compareOn, equippedB, sharedSim]);
    /* eslint-enable react-hooks/exhaustive-deps */

    // The VS band + damage panel reflect whichever build you're actively editing.
    const equipped = activeBuild === "B" ? equippedB : equippedA;
    const result = activeBuild === "B" ? resultB : resultA;

    // Build progression (FR-1): preview the active build at a purchase checkpoint —
    // the partial loadout you'd own by step N — without touching the live calculator.
    const cp = checkpoint != null && checkpoint < loadout.length ? checkpoint : null;
    const previewEquipped = useMemo(
        () => (cp == null ? null : loadout.slice(0, cp + 1).map((id) => items.find((i) => i.id === id)!).filter(Boolean)),
        [cp, loadout, items]
    );
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    const previewResult = useMemo(() => (previewEquipped ? simAttacker(previewEquipped) : null), [previewEquipped, sharedSim]);

    // Click 1: lock A, open an empty build B, start editing it. Later clicks just
    // expand/minimize the panel — neither build is ever discarded (only Exit clears B).
    const startCompare = () => {
        setCompareOn(true);
        setLoadoutB([]);
        setActiveBuild("B");
        setBuyingFor("attacker");
        setCompareView("expanded");
        showToast("Build A locked in — now assemble Build B");
    };
    const onCompareClick = () => (compareOn ? setCompareView((v) => (v === "expanded" ? "min" : "expanded")) : startCompare());
    const exitCompare = () => { setCompareOn(false); setActiveBuild("A"); setLoadoutB([]); };

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

    const addWithCollapse = (set: typeof setLoadoutA, current: number[]) => (id: number) => {
        // Already own this item, or own an upgrade that already includes it → no-op.
        if (current.includes(id) || current.some((owned) => componentIds.get(owned)?.has(id))) return;
        const comps = componentIds.get(id);
        const dropped = comps ? current.filter((x) => comps.has(x)) : []; // parts it's built from
        const afterCollapse = current.filter((x) => !comps?.has(x));
        if (afterCollapse.length >= MAX_LOADOUT) {
            showToast(`Loadout is full — ${MAX_LOADOUT} items max. Sell one to add another.`);
            return;
        }
        set([...afterCollapse, id]);
        if (dropped.length > 0) {
            const nameOf = (iid: number) => items.find((i) => i.id === iid)?.name ?? "item";
            showToast(`Merged ${dropped.map(nameOf).join(" + ")} into ${nameOf(id)}`);
        }
    };

    const addItem = addWithCollapse(setAttackerLoadout, loadout);
    const removeItem = (id: number) => setAttackerLoadout((l) => l.filter((x) => x !== id));
    // Reorder the active build's purchase timeline (FR-1).
    const moveStep = (i: number, dir: -1 | 1) => {
        setAttackerLoadout((l) => {
            const j = i + dir;
            if (j < 0 || j >= l.length) return l;
            const n = [...l];
            [n[i], n[j]] = [n[j], n[i]];
            return n;
        });
        setCheckpoint(null);
    };
    const addTargetItem = addWithCollapse(setTargetLoadout, targetLoadout);
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
            {showOnboard && <OnboardingTour steps={TOUR_STEPS} onDismiss={dismissOnboard} />}
            {/* VersusBand */}
            <div data-tour="versus" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr auto 1fr", gap: narrow ? 14 : 20, alignItems: "stretch", padding: narrow ? 14 : 18 }}>
                    {/* Attacker */}
                    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: narrow ? "wrap" : "nowrap" }}>
                        <HeroPortrait imageUrl={hero.imageUrl} size={64} level={result.level} />
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
                            <div style={{ marginTop: 4, width: 200, maxWidth: "100%" }}>
                                <HeroSelect heroes={heroes} value={heroId} onChange={setHeroId} accentColor="var(--brass-400)" />
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
                            <HeroPortrait imageUrl={target.imageUrl} size={64} level={result.targetLevel} />
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
                            <div style={{ marginTop: 4, width: 200, maxWidth: "100%" }}>
                                <HeroSelect heroes={heroes} value={targetId} onChange={setTargetId} accentColor="var(--danger-500)" align="right" />
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

            {/* A/B compare — expanded panel or minimized bar (never discards a build) */}
            {compareOn && resultA && resultB && (
                <ComparePanel
                    view={compareView}
                    resultA={resultA}
                    resultB={resultB}
                    active={activeBuild}
                    onActive={setActiveBuild}
                    onToggleView={onCompareClick}
                    onExit={exitCompare}
                    fmt={fmt}
                    narrow={narrow}
                />
            )}

            {/* Item shop */}
            <div data-tour="shop">
                <BuyMenu items={items} loadout={activeLoadout} onAdd={activeAdd} onRemove={activeRemove}
                    buyingFor={buyingFor} onBuyingForChange={setBuyingFor}
                    attackerName={hero.name} targetName={target.name} />
            </div>

            {/* Abilities + Damage calculator */}
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1.4fr", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "inset 0 1px 0 var(--line-soft)" }}>
                {/* Abilities */}
                <div data-tour="abilities" style={{ padding: 18 }}>
                    <SectionHead title="Abilities" />
                    {result.abilities.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 4px", marginBottom: 2 }}>
                            <span style={{ flex: 1 }} />
                            <AbilityColLabel w={40} title="Cooldown">CD</AbilityColLabel>
                            <AbilityColLabel w={52} title="Damage (or damage/sec for DoT)">DMG</AbilityColLabel>
                            {!narrow && <AbilityColLabel w={44} title="Active duration">DUR</AbilityColLabel>}
                            {!narrow && <AbilityColLabel w={36} title="Charges">CHG</AbilityColLabel>}
                        </div>
                    )}
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
                                        role={toggleable ? "button" : undefined}
                                        tabIndex={toggleable ? 0 : undefined}
                                        aria-pressed={toggleable ? !off : undefined}
                                        aria-label={toggleable ? `${a.name} — ${off ? "include in burst" : "exclude from burst"}` : undefined}
                                        onKeyDown={toggleable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAbility(a.id); } } : undefined}
                                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: "var(--r-sm)", border: "1px solid var(--border)", background: off ? "transparent" : "var(--surface-raised)", cursor: toggleable ? "pointer" : "default", opacity: off ? 0.4 : 1, transition: "opacity 120ms, background 120ms" }}>
                                        {/* toggle dot */}
                                        {toggleable && (
                                            <span style={{ width: 14, height: 14, borderRadius: "var(--r-xs)", border: `1px solid ${off ? "var(--border-strong)" : (c ? CAT_COLOR[c] : "var(--border-strong)")}`, background: off ? "transparent" : (c ? `${CAT_COLOR[c]}22` : "transparent"), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                {!off && <span style={{ width: 6, height: 6, borderRadius: 2, background: c ? CAT_COLOR[c] : "var(--text)" }} />}
                                            </span>
                                        )}
                                        {a.imageUrl
                                            ? <Image src={a.imageUrl} alt="" width={32} height={32} style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0 }} />
                                            : <span style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", background: "var(--surface-well)", flexShrink: 0 }} />}
                                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--text)" }}>{a.name}</span>
                                        {a.isUltimate && <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brass-400)" }}>ult</span>}
                                        <span style={{ fontFamily: "var(--font-numeric)", fontSize: 12, color: "var(--text-dim)", width: 40, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                            {a.cooldown ? `${a.cooldown}s` : "—"}
                                        </span>
                                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 2, fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 13, color: c ? CAT_COLOR[c] : "var(--text-dim)", width: 52, textAlign: "right" }}
                                            title={a.scalesWithSpirit ? `Scales with Spirit Power${a.damageScalePerSpirit > 0 ? ` (+${a.damageScalePerSpirit} damage per Spirit)` : ""} — this number reflects your current Spirit.` : undefined}>
                                            {a.display}
                                            {a.scalesWithSpirit && a.display !== "—" && <span style={{ fontSize: 9, color: "var(--spirit-400)", lineHeight: 1 }}>↗</span>}
                                        </span>
                                        {!narrow && <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--text-dim)", width: 44, textAlign: "right" }}>{a.duration ? `${a.duration}s` : "—"}</span>}
                                        {!narrow && <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--text-dim)", width: 36, textAlign: "right" }} title={a.charges && a.chargeCooldown ? `${a.charges} charges · ${a.chargeCooldown}s between charges` : undefined}>{a.charges && a.charges > 1 ? `×${a.charges}` : "—"}</span>}
                                    </div>
                                );
                            })}
                    </div>
                </div>

                {/* Damage calculator */}
                <div data-tour="damage" style={{ padding: 18, borderLeft: narrow ? "none" : "1px solid var(--border)", borderTop: narrow ? "1px solid var(--border)" : "none" }}>
                    <SectionHead title="Damage" />
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", whiteSpace: "nowrap" }}>Range</span>
                        <input type="range" min={0} max={80} step={1} value={range} onChange={(e) => setRange(Number(e.target.value))}
                            style={{ flex: 1, accentColor: "var(--brass-500)" }} />
                        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 14, color: "var(--text)", width: 44, textAlign: "right" }}>{range} m</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                        <StatReadout label="Sustained DPS" value={fmt(result.sustainedDps)} unit="dps" accent tip={`Damage per second firing continuously at this range (fire rate × damage per shot, after the target's resists)${result.procDps > 0 ? `, including ${fmt(result.procDps)} from on-hit procs` : ""}.`} />
                        <StatReadout label="Time to kill" value={result.timeToKill != null ? result.timeToKill.toFixed(1) : "—"} unit="s" tip="Seconds to drop the target's effective HP at this range, firing continuously. “—” means sustained DPS can't finish them." />
                        <StatReadout label="Dmg per shot" value={fmt(result.damagePerShot)} sub={`${result.heroStats?.weaponFireRate?.toFixed(2) ?? "—"}/s fire rate`} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: narrow ? 14 : 24, alignItems: "center", marginBottom: 16 }}>
                        <div>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-dim)" }}>Total burst damage</span>
                                <InfoDot tip="Everything that lands in one combo window: weapon shots + headshots, ability damage (ults off by default), a 0.5s slice of any DoT, and on-hit procs." />
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                                <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: narrow ? 50 : 74, lineHeight: 0.92, letterSpacing: "0.01em", color: "var(--brass-300)", textShadow: "0 0 36px var(--brass-glow)" }}>{fmt(b.total)}</span>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-muted)" }}>vs {fmt(result.theirEhp)} EHP <InfoDot tip="Effective HP — the target's health scaled by their bullet/spirit resists. Higher resist means more effective HP to chew through." /></span>
                            </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <NumberField label="Shots" value={shots} onChange={(v) => { setShots(v); setHeadshots((h) => Math.min(h, v)); }} min={0} max={50} />
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
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", textAlign: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--spirit-400)" }}>Damage over time</span>
                            <div style={{ display: "flex", gap: 36, justifyContent: "center" }}>
                                <StatReadout label="Damage per second" value={fmt(b.dotPerSec)} unit="dps" center />
                                <StatReadout label="Total damage for the duration" value={fmt(b.dotFull)} center />
                            </div>
                        </div>
                    )}
                    {(result.melee.light > 0 || result.melee.heavy > 0) && (
                        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--weapon-400)" }}>Melee</span>
                                <InfoDot tip="Base light/heavy melee damage after the target's bullet resist. Shown separately — not added to the burst total." />
                            </span>
                            <StatReadout label="Light" value={fmt(result.melee.light)} />
                            <StatReadout label="Heavy" value={fmt(result.melee.heavy)} />
                        </div>
                    )}

                    {/* How this is calculated — scope + accuracy disclosure (3.1) */}
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                        <button type="button" onClick={() => setShowCalc((v) => !v)} aria-expanded={showCalc}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, color: "var(--text-muted)", letterSpacing: "0.02em", fontFamily: "var(--font-archivo)" }}>
                            <span style={{ fontSize: 9, display: "inline-block", transform: showCalc ? "rotate(90deg)" : "none", transition: "transform 120ms", color: "var(--brass-400)" }}>▶</span>
                            How this is calculated
                        </button>
                        {showCalc && (
                            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.55, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 8 }}>
                                <p style={{ margin: 0 }}><span style={{ color: "var(--cash-500)", fontWeight: 600 }}>Included:</span> weapon shots + headshots, ability damage (ultimates off unless you toggle them on), a 0.5s slice of any damage-over-time, and on-hit procs — all reduced by the target&apos;s bullet/spirit resists and headshot reduction.</p>
                                <p style={{ margin: 0 }}><span style={{ color: "var(--danger-500)", fontWeight: 600 }}>Not included yet:</span> item stacking buffs and active-item combos. (Procs now count toward both burst and sustained DPS; melee is shown separately below.)</p>
                                <Link href="/methodology" style={{ color: "var(--brass-300)", textDecoration: "none", fontWeight: 500 }}>Full methodology →</Link>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Build progression — suggested buy order (FR-1) */}
            {loadout.length > 0 && (
                <div data-tour="progression">
                <ProgressionPanel
                    steps={loadout.map((id) => items.find((i) => i.id === id)).filter(Boolean) as ItemWithModifiers[]}
                    checkpoint={cp}
                    onCheckpoint={setCheckpoint}
                    onMove={moveStep}
                    previewResult={previewResult}
                    fmt={fmt}
                    open={showProgression}
                    onToggle={() => setShowProgression((v) => !v)}
                    buildLabel={compareOn ? activeBuild : null}
                />
                </div>
            )}

            {/* Merge toast (2.3) + onboarding/glossary use a shared aria-live region */}
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

/* ---- Sub-components ---- */

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

const COMPARE_METRICS: { label: string; get: (r: SimResult) => number | null; betterLow?: boolean; unit?: string; dec?: number; group: "offense" | "defense" }[] = [
    { label: "Burst", get: (r) => r.burst.total, group: "offense" },
    { label: "Sustained DPS", get: (r) => r.sustainedDps, group: "offense" },
    { label: "Time to kill", get: (r) => r.timeToKill, betterLow: true, unit: "s", dec: 1, group: "offense" },
    { label: "Souls", get: (r) => r.soulsSpent, betterLow: true, group: "offense" },
    { label: "Level", get: (r) => r.level, group: "offense" },
    { label: "Health", get: (r) => r.heroStats.maxHealth ?? 0, group: "defense" },
    { label: "Bullet res", get: (r) => r.heroStats.bulletResist ?? 0, unit: "%", group: "defense" },
    { label: "Spirit res", get: (r) => r.heroStats.spiritResist ?? 0, unit: "%", group: "defense" },
];

// A | B segmented switch — picks which build the whole tool is editing.
function BuildTabs({ active, onActive }: { active: "A" | "B"; onActive: (b: "A" | "B") => void }) {
    return (
        <div style={{ display: "inline-flex", padding: 2, gap: 2, background: "var(--surface-well)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)" }}>
            {(["A", "B"] as const).map((b) => {
                const on = active === b;
                return (
                    <button key={b} type="button" onClick={() => onActive(b)} aria-pressed={on} title={`Edit build ${b}`}
                        style={{ height: 24, minWidth: 32, padding: "0 9px", cursor: "pointer", borderRadius: "var(--r-xs)",
                            border: `1px solid ${on ? "var(--brass-500)" : "transparent"}`,
                            background: on ? "color-mix(in srgb, var(--brass-500) 18%, transparent)" : "transparent",
                            color: on ? "var(--brass-300)" : "var(--text-muted)", fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em" }}>
                        {b}
                    </button>
                );
            })}
        </div>
    );
}

function CompareRow({ m, a, b, active, fmt, narrow }: { m: (typeof COMPARE_METRICS)[number]; a: SimResult; b: SimResult; active: "A" | "B"; fmt: (n: number) => string; narrow: boolean }) {
    const av = m.get(a);
    const bv = m.get(b);
    const fmtV = (v: number | null) => (v == null ? "—" : (m.dec ? v.toFixed(m.dec) : fmt(v)) + (m.unit ?? ""));
    const delta = av == null || bv == null ? null : bv - av;
    // `improved` = build B is the better one (drives bar geometry — bar points at the winner).
    const improved = delta == null || delta === 0 ? null : m.betterLow ? delta < 0 : delta > 0;
    // Colour reads from the build you're editing: green when the active build is ahead, red when behind.
    const activeAhead = improved == null ? null : (improved ? "B" : "A") === active;
    const dColor = activeAhead == null ? "var(--text-dim)" : activeAhead ? "var(--cash-500)" : "var(--danger-500)";
    const pct = av != null && bv != null && av !== 0 ? (bv - av) / Math.abs(av) : 0;
    const half = Math.min(Math.abs(pct), 1) * 50; // each side of the centre line = 50% of the track
    const sign = delta == null || delta === 0 ? "" : delta > 0 ? "+" : "−";
    const deltaText = delta == null ? "—" : `${sign}${(m.dec ? Math.abs(delta).toFixed(m.dec) : fmt(Math.abs(delta)))}${m.unit ?? ""}`;
    return (
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 56px 56px 64px" : "104px 60px 1fr 60px 70px", gap: 10, alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--line-soft)" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{m.label}</span>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: "var(--text-dim)", textAlign: "right" }}>{fmtV(av)}</span>
            {!narrow && (
                <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--ink-700)" }}>
                    <span style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--border-strong)" }} />
                    {delta != null && delta !== 0 && (
                        <span style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 3, background: dColor, left: improved ? "50%" : `${50 - half}%`, width: `${half}%` }} />
                    )}
                </div>
            )}
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 13.5, color: "var(--text)", textAlign: "right" }}>{fmtV(bv)}</span>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: dColor, textAlign: "right" }}>{deltaText}</span>
        </div>
    );
}

// FR-1: the ordered purchase timeline with level checkpoints + a scrub preview.
function ProgressionPanel({ steps, checkpoint, onCheckpoint, onMove, previewResult, fmt, open, onToggle, buildLabel }: {
    steps: ItemWithModifiers[];
    checkpoint: number | null;
    onCheckpoint: (n: number | null) => void;
    onMove: (i: number, dir: -1 | 1) => void;
    previewResult: SimResult | null;
    fmt: (n: number) => string;
    open: boolean;
    onToggle: () => void;
    buildLabel: "A" | "B" | null;
}) {
    const CAT: Record<string, string> = { weapon: "var(--weapon-400)", vitality: "var(--vitality-400)", spirit: "var(--spirit-400)" };
    let cum = 0;
    const rows = steps.map((it, i) => { cum += it.soulCost ?? 0; return { it, i, cumulative: cum, level: levelFromSouls(cum) }; });
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
                    <p style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>Your suggested buy order — click a step to preview the build at that point; reorder with the arrows. Level is derived from the souls spent by each step.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {rows.map(({ it, i, cumulative, level }) => {
                            const isCp = checkpoint === i;
                            const owned = checkpoint != null && i <= checkpoint;
                            const dimmed = checkpoint != null && i > checkpoint;
                            const c = CAT[it.category] ?? "var(--text)";
                            return (
                                <div key={i} role="button" aria-pressed={isCp} title="Preview the build at this step"
                                    onClick={() => onCheckpoint(isCp ? null : i)}
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
                </div>
            )}
        </div>
    );
}

function ReorderBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
    return (
        <button type="button" disabled={disabled} onClick={onClick} aria-label={label === "↑" ? "Move earlier" : "Move later"}
            style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-xs)", border: "1px solid var(--border-strong)", background: "var(--surface-raised)", color: "var(--text-muted)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1, fontSize: 11 }}>
            {label}
        </button>
    );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
    return (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</span>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 16, color: "var(--text)" }}>{value}</span>
        </span>
    );
}

function ComparePanel({ view, resultA, resultB, active, onActive, onToggleView, onExit, fmt, narrow }: { view: "expanded" | "min"; resultA: SimResult; resultB: SimResult; active: "A" | "B"; onActive: (b: "A" | "B") => void; onToggleView: () => void; onExit: () => void; fmt: (n: number) => string; narrow: boolean }) {
    // Burst delta from the active build's perspective: positive when the build
    // you're editing has more burst — drives both the sign and the colour.
    const activeBurstDelta = (resultB.burst.total - resultA.burst.total) * (active === "B" ? 1 : -1);
    const dColor = activeBurstDelta === 0 ? "var(--text-dim)" : activeBurstDelta > 0 ? "var(--cash-500)" : "var(--danger-500)";

    if (view === "min") {
        return (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "var(--surface)", border: "1px solid var(--border-brass)", borderRadius: "var(--r-lg)", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brass-300)" }}>A vs B</span>
                <BuildTabs active={active} onActive={onActive} />
                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Editing {active}</span>
                <span style={{ flex: 1, minWidth: 8 }} />
                <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: dColor }}>
                    burst {activeBurstDelta >= 0 ? "+" : "−"}{fmt(Math.abs(activeBurstDelta))}
                </span>
                <MiniButton onClick={onToggleView} label="▴ Expand" title="Expand the comparison" />
                <MiniButton onClick={onExit} label="✕" title="Exit compare (discards build B)" />
            </div>
        );
    }

    const offense = COMPARE_METRICS.filter((m) => m.group === "offense");
    const defense = COMPARE_METRICS.filter((m) => m.group === "defense");
    const headCols = narrow ? "1fr 56px 56px 64px" : "104px 60px 1fr 60px 70px";
    return (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border-brass)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: narrow ? "10px 14px" : "12px 18px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brass-300)" }}>Compare</span>
                <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)" }}>Editing</span>
                <BuildTabs active={active} onActive={onActive} />
                <span style={{ flex: 1, minWidth: 8 }} />
                <MiniButton onClick={onToggleView} label="▾ Minimize" title="Minimize (keeps both builds)" />
                <MiniButton onClick={onExit} label="✕ Exit" title="Exit compare (discards build B)" />
            </div>
            <div style={{ padding: narrow ? "4px 14px 12px" : "6px 18px 14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: headCols, gap: 10, padding: "6px 0", alignItems: "center" }}>
                    <span />
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-dim)", textAlign: "right" }}>A</span>
                    {!narrow && <span />}
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--brass-300)", textAlign: "right" }}>B</span>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", textAlign: "right" }}>Δ</span>
                </div>
                {offense.map((m) => <CompareRow key={m.label} m={m} a={resultA} b={resultB} active={active} fmt={fmt} narrow={narrow} />)}
                <div style={{ marginTop: 10, marginBottom: 2, fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)" }}>Defense · extra stats</div>
                {defense.map((m) => <CompareRow key={m.label} m={m} a={resultA} b={resultB} active={active} fmt={fmt} narrow={narrow} />)}
                <p style={{ marginTop: 12, fontSize: 11, color: "var(--text-dim)" }}>Editing build <strong style={{ color: "var(--text-muted)" }}>{active}</strong> — switch tabs to edit the other. <strong style={{ color: "var(--cash-500)" }}>Green</strong> = the build you&apos;re editing ({active}) is ahead; <strong style={{ color: "var(--danger-500)" }}>red</strong> = it&apos;s behind. Both builds share the same hero, target, and scenario.</p>
            </div>
        </div>
    );
}

function MiniButton({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
    return (
        <button type="button" onClick={onClick} title={title}
            style={{ height: 26, padding: "0 10px", cursor: "pointer", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "var(--surface-raised)", color: "var(--text-muted)", fontFamily: "var(--font-oswald)", fontWeight: 600, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {label}
        </button>
    );
}

// Small "i" affordance that reveals a glossary popover on hover, focus, or tap.
function InfoDot({ tip, align = "left" }: { tip: string; align?: "left" | "right" }) {
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
                <span style={{ fontSize: 13 }}>{copied ? "✓" : "⎘"}</span>{label}
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

function AbilityColLabel({ w, title, children }: { w: number; title: string; children: React.ReactNode }) {
    return (
        <span title={title} style={{ width: w, textAlign: "right", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)" }}>{children}</span>
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

function StatReadout({ label, value, unit, sub, accent, tip, center }: { label: string; value: string; unit?: string; sub?: string; accent?: boolean; tip?: string; center?: boolean }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: center ? "center" : undefined }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</span>
                {tip && <InfoDot tip={tip} />}
            </span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, justifyContent: center ? "center" : undefined }}>
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
