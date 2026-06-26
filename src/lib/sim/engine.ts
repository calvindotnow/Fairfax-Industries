/**
 * The damage-simulation engine.
 *
 * One public entry point — `simulate(build, target, opts)` — returns every
 * number the UI shows. All character stats, item modifiers, item effects,
 * investment bonuses, level scaling, weapon falloff, resistances, abilities,
 * and burst math live here as pure functions. No React, no database.
 */
import type {
    AbilityData,
    AbilityRow,
    AbilityScaling,
    AbilityScalingInfo,
    Build,
    BurstResult,
    ComputedStats,
    HeroData,
    ItemData,
    ItemEffect,
    SimOptions,
    SimResult,
    StatModifier,
    Target,
} from "./types";
import {
    SOULS_LEVEL_TABLE,
    STAT_DEFINITIONS,
    investmentBonus,
    levelFromSouls,
    soulsForLevel,
} from "./tables";

// ─── Effects ──────────────────────────────────────────────────────────────────
export function parseEffects(json: string | null | undefined): ItemEffect[] {
    if (!json) return [];
    try {
        const arr = JSON.parse(json);
        return Array.isArray(arr) ? (arr as ItemEffect[]) : [];
    } catch {
        return [];
    }
}

// ─── Stat aggregation ─────────────────────────────────────────────────────────
/** Apply per-level (per-boon) stat growth to a hero's base stats for a level. */
export function applyLevel(hero: HeroData, level: number): HeroData {
    const boons = Math.max(0, level - 1);
    return {
        ...hero,
        maxHealth: hero.maxHealth + boons * (hero.healthPerLevel ?? 0),
        bulletDamage: hero.bulletDamage + boons * (hero.bulletDamagePerLevel ?? 0),
        spiritPower: (hero.spiritPower ?? 0) + boons * (hero.spiritPerLevel ?? 0),
        bulletResist: (hero.bulletResist ?? 0) + boons * (hero.bulletResistPerLevel ?? 0),
        spiritResist: (hero.spiritResist ?? 0) + boons * (hero.spiritResistPerLevel ?? 0),
    };
}

/** Aggregate a hero's final stats from base + equipped item modifiers. */
export function calculateStats(
    hero: HeroData,
    equippedItems: { modifiers: StatModifier[] }[]
): ComputedStats {
    const result: ComputedStats = {};

    // 1. Spirit power first — other stats may scale off it.
    const spiritPowerBase = hero.spiritPower ?? 0;
    let spiritPowerFlat = 0;
    let spiritPowerPercent = 0;
    for (const item of equippedItems) {
        for (const mod of item.modifiers) {
            if (mod.statName === "spiritPower") {
                spiritPowerFlat += mod.flatBonus;
                spiritPowerPercent += mod.percentBonus;
            }
        }
    }
    const totalSpiritPower = (spiritPowerBase + spiritPowerFlat) * (1 + spiritPowerPercent / 100);
    result.spiritPower = totalSpiritPower;

    // 2. Hero's spirit-scaling coefficients (JSON map of stat -> coefficient).
    let scaling: Record<string, number> = {};
    try {
        if (hero.spiritScaling) scaling = JSON.parse(hero.spiritScaling);
    } catch {
        /* ignore malformed scaling */
    }

    // 3. Every other stat.
    for (const def of STAT_DEFINITIONS) {
        if (def.key === "spiritPower") continue;
        const base = (hero as unknown as Record<string, number>)[def.key] ?? 0;
        let totalFlat = 0;
        const percentBonuses: number[] = [];
        for (const item of equippedItems) {
            for (const mod of item.modifiers) {
                if (mod.statName === def.key) {
                    totalFlat += mod.flatBonus;
                    if (mod.percentBonus !== 0) percentBonuses.push(mod.percentBonus);
                }
            }
        }

        let finalValue: number;
        if (def.stacking === "asymptotic") {
            // Diminishing: 1 - PRODUCT(1 - x/100). Base resist is the first term.
            let survival = 1 - base / 100;
            for (const p of percentBonuses) survival *= 1 - p / 100;
            finalValue = (1 - survival) * 100;
        } else {
            const sumPercent = percentBonuses.reduce((a, b) => a + b, 0);
            finalValue = (base + totalFlat) * (1 + sumPercent / 100);
        }

        const coefficient = scaling[def.key] ?? 0;
        if (coefficient !== 0) finalValue += totalSpiritPower * coefficient;

        result[def.key] = finalValue;
    }

    return result;
}

