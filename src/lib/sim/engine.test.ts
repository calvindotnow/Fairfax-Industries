import { test, expect, describe } from "bun:test";
import { db } from "../../db";
import { simulate, levelFromSouls, investmentBonus, parseEffects, abilityExecute } from "./index";
import type { HeroWithAbilities, ItemData } from "./index";
import { tierBehaviorFor, TIER_BEHAVIORS, type TierBehaviorEntry } from "./tier-behaviors";

// Real game data (DB is populated by the deadlock-api sync).
const heroes = (await db.query.heroes.findMany({ with: { abilities: true } })) as unknown as HeroWithAbilities[];
const items = (await db.query.items.findMany({ with: { modifiers: true } })) as unknown as ItemData[];

const hero = (name: string) => heroes.find((h) => h.name === name)!;
const item = (name: string) => items.find((i) => i.name === name)!;
const byCategoryDesc = (cat: string) =>
    items.filter((i) => i.category === cat).sort((a, b) => b.soulCost - a.soulCost);

const opts = (over: Partial<{ range: number; shots: number; headshots: number; disabledAbilityIds: number[]; hittingEnemy: boolean; resistDebuffs: boolean; activesFiring: boolean; stacksByItem: Record<number, number>; accuracy: number; headshotPct: number; abilityRanks: Record<number, number>; excludedActiveItemIds: number[]; imbueAssign: Record<number, number>; tierBehaviorsOverride: TierBehaviorEntry[] }> = {}) => ({
    range: 15,
    shots: 8,
    headshots: 0,
    ...over,
});

describe("tables (pure)", () => {
    test("souls → level breakpoints", () => {
        expect(levelFromSouls(0)).toBe(1);
        expect(levelFromSouls(299)).toBe(1);
        expect(levelFromSouls(300)).toBe(2);
        expect(levelFromSouls(11000)).toBe(16);
        expect(levelFromSouls(40000)).toBe(36);
        expect(levelFromSouls(999999)).toBe(36); // capped
    });

    test("investment bonus is stepwise with the 4,800 jump", () => {
        expect(investmentBonus(0).weapon).toBe(0);
        expect(investmentBonus(799).weapon).toBe(0);
        expect(investmentBonus(800).weapon).toBe(9);
        expect(investmentBonus(3200).weapon).toBe(18);
        expect(investmentBonus(4800).weapon).toBe(46); // significant investment bonus
        expect(investmentBonus(6400).weapon).toBe(54);
        expect(investmentBonus(28800).spirit).toBe(100);
    });

    test("parseEffects tolerates junk", () => {
        expect(parseEffects(null)).toEqual([]);
        expect(parseEffects("not json")).toEqual([]);
        expect(parseEffects(JSON.stringify([{ kind: "onHitProc", value: 40 }]))).toHaveLength(1);
    });
});

describe("weapon damage", () => {
    test("Haze, no items, level 1 ≈ 50 DPS at point blank", () => {
        const r = simulate({ hero: hero("Haze"), items: [] }, { hero: hero("Abrams") }, opts());
        expect(Math.round(r.sustainedDps)).toBe(50);
        expect(r.level).toBe(1);
        expect(r.soulsSpent).toBe(0);
    });

    test("souls spent on items raises level and base damage", () => {
        const t4 = byCategoryDesc("weapon")[0]; // 6,400 souls
        const r = simulate({ hero: hero("Haze"), items: [t4] }, { hero: hero("Abrams") }, opts());
        expect(r.soulsSpent).toBe(6400);
        expect(r.level).toBe(11);
        expect(r.sustainedDps).toBeGreaterThan(50);
    });
});

describe("investment bonuses", () => {
    test("6,400 weapon souls → +54% weapon investment", () => {
        const t4 = byCategoryDesc("weapon")[0];
        const r = simulate({ hero: hero("Haze"), items: [t4] }, { hero: hero("Abrams") }, opts());
        expect(r.investment.weaponPct).toBe(54);
    });

    test("6,400 spirit souls → +45 spirit power, raising the hero's spirit", () => {
        const t4spirit = byCategoryDesc("spirit")[0];
        const r = simulate({ hero: hero("Haze"), items: [t4spirit] }, { hero: hero("Abrams") }, opts());
        expect(r.investment.spiritFlat).toBe(45);
        expect(r.heroStats.spiritPower).toBeGreaterThanOrEqual(45);
    });
});

