import { useEffect, useMemo, useRef, useState } from "react";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";
import { simulate, parseEffects, abilityExecute, sumPercentModifiers } from "@/lib/sim";
import { encodeBuild, type ShareState } from "@/lib/build-code";
import { defaultShotsForFireRate, effectiveEnemyLoadout, takeControlSeed } from "@/lib/hideout-utils";
import { buildPathAtSouls, getBuildPath } from "@/lib/lane-lab";

export const MAX_LOADOUT = 12; // Deadlock caps a build at 12 active items.

export type Build = ReturnType<typeof useBuild>;

export function useBuild({
    heroes,
    items,
    initialHeroId = null,
    initialBuild = null,
}: {
    heroes: HeroWithAbilities[];
    items: ItemWithModifiers[];
    initialHeroId?: number | null;
    initialBuild?: ShareState | null;
}) {
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
    const [matchTargetLevel, setMatchTargetLevel] = useState(initialBuild?.matchTargetLevel ?? true);
    const [range, setRange] = useState(initialBuild?.range ?? 25);
    const [shots, setShots] = useState(initialBuild?.shots ?? 8);
    const [headshots, setHeadshots] = useState(initialBuild?.headshots ?? 0);
    // A shared ?b= build carries an explicit shots count → treat as user-set so links render as shared.
    const [shotsTouched, setShotsTouched] = useState(initialBuild?.shots != null);
    const [accuracy, setAccuracy] = useState(100); // % of shots that land — scales sustained DPS
    const [headshotPct, setHeadshotPct] = useState(0); // % of landed shots that hit the head (sustained)
    // Combat-scenario toggles — feed conditional item effects (Burst Fire, resist debuffs, actives).
    const [hittingEnemy, setHittingEnemy] = useState(true);
    const [resistDebuffs, setResistDebuffs] = useState(true);
    const [activesFiring, setActivesFiring] = useState(false);
    // Assumed stacks for stacking items (Berserker/Glass Cannon). Defaults high so a
    // freshly-equipped stacking item shows fully stacked; capped per item in the engine
    // and by the slider's max below.
    // Per-item stacks (item id → count). Unset = fully stacked (the item's own max).
    const [stacksByItem, setStacksByItem] = useState<Record<number, number>>({});
    // Imbue assignments: imbue item id → the ability id it's attached to (one per ability).
    const [imbueAssign, setImbueAssign] = useState<Record<number, number>>({});
    // Per-ability trained rank (ability id → 0–3). Unset = base. Drives the tier upgrades.
    const [abilityRanks, setAbilityRanks] = useState<Record<number, number>>({});
    // Damage-dealing actives the player chose NOT to press this combo (item ids). Empty = all
    // included — only relevant while "Actives firing" is on; refines which actives' direct
    // damage lands in the burst.
    const [excludedActives, setExcludedActives] = useState<Set<number>>(new Set());

    // The attacker loadout the whole tool reads/writes: build A normally, build B
    // while comparing and editing B. Switching activeBuild swaps what's on screen.
    const loadout = activeBuild === "B" ? loadoutB : loadoutA;
    const setAttackerLoadout = activeBuild === "B" ? setLoadoutB : setLoadoutA;

    // Ultimates are off by default — most heroes don't ult in a burst. Toggleable per hero.
    const ultIdsOf = (id: number | null) =>
        (heroes.find((h) => h.id === id)?.abilities ?? []).filter((a) => a.type === "ultimate").map((a) => a.id);
    const [disabledAbilities, setDisabledAbilities] = useState<Set<number>>(() => new Set(ultIdsOf(startHeroId)));
    // Build progression (FR-1): scrub the ordered purchase timeline. `checkpoint`
    // is an index into the active loadout being previewed (null = full build).
    const [checkpoint, setCheckpoint] = useState<number | null>(null);
    // Lane Lab v2 (D1): the enemy laner auto-fills its average build path, advancing
    // as your souls climb. When on, the sim/counter read a *derived* enemy loadout —
    // `targetLoadout` (the hand-built enemy) is never mutated by the auto-fill. A manual
    // enemy edit flips this off (one-way), keeping today's exact-mode behavior underneath.
    // Default on for a fresh lane; auto-off is a byte-identical no-op vs pre-v2.
    const [autoEnemy, setAutoEnemy] = useState(true);

    // Toast notification system — used by build action handlers (startCompare, addWithCollapse).
    // `toast` is returned so the component can render the notification UI.
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = (msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 2600);
    };

    // Reset to "ultimate off" defaults whenever the attacker hero changes.
    useEffect(() => {
        setDisabledAbilities(new Set(ultIdsOf(heroId)));
        setImbueAssign({}); // ability ids change with the hero — drop stale imbue links
        setAbilityRanks({}); // ranks are per-ability — reset to base on a hero swap
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [heroId]);

    // A fresh enemy laner starts in auto mode (D1). Swapping the enemy hero re-arms
    // auto-fill for the new hero — the previous hand-built enemy stays in targetLoadout
    // underneath, but the intent on a new matchup is "show me the average enemy".
    useEffect(() => {
        setAutoEnemy(true);
    }, [targetId]);

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

    // ── Lane Lab v2 (D1): the auto-progressing average enemy ──────────────────────
    // Auto-fill is available only when the enemy hero has a baked build path.
    const autoEnemyAvailable = useMemo(() => target != null && getBuildPath(target.id).length > 0, [target]);
    // Mirror YOUR souls at the active progression checkpoint: the souls your build
    // costs by the previewed step (checkpoint slice) or, with no checkpoint, the full
    // build. Computed straight from the equipped items' soul cost so it's independent
    // of the sim (no feedback loop through the enemy the sim reads) and matches the
    // engine's own `soulsSpent = Σ soulCost` exactly.
    const soulsOf = (list: ItemWithModifiers[]) => list.reduce((s, it) => s + (it.soulCost ?? 0), 0);
    const yourSouls = useMemo(() => {
        const active = activeBuild === "B" ? loadoutB : loadoutA;
        const slice = checkpoint != null && checkpoint < active.length ? active.slice(0, checkpoint + 1) : active;
        return soulsOf(slice.map((id) => items.find((i) => i.id === id)!).filter(Boolean));
    }, [activeBuild, loadoutA, loadoutB, checkpoint, items]);
    // Derived enemy loadout: never written into `targetLoadout` — purely computed.
    const autoEnemyLoadout = useMemo(
        () => (autoEnemy && target ? buildPathAtSouls(target.id, yourSouls, MAX_LOADOUT) : []),
        [autoEnemy, target, yourSouls]
    );
    const autoEnemyEquipped = useMemo(
        () => autoEnemyLoadout.map((id) => items.find((i) => i.id === id)!).filter(Boolean),
        [autoEnemyLoadout, items]
    );
    // The enemy the whole /lane surface (sim + counter panel + VS band) actually reads.
    // Auto off ⇒ exactly `targetEquipped` ⇒ byte-identical no-op vs pre-v2.
    const effectiveEnemyEquipped = effectiveEnemyLoadout(autoEnemy, autoEnemyAvailable, autoEnemyEquipped, targetEquipped);

    // Both builds run against the same hero, target (effective enemy), and scenario.
    const sharedSim = { hero, target, effectiveEnemyEquipped, matchTargetLevel, range, shots, headshots, accuracy, headshotPct, disabledAbilities, hittingEnemy, resistDebuffs, activesFiring, stacksByItem, abilityRanks, excludedActives, imbueAssign };
    const simAttacker = (atkItems: ItemWithModifiers[]) =>
        !hero || !target
            ? null
            : simulate(
                  { hero, items: atkItems },
                  { hero: target, items: effectiveEnemyEquipped, matchAttackerLevel: matchTargetLevel },
                  { range, shots, headshots, disabledAbilityIds: [...disabledAbilities], hittingEnemy, resistDebuffs, activesFiring, stacksByItem, accuracy, headshotPct, abilityRanks, excludedActiveItemIds: [...excludedActives], imbueAssign }
              );
    /* eslint-disable react-hooks/exhaustive-deps */
    const resultA = useMemo(() => simAttacker(equippedA), [equippedA, sharedSim]);
    const resultB = useMemo(() => (compareOn ? simAttacker(equippedB) : null), [compareOn, equippedB, sharedSim]);
    /* eslint-enable react-hooks/exhaustive-deps */

    // The VS band + damage panel reflect whichever build you're actively editing.
    const equipped = activeBuild === "B" ? equippedB : equippedA;
    const result = activeBuild === "B" ? resultB : resultA;
    // Default the burst window to ~1.5s of fire for the *current* build (items included),
    // until the user edits Shots. Buying a fire-rate item bumps the default up.
    const equippedFireRate = result?.heroStats.weaponFireRate ?? 0;
    useEffect(() => {
      if (shotsTouched || equippedFireRate <= 0) return;
      const def = defaultShotsForFireRate(equippedFireRate);
      setShots(def);
      setHeadshots((h) => Math.min(h, def));
    }, [equippedFireRate, shotsTouched]);
    // Equipped stacking items + each one's own max (drives the per-item Stacks chips).
    // `modeled` = at least one stacking effect maps to a stat the engine applies.
    const stackingItems = useMemo(
        () => equipped
            .map((it) => {
                const effs = parseEffects(it.effects).filter((x) => x.kind === "stacking");
                if (!effs.length) return null;
                const max = Math.max(...effs.map((e) => e.maxStacks ?? 0));
                return max > 0 ? { item: it, max, modeled: effs.some((e) => !!e.stat) } : null;
            })
            .filter((x): x is { item: ItemWithModifiers; max: number; modeled: boolean } => x != null),
        [equipped]
    );
    // Equipped active items that deal on-cast direct damage (Arctic Blast, Cold Front, …) —
    // each gets a chip to include/exclude from the burst. Always-on charge-up damage
    // (Tankbuster) isn't a pressed active, so it's left out (it always counts).
    const damageActives = useMemo(
        () => equipped.filter((it) => parseEffects(it.effects).some((e) => e.kind === "activeDamage" && !e.alwaysOn)),
        [equipped]
    );
    // Equipped imbue items + a reverse map (ability id → the imbue attached to it).
    const imbueItems = useMemo(
        () => equipped.filter((it) => parseEffects(it.effects).some((e) => e.kind === "imbue")),
        [equipped]
    );
    const imbuedBy = useMemo(() => {
        const m = new Map<number, ItemWithModifiers>();
        for (const it of imbueItems) {
            const abilityId = imbueAssign[it.id];
            if (abilityId != null) m.set(abilityId, it);
        }
        return m;
    }, [imbueItems, imbueAssign]);

    // Stable sim-options object for CounterPanel — memoized so its liftRows useMemo
    // doesn't recompute on every unrelated re-render (the inline literal was a new ref each time).
    const counterOpts = useMemo(() => ({
        range, shots, headshots,
        disabledAbilityIds: [...disabledAbilities],
        hittingEnemy, resistDebuffs, activesFiring,
        stacksByItem, accuracy, headshotPct, abilityRanks,
        excludedActiveItemIds: [...excludedActives],
        imbueAssign,
    }), [range, shots, headshots, hittingEnemy, resistDebuffs, activesFiring, accuracy, headshotPct,
        disabledAbilities, stacksByItem, abilityRanks, excludedActives, imbueAssign]);

    // Attacker's execute / assassinate abilities (HP-% thresholds) for the enemy-health marker.
    const executes = useMemo(
        () => (hero?.abilities ?? [])
            .map((a) => { const ex = abilityExecute(a); return ex ? { name: a.name, pct: ex.pct, kind: ex.kind } : null; })
            .filter((x): x is { name: string; pct: number; kind: "kill" | "bonus" } => x != null),
        [hero]
    );
    // Attacker's melee resist (Vitality tab) — only items carry it, no base stat.
    const equippedMeleeResist = useMemo(() => sumPercentModifiers(equipped, "meleeResist"), [equipped]);

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
    // Manual enemy edit while auto is on → one-way "you took control": seed the
    // hand-built loadout from what's on screen (the derived enemy) so the edit is
    // applied on top of it, flip auto off, and toast. `targetLoadout` is only ever
    // written here (a manual edit), never by the auto-fill — no silent clobber.
    const takeEnemyControl = () => {
        if (!(autoEnemy && autoEnemyAvailable)) return false;
        setTargetLoadout(autoEnemyLoadout.slice(0, MAX_LOADOUT)); // keep what was showing
        setAutoEnemy(false);
        showToast("Switched to a custom enemy build");
        return true;
    };
    const rawAddTarget = addWithCollapse(setTargetLoadout, targetLoadout);
    const addTargetItem = (id: number) => {
        // On the take-control transition, targetLoadout hasn't been committed yet this
        // render, so apply the add against the derived base directly (avoids a lost edit).
        if (takeEnemyControl()) {
            setTargetLoadout(takeControlSeed(autoEnemyLoadout, { type: "add", id }, MAX_LOADOUT));
            return;
        }
        rawAddTarget(id);
    };
    const removeTargetItem = (id: number) => {
        if (takeEnemyControl()) {
            setTargetLoadout(takeControlSeed(autoEnemyLoadout, { type: "remove", id }, MAX_LOADOUT));
            return;
        }
        setTargetLoadout((l) => l.filter((x) => x !== id));
    };

    const activeLoadout = buyingFor === "attacker" ? loadout : targetLoadout;
    const activeAdd = buyingFor === "attacker" ? addItem : addTargetItem;
    const activeRemove = buyingFor === "attacker" ? removeItem : removeTargetItem;

    return {
        heroId, setHeroId,
        targetId, setTargetId,
        loadoutA, setLoadoutA,
        loadoutB, setLoadoutB,
        targetLoadout, setTargetLoadout,
        compareOn, setCompareOn,
        compareView, setCompareView,
        activeBuild, setActiveBuild,
        buyingFor, setBuyingFor,
        matchTargetLevel, setMatchTargetLevel,
        range, setRange,
        shots, setShots,
        headshots, setHeadshots,
        shotsTouched, setShotsTouched,
        accuracy, setAccuracy,
        headshotPct, setHeadshotPct,
        hittingEnemy, setHittingEnemy,
        resistDebuffs, setResistDebuffs,
        activesFiring, setActivesFiring,
        stacksByItem, setStacksByItem,
        imbueAssign, setImbueAssign,
        abilityRanks, setAbilityRanks,
        excludedActives, setExcludedActives,
        checkpoint, setCheckpoint,
        disabledAbilities, setDisabledAbilities,
        loadout,
        setAttackerLoadout,
        hero,
        target,
        equippedA,
        equippedB,
        targetEquipped,
        // Lane Lab v2 (D1) auto-enemy
        autoEnemy, setAutoEnemy,
        autoEnemyAvailable,
        autoEnemyLoadout,
        autoEnemyEquipped,
        effectiveEnemyEquipped,
        yourSouls,
        equipped,
        resultA,
        resultB,
        result,
        equippedFireRate,
        stackingItems,
        damageActives,
        imbueItems,
        imbuedBy,
        counterOpts,
        executes,
        equippedMeleeResist,
        cp,
        previewEquipped,
        previewResult,
        componentIds,
        activeLoadout,
        activeAdd,
        activeRemove,
        addItem,
        removeItem,
        moveStep,
        addTargetItem,
        removeTargetItem,
        startCompare,
        onCompareClick,
        exitCompare,
        buildShareUrl,
        toggleAbility,
        toast,
    };
}