/** Investment bonuses (souls per category) as synthetic stat modifiers. */
export function investmentFor(items: ItemData[]) {
    const cat: Record<string, number> = { weapon: 0, vitality: 0, spirit: 0 };
    for (const it of items) cat[it.category] = (cat[it.category] ?? 0) + (it.soulCost ?? 0);
    const weaponPct = investmentBonus(cat.weapon).weapon;
    const healthPct = investmentBonus(cat.vitality).health;
    const spiritFlat = investmentBonus(cat.spirit).spirit;
    const mods: StatModifier[] = [
        { statName: "bulletDamage", flatBonus: 0, percentBonus: weaponPct },
        { statName: "maxHealth", flatBonus: 0, percentBonus: healthPct },
        { statName: "spiritPower", flatBonus: spiritFlat, percentBonus: 0 },
    ];
    return { weaponPct, healthPct, spiritFlat, mods };
}

// ─── Weapon hit ───────────────────────────────────────────────────────────────
/** Per-shot weapon damage and DPS at a distance, with falloff and bullet resist. */
export function calculateWeaponHit(
    attackerStats: ComputedStats,
    attackerHero: HeroData,
    defenderStats: ComputedStats,
    distance: number
) {
    const rawDamage = attackerStats.bulletDamage || 0;
    const fireRate = attackerStats.weaponFireRate || 0;
    const bulletResist = defenderStats.bulletResist || 0;

    const start = attackerHero.falloffStart || 22;
    const end = attackerHero.falloffEnd || 58;
    const minPercent = 0.3;

    let falloffMultiplier = 1;
    if (distance > start) {
        const falloffRange = Math.max(end - start, 1);
        const falloffPercent = Math.min((distance - start) / falloffRange, 1);
        falloffMultiplier = 1 - falloffPercent * (1 - minPercent);
    }

    const damageAfterFalloff = rawDamage * falloffMultiplier;
    const mitigatedDamage = damageAfterFalloff * (1 - bulletResist / 100);
    return {
        damagePerBullet: mitigatedDamage,
        dps: mitigatedDamage * fireRate,
        falloffMultiplier,
    };
}

// ─── Ability damage ───────────────────────────────────────────────────────────
/** Total mitigated ability damage: direct/impact + DoT (dps×duration) + spirit scaling. */
export function calculateAbilityDamage(
    ability: Pick<AbilityData, "baseDamage" | "spiritScaling" | "dotDps" | "dotDuration">,
    attackerStats: ComputedStats,
    defenderStats: ComputedStats
) {
    const baseDamage = ability.baseDamage ?? 0;
    const dotTotal = (ability.dotDps ?? 0) * (ability.dotDuration ?? 0);
    const spiritScaling = ability.spiritScaling ?? 0;
    const spiritPower = attackerStats.spiritPower ?? 0;
    const spiritResist = defenderStats.spiritResist ?? 0;
    const rawDamage = baseDamage + dotTotal + spiritPower * spiritScaling;
    return {
        rawDamage,
        mitigatedDamage: rawDamage * (1 - spiritResist / 100),
        isDot: dotTotal > 0,
    };
}

function abilityDamageType(a: AbilityData): "spirit" | "weapon" | "utility" {
    if (a.damageKind === "spirit") return "spirit";
    if (a.damageKind === "weapon") return "weapon";
    return "utility";
}

/**
 * Resolve an ability's Spirit scaling: the damage coefficient (from the
 * `spiritScaling` column) plus the range/duration flags (parsed from the
 * `properties` JSON). Shared by the engine and the heroes detail page so the
 * "scales with Spirit" derivation lives in exactly one place.
 */