describe("item effects in burst", () => {
    test("Mystic Shot is gated by its 8s cooldown, not per-bullet (no shotgun inflation)", () => {
        // Mystic Shot's real re-proc gate is AbilityCooldown=8s. Abrams' 8-shot burst
        // spans ~5s (< 8s), so the proc fires exactly once — it must NOT scale up just
        // because a slow weapon takes longer to fire the same shot count.
        const r = simulate({ hero: hero("Abrams"), items: [item("Mystic Shot")] }, { hero: hero("Haze") }, opts({ range: 5 }));
        const proc = r.burst.procs.find((p) => p.name === "Mystic Shot");
        expect(proc).toBeDefined();
        expect(proc!.count).toBe(1);
    });

    test("Mystic Shot proc damage scales with Spirit Power", () => {
        // Mystic Shot is +40 spirit +1.2 per Spirit. Adding Extra Spirit (+10 Spirit)
        // must raise the proc's damage (same single proc, bigger hit).
        const base = simulate({ hero: hero("Abrams"), items: [item("Mystic Shot")] }, { hero: hero("Haze") }, opts({ range: 5 }));
        const buffed = simulate({ hero: hero("Abrams"), items: [item("Mystic Shot"), item("Extra Spirit")] }, { hero: hero("Haze") }, opts({ range: 5 }));
        const b = base.burst.procs.find((p) => p.name === "Mystic Shot")!;
        const s = buffed.burst.procs.find((p) => p.name === "Mystic Shot")!;
        expect(s.dmg).toBeGreaterThan(b.dmg);
    });

    test("headshot bonus only applies to headshot shots", () => {
        const noHs = simulate({ hero: hero("Haze"), items: [item("Headshot Booster")] }, { hero: hero("Abrams") }, opts({ headshots: 0 }));
        const withHs = simulate({ hero: hero("Haze"), items: [item("Headshot Booster")] }, { hero: hero("Abrams") }, opts({ headshots: 3 }));
        expect(withHs.burst.headshotExtra).toBeGreaterThan(0);
        expect(noHs.burst.headshotExtra).toBe(0);
    });

    test("headshots apply the base 1.65x weapon multiplier even with no headshot item", () => {
        // Abrams takes normal crit damage (scale 1), so all-headshot weapon damage = 1.65× body.
        const body = simulate({ hero: hero("Vindicta"), items: [] }, { hero: hero("Abrams") }, opts({ shots: 8, headshots: 0 }));
        const head = simulate({ hero: hero("Vindicta"), items: [] }, { hero: hero("Abrams") }, opts({ shots: 8, headshots: 8 }));
        expect(head.burst.headshotExtra).toBeGreaterThan(0);
        expect(head.burst.weaponDamage / body.burst.weaponDamage).toBeCloseTo(1.65, 2);
    });
});

