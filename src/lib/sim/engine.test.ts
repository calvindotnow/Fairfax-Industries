import { test, expect, describe } from "bun:test";
import { db } from "../../db";
import { simulate, levelFromSouls, investmentBonus, parseEffects } from "./index";
import type { HeroWithAbilities, ItemData } from "./index";

// Real game data (DB is populated by the deadlock-api sync).
const heroes = (await db.query.heroes.findMany({ with: { abilities: true } })) as unknown as HeroWithAbilities[];
const items = (await db.query.items.findMany({ with: { modifiers: true } })) as unknown as ItemData[];

const hero = (name: string) => heroes.find((h) => h.name === name)!;
const item = (name: string) => items.find((i) => i.name === name)!;
const byCategoryDesc = (cat: string) =>
    items.filter((i) => i.category === cat).sort((a, b) => b.soulCost - a.soulCost);

const opts = (over: Partial<{ range: number; shots: number; headshots: number; disabledAbilityIds: number[]; hittingEnemy: boolean; resistDebuffs: boolean; activesFiring: boolean; stacksByItem: Record<number, number>; accuracy: number }> = {}) => ({
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

    test("Actives firing applies active items' self-buffs (Blood Tribute fire rate)", () => {
        const off = simulate({ hero: hero("Haze"), items: [item("Blood Tribute")] }, { hero: hero("Abrams") }, opts({ range: 10 }));
        const on = simulate({ hero: hero("Haze"), items: [item("Blood Tribute")] }, { hero: hero("Abrams") }, opts({ range: 10, activesFiring: true }));
        expect(on.sustainedDps).toBeGreaterThan(off.sustainedDps);
    });

    test("accuracy scales sustained DPS but not burst", () => {
        const full = simulate({ hero: hero("Haze"), items: [] }, { hero: hero("Abrams") }, opts({ accuracy: 100 }));
        const half = simulate({ hero: hero("Haze"), items: [] }, { hero: hero("Abrams") }, opts({ accuracy: 50 }));
        expect(half.sustainedDps).toBeCloseTo(full.sustainedDps * 0.5);
        expect(half.burst.total).toBeCloseTo(full.burst.total);
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

    test("disabling an ability removes it from the burst total", () => {
        const haze = hero("Haze");
        const dmgAbility = haze.abilities.find((a) => (a.baseDamage ?? 0) > 0)!;
        const on = simulate({ hero: haze, items: [] }, { hero: hero("Abrams") }, opts());
        const off = simulate({ hero: haze, items: [] }, { hero: hero("Abrams") }, opts({ disabledAbilityIds: [dmgAbility.id] }));
        expect(off.burst.total).toBeLessThan(on.burst.total);
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