export function deriveAbilityScaling(
    a: Pick<AbilityData, "properties" | "spiritScaling">
): AbilityScalingInfo {
    let flags: AbilityScaling = {};
    if (a.properties) {
        try {
            flags = JSON.parse(a.properties) as AbilityScaling;
        } catch { /* malformed — ignore */ }
    }
    const damageScalePerSpirit = a.spiritScaling ?? 0;
    const rangeScalesWithSpirit = !!flags.rangeScalesWithSpirit;
    const durationScalesWithSpirit = !!flags.durationScalesWithSpirit;
    return {
        damageScalePerSpirit,
        rangeScalesWithSpirit,
        durationScalesWithSpirit,
        scalesWithSpirit: damageScalePerSpirit > 0 || rangeScalesWithSpirit || durationScalesWithSpirit,
    };
}

function buildAbilityRows(
    abilities: AbilityData[],
    heroStats: ComputedStats,
    targetStats: ComputedStats
): AbilityRow[] {
    const spirit = heroStats.spiritPower ?? 0;
    return abilities.map((a) => {
        const type = abilityDamageType(a);
        const res =
            type === "spirit"
                ? 1 - (targetStats.spiritResist ?? 0) / 100
                : 1 - (targetStats.bulletResist ?? 0) / 100;
        const isDot = (a.dotDps ?? 0) > 0;
        const { damageScalePerSpirit, scalesWithSpirit } = deriveAbilityScaling(a);
        const base = {
            id: a.id,
            name: a.name,
            type: a.type,
            imageUrl: a.imageUrl,
            cooldown: a.cooldown,
            range: a.range,
            duration: a.duration,
            charges: a.charges,
            chargeCooldown: a.chargeCooldown,
            damageType: type,
            isUltimate: a.type === "ultimate",
            isDot,
            scalesWithSpirit,
            damageScalePerSpirit,
        };
        if (isDot) {
            // Channeled/burn DoT — a per-second rate, not an instant-burst hit.
            const perSec = ((a.dotDps ?? 0) + spirit * (a.spiritScaling ?? 0)) * res;
            const dotFull = perSec * (a.dotDuration ?? 0);
            return {
                ...base,
                display: type === "utility" ? "—" : `${Math.round(perSec).toLocaleString()}/s`,
                burstDamage: 0,
                dotPerSec: type === "utility" ? 0 : perSec,
                dotFull: type === "utility" ? 0 : dotFull,
            };
        }
        const total = calculateAbilityDamage(a, heroStats, targetStats).mitigatedDamage;
        return {
            ...base,
            display: type === "utility" ? "—" : Math.round(total).toLocaleString(),
            burstDamage: total,
            dotPerSec: 0,
            dotFull: 0,
        };
    });
}

// ─── Range-conditional weapon power ──────────────────────────────────────────
/**
 * Range-conditional weapon power (Sharpshooter / Close Quarters) adds into the
 * weapon% bucket additively. We recover the item weapon% sum so the conditional
 * is applied additively, not as a naive multiply on top.
 */
function conditionalWeaponMult(
    items: ItemData[],
    effects: ItemEffect[],
    range: number,
    investmentWeaponPct: number
): number {
    const sumItemWeaponPct =
        investmentWeaponPct +
        items
            .flatMap((it) => it.modifiers ?? [])
            .filter((m) => m.statName === "bulletDamage")
            .reduce((s, m) => s + (m.percentBonus ?? 0), 0);
    const condPct = effects
        .filter((e) => e.kind === "conditionalWeaponPct")
        .reduce((s, e) => {
            const okMin = e.rangeMin == null || range >= e.rangeMin;
            const okMax = e.rangeMax == null || range <= e.rangeMax;
            return s + (okMin && okMax ? e.value : 0);
        }, 0);
    if (condPct === 0) return 1;
    return (1 + (sumItemWeaponPct + condPct) / 100) / (1 + sumItemWeaponPct / 100);
}