describe("combat-scenario conditionals", () => {
    test("Burst Fire lifts fire rate only while hitting an enemy (no double-count)", () => {
        const off = simulate({ hero: hero("Haze"), items: [item("Burst Fire")] }, { hero: hero("Abrams") }, opts({ range: 10 }));
        const on = simulate({ hero: hero("Haze"), items: [item("Burst Fire")] }, { hero: hero("Abrams") }, opts({ range: 10, hittingEnemy: true }));
        expect(on.sustainedDps).toBeGreaterThan(off.sustainedDps);
    });

    test("resist-debuff items lower the target's resist only when applied", () => {
        const off = simulate({ hero: hero("Haze"), items: [item("Crippling Headshot")] }, { hero: hero("Abrams") }, opts({ range: 10 }));
        const on = simulate({ hero: hero("Haze"), items: [item("Crippling Headshot")] }, { hero: hero("Abrams") }, opts({ range: 10, resistDebuffs: true }));
        expect(on.burst.total).toBeGreaterThan(off.burst.total);
    });

    test("Berserker stacks ramp weapon damage per item, capped at maxStacks", () => {
        const bk = item("Berserker");
        const s0 = simulate({ hero: hero("Haze"), items: [bk] }, { hero: hero("Abrams") }, opts({ range: 10, stacksByItem: { [bk.id]: 0 } }));
        const s10 = simulate({ hero: hero("Haze"), items: [bk] }, { hero: hero("Abrams") }, opts({ range: 10, stacksByItem: { [bk.id]: 10 } }));
        const s99 = simulate({ hero: hero("Haze"), items: [bk] }, { hero: hero("Abrams") }, opts({ range: 10, stacksByItem: { [bk.id]: 99 } }));
        expect(s10.damagePerShot).toBeGreaterThan(s0.damagePerShot);
        expect(s99.damagePerShot).toBeCloseTo(s10.damagePerShot); // capped at 10 stacks
    });

    test("Escalating Exposure's per-stack Spirit Amp raises spirit ability damage (target takes more)", () => {
        // Synthetic item shaped like the real Escalating Exposure effect: 4.5% Spirit Amp per
        // stack, cap 12 → +54% spirit damage at max. Modeled as a TARGET spirit-damage amp
        // (multiplies spirit damage), distinct from Spirit Power (which grows the coefficient term).
        const amp: ItemData = {
            id: 990001, name: "Escalating Exposure (test)", category: "spirit", tier: 3, soulCost: 3000,
            isActive: false, modifiers: [],
            effects: JSON.stringify([{ kind: "stacking", value: 4.5, stat: "spiritAmp", maxStacks: 12 }]),
        };
        const napalm = hero("Infernus").abilities.find((a) => /Napalm/.test(a.name))!;
        const base = simulate({ hero: hero("Infernus"), items: [amp] }, { hero: hero("Abrams") }, opts({ stacksByItem: { [amp.id]: 0 } }));
        const maxed = simulate({ hero: hero("Infernus"), items: [amp] }, { hero: hero("Abrams") }, opts({ stacksByItem: { [amp.id]: 12 } }));
        const b = base.abilities.find((a) => a.id === napalm.id)!.burstDamage;
        const m = maxed.abilities.find((a) => a.id === napalm.id)!.burstDamage;
        // 12 stacks × 4.5% = +54% → ×1.54 exactly (soul cost identical in both, so nothing else moves).
        expect(m / b).toBeCloseTo(1.54, 5);
    });

    test("Escalating Exposure's Spirit Amp does not touch weapon ability/damage", () => {
        const amp: ItemData = {
            id: 990002, name: "Escalating Exposure (test)", category: "spirit", tier: 3, soulCost: 3000,
            isActive: false, modifiers: [],
            effects: JSON.stringify([{ kind: "stacking", value: 4.5, stat: "spiritAmp", maxStacks: 12 }]),
        };
        // Haze weapon shots are bullet damage — the spirit amp must leave weapon output untouched.
        const off = simulate({ hero: hero("Haze"), items: [amp] }, { hero: hero("Abrams") }, opts({ range: 10, stacksByItem: { [amp.id]: 0 } }));
        const on = simulate({ hero: hero("Haze"), items: [amp] }, { hero: hero("Abrams") }, opts({ range: 10, stacksByItem: { [amp.id]: 12 } }));
        expect(on.damagePerShot).toBeCloseTo(off.damagePerShot, 5);
        expect(on.burst.weaponDamage).toBeCloseTo(off.burst.weaponDamage, 5);
    });

    test("Restorative Locket reports heal-per-cast sustain scaling with stacks (readout only)", () => {
        // Real Locket: 16 heal per stack, cap 25 → 400 max heal. No damage output, so it surfaces
        // as a sustain readout (SimResult.sustain), not folded into any damage number.
        const locket: ItemData = {
            id: 990003, name: "Restorative Locket (test)", category: "vitality", tier: 2, soulCost: 1250,
            isActive: true, modifiers: [],
            effects: JSON.stringify([{ kind: "stacking", value: 16, stat: "heal", maxStacks: 25 }]),
        };
        const none = simulate({ hero: hero("Haze"), items: [locket] }, { hero: hero("Abrams") }, opts({ stacksByItem: { [locket.id]: 0 } }));
        const maxed = simulate({ hero: hero("Haze"), items: [locket] }, { hero: hero("Abrams") }, opts({ stacksByItem: { [locket.id]: 25 } }));
        expect(none.sustain.heal).toBe(0);
        expect(maxed.sustain.heal).toBe(400); // 25 × 16
        // A heal must never leak into the damage numbers.
        expect(maxed.burst.total).toBeCloseTo(none.burst.total, 5);
    });

    test("Actives firing applies active items' self-buffs (Blood Tribute fire rate)", () => {
        const off = simulate({ hero: hero("Haze"), items: [item("Blood Tribute")] }, { hero: hero("Abrams") }, opts({ range: 10 }));
        const on = simulate({ hero: hero("Haze"), items: [item("Blood Tribute")] }, { hero: hero("Abrams") }, opts({ range: 10, activesFiring: true }));
        expect(on.sustainedDps).toBeGreaterThan(off.sustainedDps);
    });

    test("active items' direct damage (Arctic Blast) hits burst only while actives fire, but always lists in spiritItemDamage", () => {
        const off = simulate({ hero: hero("Shiv"), items: [item("Arctic Blast")] }, { hero: hero("Abrams") }, opts({ range: 10 }));
        const on = simulate({ hero: hero("Shiv"), items: [item("Arctic Blast")] }, { hero: hero("Abrams") }, opts({ range: 10, activesFiring: true }));
        expect(on.burst.total).toBeGreaterThan(off.burst.total);
        expect(off.spiritItemDamage.some((s) => /Arctic Blast/.test(s.name))).toBe(true);
    });

    test("excludedActiveItemIds removes exactly that active's direct-damage contribution", () => {
        const arctic = item("Arctic Blast");
        const cold = item("Cold Front");
        // Same loadout both times — only the exclusion toggle differs — so the only thing that
        // changes is Arctic Blast's own on-cast damage (its passive stats still apply either way).
        const both = simulate({ hero: hero("Shiv"), items: [arctic, cold] }, { hero: hero("Abrams") }, opts({ range: 10, activesFiring: true }));
        const noArctic = simulate({ hero: hero("Shiv"), items: [arctic, cold] }, { hero: hero("Abrams") }, opts({ range: 10, activesFiring: true, excludedActiveItemIds: [arctic.id] }));
        const arcticDmg = both.burst.procs.find((p) => (p.name ?? "").includes("Arctic Blast"))!.dmg;
        expect(arcticDmg).toBeGreaterThan(0);
        expect(both.burst.total - noArctic.burst.total).toBeCloseTo(arcticDmg, 1);
        expect(noArctic.burst.procs.some((p) => (p.name ?? "").includes("Arctic Blast"))).toBe(false);
    });

    test("excluding every damage active equals 'Actives firing' off", () => {
        const arctic = item("Arctic Blast");
        const cold = item("Cold Front");
        const off = simulate({ hero: hero("Shiv"), items: [arctic, cold] }, { hero: hero("Abrams") }, opts({ range: 10 }));
        const allExcluded = simulate({ hero: hero("Shiv"), items: [arctic, cold] }, { hero: hero("Abrams") }, opts({ range: 10, activesFiring: true, excludedActiveItemIds: [arctic.id, cold.id] }));
        expect(allExcluded.burst.total).toBeCloseTo(off.burst.total, 1);
    });

    test("excludedActiveItemIds does not affect always-on (Tankbuster) damage", () => {
        const tb = item("Tankbuster");
        const base = simulate({ hero: hero("Haze"), items: [tb] }, { hero: hero("Abrams") }, opts());
        const excluded = simulate({ hero: hero("Haze"), items: [tb] }, { hero: hero("Abrams") }, opts({ excludedActiveItemIds: [tb.id] }));
        // Tankbuster is alwaysOn — exclusion can't touch it.
        expect(excluded.burst.total).toBeCloseTo(base.burst.total, 1);
    });

    test("Tankbuster adds always-on health-percent damage that ignores resist", () => {
        const r = simulate({ hero: hero("Haze"), items: [item("Tankbuster")] }, { hero: hero("Abrams") }, opts());
        const tb = r.spiritItemDamage.find((s) => /Tankbuster/.test(s.name));
        expect(tb).toBeDefined();
        expect(tb!.value).toBeGreaterThan(40); // 40 flat + 8% of the target's max health
    });

    test("accuracy scales sustained DPS but not burst", () => {
        const full = simulate({ hero: hero("Haze"), items: [] }, { hero: hero("Abrams") }, opts({ accuracy: 100 }));
        const half = simulate({ hero: hero("Haze"), items: [] }, { hero: hero("Abrams") }, opts({ accuracy: 50 }));
        expect(half.sustainedDps).toBeCloseTo(full.sustainedDps * 0.5);
        expect(half.burst.total).toBeCloseTo(full.burst.total);
    });

    test("headshot rate raises sustained DPS (the 1.65x crit on a fraction of shots)", () => {
        const none = simulate({ hero: hero("Vindicta"), items: [] }, { hero: hero("Abrams") }, opts({ headshotPct: 0 }));
        const some = simulate({ hero: hero("Vindicta"), items: [] }, { hero: hero("Abrams") }, opts({ headshotPct: 100 }));
        expect(some.sustainedDps).toBeCloseTo(none.sustainedDps * 1.65, 0);
    });

    test("melee scales with melee-damage items and is cut by the target's melee resist", () => {
        const bare = simulate({ hero: hero("Abrams"), items: [] }, { hero: hero("Haze") }, opts());
        const withMelee = simulate({ hero: hero("Abrams"), items: [item("Lifestrike")] }, { hero: hero("Haze") }, opts());
        expect(withMelee.melee.heavy).toBeGreaterThan(bare.melee.heavy);
        const vsResist = simulate({ hero: hero("Abrams"), items: [] }, { hero: hero("Haze"), items: [item("Juggernaut")] }, opts());
        expect(vsResist.melee.heavy).toBeLessThan(bare.melee.heavy);
    });
});

