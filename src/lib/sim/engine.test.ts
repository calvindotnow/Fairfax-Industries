import { test, expect, describe } from "bun:test";
import { db } from "../../db";
import { simulate, levelFromSouls, investmentBonus, parseEffects } from "./index";
import type { HeroWithAbilities, ItemData, Build, Target } from "./index";

// Real game data (DB is populated by the deadlock-api sync).
const heroes = (await db.query.heroes.findMany({ with: { abilities: true } })) as unknown as HeroWithAbilities[];
const items = (await db.query.items.findMany({ with: { modifiers: true } })) as unknown as ItemData[];

const hero = (name: string) => heroes.find((h) => h.name === name)!;
const item = (name: string) => items.find((i) => i.name === name)!;
const byCategoryDesc = (cat: string) =>
    items.filter((i) => i.category === cat).sort((a, b) => b.soulCost - a.soulCost);

const opts = (over: Partial<{ range: number; shots: number; headshots: number; disabledAbilityIds: number[] }> = {}) => ({
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
    test("Mystic Shot procs once per second over the burst window", () => {
        // Abrams fires ~1.59/s, so 8 shots span ~5s → proc fires ~6 times.
        const r = simulate({ hero: hero("Abrams"), items: [item("Mystic Shot")] }, { hero: hero("Haze") }, opts({ range: 5 }));
        const proc = r.burst.procs.find((p) => p.name === "Mystic Shot");
        expect(proc).toBeDefined();
        expect(proc!.count).toBe(6);
    });

    test("headshot bonus only applies to headshot shots", () => {
        const noHs = simulate({ hero: hero("Haze"), items: [item("Headshot Booster")] }, { hero: hero("Abrams") }, opts({ headshots: 0 }));
        const withHs = simulate({ hero: hero("Haze"), items: [item("Headshot Booster")] }, { hero: hero("Abrams") }, opts({ headshots: 3 }));
        expect(withHs.burst.headshotExtra).toBeGreaterThan(0);
        expect(noHs.burst.headshotExtra).toBe(0);
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