// Stacking stats applied as a flat per-stack add; everything else stacks as a percent.
const FLAT_STACK_STATS = new Set(["maxHealth", "sprintSpeed", "moveSpeed", "spiritPower", "stamina", "healthRegen"]);

/**
 * Multiplier that lifts the already-computed fire rate from its baseline tier to
 * its activated tier (Burst Fire: 10% → 32% while hitting an enemy). Fire-rate %
 * stacks additively, so we recover the additive sum and add the activated delta.
 */
function conditionalFireRateMult(items: ItemData[], effects: ItemEffect[]): number {
    const delta = effects
        .filter((e) => e.kind === "conditionalFireRate")
        .reduce((s, e) => s + (e.value - (e.baseValue ?? 0)), 0);
    if (delta === 0) return 1;
    const baseSum = items
        .flatMap((it) => it.modifiers ?? [])
        .filter((m) => m.statName === "weaponFireRate")
        .reduce((s, m) => s + (m.percentBonus ?? 0), 0);
    return (1 + (baseSum + delta) / 100) / (1 + baseSum / 100);
}

// ─── Burst ────────────────────────────────────────────────────────────────────
function computeBurst(
    opts: SimOptions,
    effects: ItemEffect[],
    heroStats: ComputedStats,
    targetStats: ComputedStats,
    effectiveDpb: number,
    falloffMultiplier: number,
    abilities: AbilityRow[],
    disabled: Set<number>,
    critScale: number
): BurstResult {
    const { shots, headshots } = opts;
    const bulletRes = 1 - (targetStats.bulletResist ?? 0) / 100;
    const spiritRes = 1 - (targetStats.spiritResist ?? 0) / 100;

    // Instant ability hits go straight into burst. DoT abilities contribute a short
    // 0.5s "tag" slice to burst, and also report their per-second + full-duration totals.
    const DOT_BURST_WINDOW = 0.5;
    let abilityDamage = 0;
    let dotPerSec = 0;
    let dotFull = 0;
    for (const r of abilities) {
        if (disabled.has(r.id)) continue;
        abilityDamage += r.burstDamage;
        dotPerSec += r.dotPerSec;
        dotFull += r.dotFull;
    }
    const dotBurst = dotPerSec * DOT_BURST_WINDOW;

    const hs = Math.min(headshots, shots);
    const headshotFlat = effects
        .filter((e) => e.condition === "headshot" && e.damageType === "weapon")
        .reduce((s, e) => s + e.value, 0);
    // Headshots are crits — the target's crit_damage_received_scale reduces the bonus (e.g. Seven 0.45).
    const headshotExtraPer = headshotFlat * falloffMultiplier * bulletRes * critScale;
    const weaponDamage = (shots - hs) * effectiveDpb + hs * (effectiveDpb + headshotExtraPer);

    const fireRate = heroStats.weaponFireRate ?? 0;
    const burstDuration = fireRate > 0 ? shots / fireRate : 0;
    const spirit = heroStats.spiritPower ?? 0;
    const procs: BurstResult["procs"] = [];
    let procDamage = 0;
    for (const e of effects.filter((e) => e.kind === "onHitProc")) {
        const c = e.procCooldown ?? 1;
        const count = c <= 0 ? shots : Math.max(1, Math.min(shots, Math.floor(burstDuration / c) + 1));
        const per =
            e.valueType === "percentOfShot"
                ? effectiveDpb * (e.value / 100)
                : e.damageType === "spirit"
                    ? (e.value + spirit * (e.spiritScale ?? 0)) * spiritRes
                    : e.value * bulletRes;
        const dmg = count * per;
        procDamage += dmg;
        procs.push({ name: e.itemName, count, dmg });
    }

    return {
        abilityDamage,
        weaponDamage,
        headshotExtra: hs * headshotExtraPer,
        procDamage,
        procs,
        dotBurst,
        dotPerSec,
        dotFull,
        total: abilityDamage + weaponDamage + procDamage + dotBurst,
    };
}