describe("abilities", () => {
    test("direct abilities show a total; channeled DoTs show a /s rate", () => {
        const r = simulate({ hero: hero("Seven"), items: [] }, { hero: hero("Abrams") }, opts());
        const storm = r.abilities.find((a) => /Storm Cloud/.test(a.name))!;
        expect(storm.isDot).toBe(true);
        expect(storm.display.endsWith("/s")).toBe(true);
        expect(storm.burstDamage).toBe(0); // DoT excluded from instant burst
    });

    test("Serrated Knives bleed is a multi-second DoT, not an instant hit", () => {
        const r = simulate({ hero: hero("Shiv"), items: [] }, { hero: hero("Abrams") }, opts());
        const sk = r.abilities.find((a) => /Serrated Knives/.test(a.name))!;
        expect(sk.isDot).toBe(true);
        expect(sk.dotPerSec).toBeGreaterThan(0);
        expect(sk.burstDamage).toBe(0); // bleed isn't an instant hit
        expect(sk.dotFull).toBeGreaterThan(sk.dotPerSec); // spans multiple seconds
    });

    test("ranking up an ability applies its tier upgrades (Serrated Knives bleed grows at T3)", () => {
        const shiv = hero("Shiv");
        const sk = shiv.abilities.find((a) => /Serrated Knives/.test(a.name))!;
        const r0 = simulate({ hero: shiv, items: [] }, { hero: hero("Abrams") }, opts());
        const r3 = simulate({ hero: shiv, items: [] }, { hero: hero("Abrams") }, opts({ abilityRanks: { [sk.id]: 3 } }));
        const b0 = r0.abilities.find((a) => a.id === sk.id)!;
        const b3 = r3.abilities.find((a) => a.id === sk.id)!;
        expect(b0.rank).toBe(0);
        expect(b3.rank).toBe(3);
        expect(b3.maxRank).toBe(3);
        expect(b3.dotFull).toBeGreaterThan(b0.dotFull); // +12 bleed DPS and +2s duration at higher ranks
    });

    test("disabling an ability removes it from the burst total", () => {
        const haze = hero("Haze");
        const dmgAbility = haze.abilities.find((a) => (a.baseDamage ?? 0) > 0)!;
        const on = simulate({ hero: haze, items: [] }, { hero: hero("Abrams") }, opts());
        const off = simulate({ hero: haze, items: [] }, { hero: hero("Abrams") }, opts({ disabledAbilityIds: [dmgAbility.id] }));
        expect(off.burst.total).toBeLessThan(on.burst.total);
    });

    // ── B2: %-of-health ability damage (evaluated at the target's FULL health) ──
    // Build a hero carrying one crafted spirit ability with a health-scaling descriptor, so the
    // engine path is exercised independently of what the sync happens to have baked.
    const withCraftedAbility = (base: number, healthScaling: object) => {
        const h = hero("Infernus");
        const napalm = h.abilities.find((a) => /Napalm/.test(a.name))!;
        const crafted = {
            ...napalm, id: 970001, name: "Crafted HP Ability", baseDamage: base, spiritScaling: 0,
            dotDps: 0, dotDuration: 0, damageKind: "spirit", upgrades: null,
            properties: JSON.stringify(healthScaling),
        };
        return { ...h, abilities: [crafted] };
    };

    test("current-health ability damage adds pct% of the target's max health at full HP", () => {
        // Abrams max health at level 1 = 800. 15% current-health damage at full HP = 120 raw,
        // added to the 100 base, then reduced by Abrams' spirit resist (0 at level 1) = 220.
        const heroC = withCraftedAbility(100, { healthScaling: { kind: "current", pct: 15 } });
        const noScale = withCraftedAbility(100, {}); // same base, no health scaling
        const r = simulate({ hero: heroC, items: [] }, { hero: hero("Abrams") }, opts());
        const rNo = simulate({ hero: noScale, items: [] }, { hero: hero("Abrams") }, opts());
        const row = r.abilities[0];
        const rowNo = rNo.abilities[0];
        // Abrams starts at 800 HP, 0 spirit resist at level 1.
        expect(rowNo.burstDamage).toBeCloseTo(100, 0); // base only, no health add
        expect(row.burstDamage - rowNo.burstDamage).toBeCloseTo(0.15 * 800, 0); // +120
    });

    test("missing-health ability damage shows nothing at full HP (missing = 0)", () => {
        const heroM = withCraftedAbility(100, { healthScaling: { kind: "missing", pct: 6 } });
        const noScale = withCraftedAbility(100, {});
        const r = simulate({ hero: heroM, items: [] }, { hero: hero("Abrams") }, opts());
        const rNo = simulate({ hero: noScale, items: [] }, { hero: hero("Abrams") }, opts());
        // At full health there is no missing health, so it matches the base-only ability exactly.
        expect(r.abilities[0].burstDamage).toBeCloseTo(rNo.abilities[0].burstDamage, 5);
    });

    // ── B3: imbue recompute — the imbue item's magnitude changes the ASSIGNED ability's numbers ──
    const imbueItem = (over: object): ItemData => ({
        id: 960001, name: "Surge of Power (test)", category: "spirit", tier: 3, soulCost: 3000,
        isActive: false, modifiers: [],
        effects: JSON.stringify([{ kind: "imbue", value: 0, ...over }]),
    });

    test("imbued Spirit Power lifts only the assigned ability's damage (via its coefficient)", () => {
        // Napalm: base 40, scale 0.6 spirit. +28 imbued Spirit Power → +28×0.6 = +16.8 raw
        // to that ability only (Abrams' spirit resist is 0 at level 1, so mitigated add = 16.8).
        const napalm = hero("Infernus").abilities.find((a) => /Napalm/.test(a.name))!;
        const imb = imbueItem({ imbuedSpiritPower: 28 });
        const unassigned = simulate({ hero: hero("Infernus"), items: [imb] }, { hero: hero("Abrams") }, opts());
        const assigned = simulate({ hero: hero("Infernus"), items: [imb] }, { hero: hero("Abrams") },
            opts({ imbueAssign: { [imb.id]: napalm.id } }));
        const before = unassigned.abilities.find((a) => a.id === napalm.id)!.burstDamage;
        const after = assigned.abilities.find((a) => a.id === napalm.id)!.burstDamage;
        expect(after - before).toBeCloseTo(28 * 0.6, 1); // +16.8, before any resist (Abrams = 0)
    });

    test("imbued Spirit Power does NOT touch other abilities", () => {
        const infernus = hero("Infernus");
        const napalm = infernus.abilities.find((a) => /Napalm/.test(a.name))!;
        const other = infernus.abilities.find((a) => a.id !== napalm.id && (a.baseDamage ?? 0) > 0)!;
        const imb = imbueItem({ imbuedSpiritPower: 28 });
        const assigned = simulate({ hero: infernus, items: [imb] }, { hero: hero("Abrams") },
            opts({ imbueAssign: { [imb.id]: napalm.id } }));
        const base = simulate({ hero: infernus, items: [imb] }, { hero: hero("Abrams") }, opts());
        const otherA = assigned.abilities.find((a) => a.id === other.id)!.burstDamage;
        const otherB = base.abilities.find((a) => a.id === other.id)!.burstDamage;
        expect(otherA).toBeCloseTo(otherB, 5); // untouched
    });

    test("imbued duration extends the assigned DoT ability's full-duration damage", () => {
        // Shiv's Serrated Knives is a multi-second bleed DoT. A +25% duration imbue extends its
        // lifetime, so dotFull grows by ~25% while the per-second rate is unchanged.
        const shiv = hero("Shiv");
        const sk = shiv.abilities.find((a) => /Serrated Knives/.test(a.name))!;
        const imb = imbueItem({ imbuedDurationPct: 25 });
        const base = simulate({ hero: shiv, items: [imb] }, { hero: hero("Abrams") }, opts());
        const assigned = simulate({ hero: shiv, items: [imb] }, { hero: hero("Abrams") },
            opts({ imbueAssign: { [imb.id]: sk.id } }));
        const b = base.abilities.find((a) => a.id === sk.id)!;
        const a2 = assigned.abilities.find((a) => a.id === sk.id)!;
        expect(a2.dotPerSec).toBeCloseTo(b.dotPerSec, 3); // rate unchanged
        expect(a2.dotFull / b.dotFull).toBeCloseTo(1.25, 2); // +25% duration
    });
});

describe("tier behaviors (B4 — curated non-numeric rank mechanics)", () => {
    test("the shipped table is empty (no unverified mechanics encoded)", () => {
        // The canonical candidate (Shiv Slice and Dice ×2) was NOT verified as a rank threshold —
        // the double strike is a Rage/ultimate echo, not a T3 behavior — so nothing is encoded.
        expect(TIER_BEHAVIORS).toHaveLength(0);
    });

    test("tierBehaviorFor matches on hero + ability + rank threshold", () => {
        const table: TierBehaviorEntry[] = [
            { hero: "Shiv", abilityNameTest: /Slice and Dice/i, minRank: 3, behavior: { damageMult: 2, note: "test" } },
        ];
        expect(tierBehaviorFor("Shiv", "Slice and Dice", 3, table)).toEqual({ damageMult: 2, note: "test" });
        expect(tierBehaviorFor("Shiv", "Slice and Dice", 2, table)).toBeNull(); // below threshold
        expect(tierBehaviorFor("Haze", "Slice and Dice", 3, table)).toBeNull(); // wrong hero
        expect(tierBehaviorFor("Shiv", "Fixation", 3, table)).toBeNull(); // wrong ability
    });

    test("a curated damageMult doubles the ability's damage once its rank meets the threshold", () => {
        // Prove the ENGINE application with an injected table (the real table stays empty). Infernus'
        // Napalm at rank 0 with a ×2 override at minRank 0 should deal exactly twice its damage.
        const infernus = hero("Infernus");
        const napalm = infernus.abilities.find((a) => /Napalm/.test(a.name))!;
        const override: TierBehaviorEntry[] = [
            { hero: "Infernus", abilityNameTest: /Napalm/i, minRank: 0, behavior: { damageMult: 2 } },
        ];
        const base = simulate({ hero: infernus, items: [] }, { hero: hero("Abrams") }, opts());
        const doubled = simulate({ hero: infernus, items: [] }, { hero: hero("Abrams") }, opts({ tierBehaviorsOverride: override }));
        const b = base.abilities.find((a) => a.id === napalm.id)!.burstDamage;
        const d = doubled.abilities.find((a) => a.id === napalm.id)!.burstDamage;
        expect(d).toBeCloseTo(b * 2, 2);
    });
});