// ─── The single entry point ───────────────────────────────────────────────────
export function simulate(build: Build, target: Target, opts: SimOptions): SimResult {
    const { hero, items } = build;
    const effects = items.flatMap((it) => parseEffects(it.effects));
    const disabled = new Set(opts.disabledAbilityIds ?? []);

    const soulsSpent = items.reduce((sum, it) => sum + (it.soulCost ?? 0), 0);
    const level = levelFromSouls(soulsSpent);
    const nextLevelSouls = level < SOULS_LEVEL_TABLE.length ? SOULS_LEVEL_TABLE[level] : null;
    const levelProgressPct =
        nextLevelSouls != null
            ? Math.round(Math.min(100, ((soulsSpent - soulsForLevel(level)) / (nextLevelSouls - soulsForLevel(level))) * 100))
            : 100;

    const inv = investmentFor(items);
    // Stacking items (Berserker/Glass Cannon): fold `stacks × per-stack` into the stat
    // sums as synthetic modifiers. Stacks are per item (item id → count), defaulting to the
    // item's own max when unset. Spirit power is a flat add; weapon damage / fire rate are %.
    const stackMods: StatModifier[] = items.flatMap((it) =>
        parseEffects(it.effects)
            .filter((e) => e.kind === "stacking" && e.stat)
            .map((e) => {
                const max = e.maxStacks ?? 0;
                const n = Math.min(opts.stacksByItem?.[it.id] ?? max, max);
                const amt = n * e.value;
                const flat = FLAT_STACK_STATS.has(e.stat as string);
                return { statName: e.stat as string, flatBonus: flat ? amt : 0, percentBonus: flat ? 0 : amt };
            })
    );
    // Active items' on-cast self-buffs apply only while "Actives firing" is on.
    const activeBuffMods: StatModifier[] = (opts.activesFiring ? effects.filter((e) => e.kind === "activeBuff" && e.stat) : [])
        .map((e) => {
            const flat = FLAT_STACK_STATS.has(e.stat as string);
            return { statName: e.stat as string, flatBonus: flat ? e.value : 0, percentBonus: flat ? 0 : e.value };
        });
    const heroStats = calculateStats(applyLevel(hero, level), [...items, { modifiers: inv.mods }, { modifiers: stackMods }, { modifiers: activeBuffMods }]);

    // Target builds its own loadout: its souls drive its level, and its items +
    // investment bonuses feed health/resists into every mitigation step below.
    const targetItems = target.items ?? [];
    const targetSoulsSpent = targetItems.reduce((sum, it) => sum + (it.soulCost ?? 0), 0);
    // "Match level" pins the target to the attacker's level without granting items.
    const targetLevel = target.matchAttackerLevel ? level : levelFromSouls(targetSoulsSpent);
    const targetInv = investmentFor(targetItems);
    const targetStats = calculateStats(applyLevel(target.hero, targetLevel), [...targetItems, { modifiers: targetInv.mods }]);

    // ── Combat-scenario conditionals ──────────────────────────────────────────
    // Activated fire-rate tier (Burst Fire) kicks in while hitting an enemy hero.
    if (opts.hittingEnemy) {
        heroStats.weaponFireRate = (heroStats.weaponFireRate ?? 0) * conditionalFireRateMult(items, effects);
    }
    // The attacker's resist-reduction items lower the target's resists. Resist can go
    // negative (damage amplification), which the mitigation factors handle naturally.
    if (opts.resistDebuffs) {
        const reduce = (dt: "weapon" | "spirit") =>
            effects.filter((e) => e.kind === "targetResistReduction" && e.damageType === dt).reduce((s, e) => s + e.value, 0);
        const rb = reduce("weapon");
        const rs = reduce("spirit");
        if (rb) targetStats.bulletResist = (targetStats.bulletResist ?? 0) - rb;
        if (rs) targetStats.spiritResist = (targetStats.spiritResist ?? 0) - rs;
    }

    const combat = calculateWeaponHit(heroStats, hero, targetStats, opts.range);
    const cwm = conditionalWeaponMult(items, effects, opts.range, inv.weaponPct);
    const damagePerShot = combat.damagePerBullet * cwm;

    const bulletResFactor = 1 - (targetStats.bulletResist ?? 0) / 100;
    const spiritResFactor = 1 - (targetStats.spiritResist ?? 0) / 100;

    // On-hit procs sustained over time: a proc fires every `procCooldown` seconds
    // (0 = every shot), capped at the weapon's fire rate. Folded into sustained DPS.
    const fireRate = heroStats.weaponFireRate ?? 0;
    const spiritPower = heroStats.spiritPower ?? 0;
    let procDps = 0;
    for (const e of effects.filter((e) => e.kind === "onHitProc")) {
        const per =
            e.valueType === "percentOfShot"
                ? damagePerShot * (e.value / 100)
                : e.damageType === "spirit"
                    ? (e.value + spiritPower * (e.spiritScale ?? 0)) * spiritResFactor
                    : e.value * bulletResFactor;
        const c = e.procCooldown ?? 1;
        const rate = c <= 0 ? fireRate : Math.min(1 / c, fireRate || 1 / c);
        procDps += per * rate;
    }
    // Accuracy scales sustained output — over a long fight, misses don't damage or proc.
    // (Burst is left as the ideal combo window; accuracy is a sustained-fight concept.)
    const accuracy = Math.max(0, Math.min(100, opts.accuracy ?? 100)) / 100;
    const sustainedDps = (combat.dps * cwm + procDps) * accuracy;

    // Melee damage: base × per-level growth (heavy grows at light's fractional rate —
    // validated vs known values, e.g. Bebop heavy +2.91/boon = 1.58 × 116/63), then
    // melee-damage items + 50% of your bonus weapon damage, mitigated by the target's
    // dedicated melee-resist channel (its own armour, not bullet armour). Surfaced
    // separately, not in burst.
    const lightMeleeBase = hero.lightMeleeDamage ?? 0;
    const meleeGrowth = lightMeleeBase > 0 ? 1 + Math.max(0, level - 1) * ((hero.meleePerLevel ?? 0) / lightMeleeBase) : 1;
    const sumPct = (list: ItemData[], stat: string) =>
        list.flatMap((it) => it.modifiers ?? []).filter((m) => m.statName === stat).reduce((s, m) => s + (m.percentBonus ?? 0), 0);
    const weaponPctSum = inv.weaponPct + sumPct(items, "bulletDamage");
    const meleeMult = 1 + (sumPct(items, "meleeDamage") + 0.5 * weaponPctSum) / 100;
    const meleeResistFactor = 1 - sumPct(targetItems, "meleeResist") / 100;
    const melee = {
        light: lightMeleeBase * meleeGrowth * meleeMult * meleeResistFactor,
        heavy: (hero.heavyMeleeDamage ?? 0) * meleeGrowth * meleeMult * meleeResistFactor,
    };

    const theirEhp = targetStats.maxHealth / Math.max(1 - (targetStats.bulletResist ?? 0) / 100, 0.05);
    const timeToKill = sustainedDps > 0 ? targetStats.maxHealth / sustainedDps : null;

    const abilities = buildAbilityRows(hero.abilities ?? [], heroStats, targetStats);
    const burst = computeBurst(
        opts,
        effects,
        heroStats,
        targetStats,
        damagePerShot,
        combat.falloffMultiplier,
        abilities,
        disabled,
        target.hero.critDamageReceivedScale ?? 1
    );

    return {
        soulsSpent,
        level,
        nextLevelSouls,
        levelProgressPct,
        targetSoulsSpent,
        targetLevel,
        investment: { weaponPct: inv.weaponPct, healthPct: inv.healthPct, spiritFlat: inv.spiritFlat },
        heroStats,
        targetStats,
        range: opts.range,
        sustainedDps,
        procDps,
        damagePerShot,
        timeToKill,
        theirEhp,
        melee,
        abilities,
        burst,
    };
}