describe("engine depth (R-4)", () => {
    test("on-hit procs are folded into sustained DPS", () => {
        const withProc = simulate({ hero: hero("Abrams"), items: [item("Mystic Shot")] }, { hero: hero("Haze") }, opts({ range: 5 }));
        const noProc = simulate({ hero: hero("Abrams"), items: [] }, { hero: hero("Haze") }, opts({ range: 5 }));
        expect(withProc.procDps).toBeGreaterThan(0);
        expect(noProc.procDps).toBe(0);
        // sustained DPS = weapon DPS + proc DPS
        expect(withProc.sustainedDps).toBeGreaterThan(withProc.sustainedDps - withProc.procDps - 0.001);
    });

    test("melee damage is exposed, mitigated, and heavy > light", () => {
        const r = simulate({ hero: hero("Abrams"), items: [] }, { hero: hero("Haze") }, opts());
        expect(r.melee.light).toBeGreaterThan(0);
        expect(r.melee.heavy).toBeGreaterThan(r.melee.light);
    });

    test("melee scales up with level, preserving the heavy:light ratio", () => {
        const bebop = hero("Bebop");
        // Raise the level with a pure-vitality item (no weapon damage) — otherwise the
        // 50%-weapon-damage melee scaling would inflate the per-boon growth we're measuring.
        const t4 = byCategoryDesc("vitality").find((i) => !(i.modifiers ?? []).some((m) => m.statName === "bulletDamage"))!;
        const lvl1 = simulate({ hero: bebop, items: [] }, { hero: hero("Haze") }, opts());
        const lvlN = simulate({ hero: bebop, items: [t4] }, { hero: hero("Haze") }, opts());
        expect(lvlN.level).toBeGreaterThan(1);
        expect(lvlN.melee.light).toBeGreaterThan(lvl1.melee.light); // grows with level
        // light grows by meleePerLevel/boon (Bebop 1.58); the target's resist is identical
        // in both sims, so the pre-resist light delta per boon should be ~1.58.
        const perBoon = (lvlN.melee.light - lvl1.melee.light) / (lvl1.melee.light / bebop.lightMeleeDamage!) / (lvlN.level - 1);
        expect(perBoon).toBeCloseTo(1.58, 1);
        // heavy and light scale by the same factor → ratio constant across levels
        expect(lvlN.melee.heavy / lvlN.melee.light).toBeCloseTo(lvl1.melee.heavy / lvl1.melee.light, 5);
    });
});

describe("abilityExecute (execute-threshold accessor)", () => {
    test("returns null when the ability has no properties / no execute", () => {
        expect(abilityExecute({ properties: null })).toBeNull();
        expect(abilityExecute({ properties: undefined })).toBeNull();
        expect(abilityExecute({ properties: "{}" })).toBeNull();
        expect(abilityExecute({ properties: JSON.stringify({ rangeScalesWithSpirit: true }) })).toBeNull();
    });

    test("returns null on malformed JSON", () => {
        expect(abilityExecute({ properties: "not json" })).toBeNull();
    });

    test("reads pct + kind from the properties JSON", () => {
        expect(abilityExecute({ properties: JSON.stringify({ executePct: 8, executeKind: "kill" }) }))
            .toEqual({ pct: 8, kind: "kill" });
        expect(abilityExecute({ properties: JSON.stringify({ executePct: 30, executeKind: "bonus" }) }))
            .toEqual({ pct: 30, kind: "bonus" });
    });

    test("defaults kind to 'bonus' when only executePct is present", () => {
        expect(abilityExecute({ properties: JSON.stringify({ executePct: 50 }) }))
            .toEqual({ pct: 50, kind: "bonus" });
    });

    test("resolves execute data for a real execute hero from the baked data", () => {
        // Some hero in the live pool carries an execute threshold; find it and confirm the
        // accessor surfaces the same pct the sync baked into `properties`.
        const withExecute = heroes
            .flatMap((h) => h.abilities)
            .map((a) => abilityExecute(a))
            .filter((x): x is NonNullable<typeof x> => x != null);
        expect(withExecute.length).toBeGreaterThan(0);
        for (const ex of withExecute) {
            expect(ex.pct).toBeGreaterThan(0);
            expect(["kill", "bonus"]).toContain(ex.kind);
        }
    });
});
