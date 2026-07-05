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
    AbilityExecute,
    AbilityRow,
    AbilityScaling,
    AbilityScalingInfo,
    AbilityUpgrades,
    Build,
    BurstResult,
    ComputedStats,
    HeroData,
    ItemData,
    ItemEffect,
    OnHitProcEffect,
    ActiveDamageEffect,
    ActiveBuffEffect,
    StackingEffect,
    ConditionalWeaponPctEffect,
    ConditionalFireRateEffect,
    TargetResistReductionEffect,
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
import { TIER_BEHAVIORS, tierBehaviorFor, type TierBehaviorEntry } from "./tier-behaviors";

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

/**
 * Resolve an ability's execute / assassinate threshold — the enemy-HP-% marker some
 * abilities carry (e.g. a finisher that kills below 8% HP, or a bonus-damage window
 * below 30%). Parsed from the ability's `properties` JSON (`executePct`/`executeKind`),
 * this is distinct from Spirit scaling, so it lives in its own accessor rather than
 * riding `deriveAbilityScaling`. Returns `null` when the ability has no execute.
 */
export function abilityExecute(a: Pick<AbilityData, "properties">): AbilityExecute | null {
    let flags: AbilityScaling = {};
    if (a.properties) {
        try {
            flags = JSON.parse(a.properties) as AbilityScaling;
        } catch { /* malformed — ignore */ }
    }
    if (flags.executePct == null) return null;
    return { pct: flags.executePct, kind: flags.executeKind ?? "bonus" };
}

/**
 * An ability's %-of-health damage rider, parsed from its `properties` JSON (`healthScaling`).
 * Returns the descriptor, or `null` when the ability has none. Following the display convention
 * (compute at the target's FULL health), the caller adds `pct`% of the target's max health for a
 * "current"-health scaler, or 0 for a "missing"-health scaler (nothing is missing at full HP).
 */
export function abilityHealthScaling(
    a: Pick<AbilityData, "properties">
): { kind: "current" | "missing"; pct: number } | null {
    let flags: AbilityScaling = {};
    if (a.properties) {
        try { flags = JSON.parse(a.properties) as AbilityScaling; } catch { /* malformed — ignore */ }
    }
    const hs = flags.healthScaling;
    if (!hs || !hs.pct) return null;
    return { kind: hs.kind, pct: hs.pct };
}

/** The extra flat damage a health-scaling ability deals against `targetMaxHealth`, evaluated at
 *  the target's FULL health: pct% of max for "current"; 0 for "missing" (nothing missing at full).
 *  Returned pre-mitigation — the caller applies the ability's own resist/amp channel. */
function healthScaledAdd(a: AbilityData, targetMaxHealth: number): number {
    const hs = abilityHealthScaling(a);
    if (!hs) return 0;
    // "current" at full HP = pct% of max; "missing" at full HP = 0 (no missing health).
    return hs.kind === "current" ? (hs.pct / 100) * targetMaxHealth : 0;
}

/** Resolve an ability's effective stats at a trained rank from its precomputed rank
 *  profile (`upgrades` JSON), falling back to the base columns when no profile exists. */
function resolveRank(a: AbilityData, requested: number) {
    let parsed: AbilityUpgrades | null = null;
    if (a.upgrades) {
        try { parsed = JSON.parse(a.upgrades); } catch { /* malformed — fall back to base */ }
    }
    const maxRank = parsed ? parsed.ranks.length - 1 : 0;
    const rank = Math.max(0, Math.min(Math.floor(requested) || 0, maxRank));
    const snap = parsed?.ranks?.[rank];
    const eff = snap ?? {
        damage: a.baseDamage ?? 0, scale: a.spiritScaling ?? 0, dotDps: a.dotDps ?? 0,
        dotDuration: a.dotDuration ?? 0, range: a.range ?? null, duration: a.duration ?? null,
        charges: a.charges ?? null, cooldown: a.cooldown ?? null,
    };
    return { eff, rank, maxRank, tiers: parsed?.tiers ?? [] };
}

/** Imbue recompute applied to a single ability: extra Spirit Power for its damage coefficient
 *  and a % duration extension. Keyed by ability id in `simulate`. */
type ImbueForAbility = { spiritPower: number; durationPct: number };

function buildAbilityRows(
    abilities: AbilityData[],
    heroStats: ComputedStats,
    targetStats: ComputedStats,
    ranks: Record<number, number> = {},
    spiritAmpMult = 1,
    imbueByAbility: Map<number, ImbueForAbility> = new Map(),
    heroName = "",
    tierBehaviors: TierBehaviorEntry[] = TIER_BEHAVIORS
): AbilityRow[] {
    const baseSpirit = heroStats.spiritPower ?? 0;
    return abilities.map((a) => {
        // The imbue item grants extra Spirit Power to THIS ability only (Surge of Power, Frostbite
        // Charm) and can extend its duration; both apply solely to the assigned ability.
        const imb = imbueByAbility.get(a.id);
        const spirit = baseSpirit + (imb?.spiritPower ?? 0);
        const durationMult = 1 + (imb?.durationPct ?? 0) / 100;
        const type = abilityDamageType(a);
        // Spirit abilities take the target's per-stack Spirit Amp (Escalating Exposure) on top of
        // spirit-resist mitigation — a target-takes-more-damage multiplier, not a Spirit-Power add.
        const res =
            type === "spirit"
                ? (1 - (targetStats.spiritResist ?? 0) / 100) * spiritAmpMult
                : 1 - (targetStats.bulletResist ?? 0) / 100;
        const { eff, rank, maxRank, tiers } = resolveRank(a, ranks[a.id] ?? 0);
        // Curated non-numeric rank mechanic (e.g. a second strike ⇒ ×2 damage) once the trained
        // rank meets its threshold. Empty by default — see tier-behaviors.ts.
        const tierMult = tierBehaviorFor(heroName, a.name, rank, tierBehaviors)?.damageMult ?? 1;
        const isDot = eff.dotDps > 0;
        const { rangeScalesWithSpirit, durationScalesWithSpirit } = deriveAbilityScaling(a);
        // The damage coefficient grows with rank, so read it from the resolved snapshot.
        const damageScalePerSpirit = eff.scale;
        const scalesWithSpirit = damageScalePerSpirit > 0 || rangeScalesWithSpirit || durationScalesWithSpirit;
        const base = {
            id: a.id,
            name: a.name,
            type: a.type,
            imageUrl: a.imageUrl,
            cooldown: eff.cooldown,
            range: eff.range,
            // Imbue duration extension (Duration Extender / ImbuedBonusDuration) lengthens this
            // ability's displayed duration; 1× when unassigned.
            duration: eff.duration != null ? eff.duration * durationMult : eff.duration,
            charges: eff.charges,
            chargeCooldown: a.chargeCooldown,
            damageType: type,
            isUltimate: a.type === "ultimate",
            isDot,
            scalesWithSpirit,
            damageScalePerSpirit,
            rank,
            maxRank,
            tiers,
        };
        if (isDot) {
            // Channeled/burn DoT — a per-second rate, not an instant-burst hit. The imbued Spirit
            // Power lifts the per-second rate (via `spirit`); the imbued duration extension
            // lengthens how long it ticks (dotFull), leaving the rate unchanged.
            const perSec = (eff.dotDps + spirit * eff.scale) * res * tierMult;
            const dotFull = perSec * ((eff.dotDuration ?? 0) * durationMult);
            return {
                ...base,
                display: type === "utility" ? "—" : `${Math.round(perSec).toLocaleString()}/s`,
                burstDamage: 0,
                dotPerSec: type === "utility" ? 0 : perSec,
                dotFull: type === "utility" ? 0 : dotFull,
            };
        }
        // Imbued Spirit Power raises the coefficient term for THIS ability only, so feed a
        // spirit-boosted stat view into the damage calc (unchanged when unassigned).
        const attackerStatsForAbility = imb?.spiritPower ? { ...heroStats, spiritPower: spirit } : heroStats;
        const totalRaw = calculateAbilityDamage(
            { baseDamage: eff.damage, spiritScaling: eff.scale, dotDps: eff.dotDps, dotDuration: eff.dotDuration },
            attackerStatsForAbility,
            targetStats
        ).mitigatedDamage;
        // Spirit direct hits take the target Spirit Amp too (weapon abilities are unaffected).
        const totalBase = type === "spirit" ? totalRaw * spiritAmpMult : totalRaw;
        // %-of-health rider (Vyper Lethal Venom, current-health scalers): pct% of the target's max
        // health at FULL health, mitigated through this ability's own resist/amp channel (`res`).
        // The curated tier multiplier (×2 second strike) scales the whole hit, health rider included.
        const total = (totalBase + healthScaledAdd(a, targetStats.maxHealth ?? 0) * res) * tierMult;
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
/** Sum of percent bonuses to a stat across a set of items (additive % stacking). */
export function sumPercentModifiers(items: { modifiers?: StatModifier[] }[], stat: string): number {
    return items.flatMap((it) => it.modifiers ?? []).filter((m) => m.statName === stat).reduce((s, m) => s + (m.percentBonus ?? 0), 0);
}

function conditionalWeaponMult(
    items: ItemData[],
    effects: ItemEffect[],
    range: number,
    investmentWeaponPct: number
): number {
    const sumItemWeaponPct = investmentWeaponPct + sumPercentModifiers(items, "bulletDamage");
    const condPct = effects
        .filter((e): e is ConditionalWeaponPctEffect => e.kind === "conditionalWeaponPct")
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

// Base headshot/crit multiplier — uniform 1.65× across all weapons in the current patch
// (every hero's weapon crit_bonus_start = 1.65). A headshot multiplies the shot by this
// before any flat headshot bonuses (Headshot Booster) are added.
const HEADSHOT_MULT = 1.65;

/**
 * Multiplier that lifts the already-computed fire rate from its baseline tier to
 * its activated tier (Burst Fire: 10% → 32% while hitting an enemy). Fire-rate %
 * stacks additively, so we recover the additive sum and add the activated delta.
 */
function conditionalFireRateMult(items: ItemData[], effects: ItemEffect[]): number {
    const delta = effects
        .filter((e): e is ConditionalFireRateEffect => e.kind === "conditionalFireRate")
        .reduce((s, e) => s + (e.value - (e.baseValue ?? 0)), 0);
    if (delta === 0) return 1;
    const baseSum = sumPercentModifiers(items, "weaponFireRate");
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
    critScale: number,
    spiritAmpMult = 1
): BurstResult {
    const { shots, headshots } = opts;
    const bulletRes = 1 - (targetStats.bulletResist ?? 0) / 100;
    // Spirit mitigation includes the target's stacking Spirit Amp (Escalating Exposure) — a
    // target-takes-more-damage multiplier folded into every spirit-typed proc/active below.
    const spiritRes = (1 - (targetStats.spiritResist ?? 0) / 100) * spiritAmpMult;

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
        .filter((e) => e.kind === "onHitFlat" && e.condition === "headshot" && e.damageType === "weapon")
        .reduce((s, e) => s + e.value, 0);
    // A headshot does the base 1.65× weapon multiplier (inherent to all weapons), plus any
    // flat headshot bonuses (Headshot Booster). The bonus over a body shot is therefore
    // 0.65 × the shot + the flat add. Both are "crit" damage, so the target's
    // crit_damage_received_scale reduces them (e.g. Seven 0.45).
    const baseCritBonusPer = effectiveDpb * (HEADSHOT_MULT - 1); // effectiveDpb is already falloff+resist-mitigated
    const headshotExtraPer = (baseCritBonusPer + headshotFlat * falloffMultiplier * bulletRes) * critScale;
    const weaponDamage = (shots - hs) * effectiveDpb + hs * (effectiveDpb + headshotExtraPer);

    const fireRate = heroStats.weaponFireRate ?? 0;
    const burstDuration = fireRate > 0 ? shots / fireRate : 0;
    const spirit = heroStats.spiritPower ?? 0;
    const procs: BurstResult["procs"] = [];
    let procDamage = 0;
    for (const e of effects.filter((e): e is OnHitProcEffect => e.kind === "onHitProc")) {
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

    // Active items' own on-cast damage (Arctic Blast, Cold Front, …) lands once in the combo
    // while "Actives firing" is on, unless the player toggled that specific active out of the
    // burst (excludedActiveItemIds); passive charge-up procs (Tankbuster) are `alwaysOn` and
    // ignore both the gate and the exclusion.
    const excludedActives = new Set(opts.excludedActiveItemIds ?? []);
    for (const e of effects.filter((e): e is ActiveDamageEffect => e.kind === "activeDamage"
        && !!(e.alwaysOn || (opts.activesFiring && !(e.itemId != null && excludedActives.has(e.itemId)))))) {
        const raw = e.value + spirit * (e.spiritScale ?? 0) + (targetStats.maxHealth ?? 0) * ((e.healthPctDamage ?? 0) / 100);
        const res = e.ignoreResist ? 1 : e.damageType === "spirit" ? spiritRes : bulletRes;
        const dmg = raw * res;
        procDamage += dmg;
        procs.push({ name: e.itemName, count: 1, dmg });
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
    // Parse each item's effects once, keeping the item association (stacking needs the
    // item id for per-item stack counts); `effects` is the flattened view for everything else.
    const itemEffects = items.map((it) => ({ it, effects: parseEffects(it.effects) }));
    // Flattened view, each effect tagged with its source item id so burst inclusion can be
    // refined per item (excludedActiveItemIds — which actives the player pressed this combo).
    const effects: ItemEffect[] = itemEffects.flatMap((x) => x.effects.map((e) => ({ ...e, itemId: x.it.id })));
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
    // `spiritAmp` (Escalating Exposure) and `heal` (Restorative Locket) are stacking effects that
    // are NOT computed stats — the amp is a target-side spirit-damage multiplier and heal is pure
    // sustain — so they're handled separately below and excluded from the stat-modifier fold here.
    const stacksFor = (it: ItemData, e: StackingEffect) => {
        const max = e.maxStacks ?? 0;
        return Math.min(opts.stacksByItem?.[it.id] ?? max, max);
    };
    const NON_STAT_STACKS = new Set(["spiritAmp", "heal"]);
    const stackMods: StatModifier[] = itemEffects.flatMap(({ it, effects: effs }) =>
        effs
            .filter((e): e is StackingEffect => e.kind === "stacking")
            .flatMap((e) => {
                const stat = e.stat;
                if (!stat || NON_STAT_STACKS.has(stat)) return [];
                const amt = stacksFor(it, e) * e.value;
                const flat = FLAT_STACK_STATS.has(stat);
                return [{ statName: stat, flatBonus: flat ? amt : 0, percentBonus: flat ? 0 : amt }];
            })
    );
    // Escalating Exposure: each stack adds `value`% Spirit Amp to the target → the target takes
    // more spirit damage. Amps stack additively across such items/stacks. 1 = no amp.
    const spiritAmpMult = 1 + itemEffects.reduce((sum, { it, effects: effs }) =>
        sum + effs
            .filter((e): e is StackingEffect => e.kind === "stacking" && e.stat === "spiritAmp")
            .reduce((s, e) => s + stacksFor(it, e) * e.value, 0), 0) / 100;
    // Restorative Locket: heal-per-stack sustain (no damage). Summed as a readout only.
    const healSustain = itemEffects.reduce((sum, { it, effects: effs }) =>
        sum + effs
            .filter((e): e is StackingEffect => e.kind === "stacking" && e.stat === "heal")
            .reduce((s, e) => s + stacksFor(it, e) * e.value, 0), 0);
    // Active items' on-cast self-buffs apply only while "Actives firing" is on.
    const activeBuffMods: StatModifier[] = (opts.activesFiring
        ? effects.filter((e): e is ActiveBuffEffect => e.kind === "activeBuff" && !!e.stat)
        : []
    ).map((e) => {
        const flat = FLAT_STACK_STATS.has(e.stat);
        return { statName: e.stat, flatBonus: flat ? e.value : 0, percentBonus: flat ? 0 : e.value };
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
            effects
                .filter((e): e is TargetResistReductionEffect => e.kind === "targetResistReduction" && e.damageType === dt)
                .reduce((s, e) => s + e.value, 0);
        const rb = reduce("weapon");
        const rs = reduce("spirit");
        if (rb) targetStats.bulletResist = (targetStats.bulletResist ?? 0) - rb;
        if (rs) targetStats.spiritResist = (targetStats.spiritResist ?? 0) - rs;
    }

    const combat = calculateWeaponHit(heroStats, hero, targetStats, opts.range);
    const cwm = conditionalWeaponMult(items, effects, opts.range, inv.weaponPct);
    const damagePerShot = combat.damagePerBullet * cwm;

    const bulletResFactor = 1 - (targetStats.bulletResist ?? 0) / 100;
    // Spirit mitigation folds in the target's Spirit Amp (Escalating Exposure) so every spirit
    // number — sustained procs, the Spirit panel — takes the same target-takes-more multiplier.
    const spiritResFactor = (1 - (targetStats.spiritResist ?? 0) / 100) * spiritAmpMult;

    // On-hit procs sustained over time: a proc fires every `procCooldown` seconds
    // (0 = every shot), capped at the weapon's fire rate. Folded into sustained DPS.
    const fireRate = heroStats.weaponFireRate ?? 0;
    const spiritPower = heroStats.spiritPower ?? 0;
    let procDps = 0;
    for (const e of effects.filter((e): e is OnHitProcEffect => e.kind === "onHitProc")) {
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
    // Sustained-fight headshots: a fraction of landed shots hit the head, adding the base
    // 1.65× crit bonus (+ flat headshot items), scaled by the target's crit resistance.
    const hsFrac = Math.max(0, Math.min(100, opts.headshotPct ?? 0)) / 100;
    const flatHeadshot = effects
        .filter((e) => e.kind === "onHitFlat" && e.condition === "headshot" && e.damageType === "weapon")
        .reduce((s, e) => s + e.value, 0);
    const critScale = target.hero.critDamageReceivedScale ?? 1;
    const hsBonusPerShot = (damagePerShot * (HEADSHOT_MULT - 1) + flatHeadshot * combat.falloffMultiplier * bulletResFactor) * critScale;
    // Accuracy scales sustained output — over a long fight, misses don't damage or proc.
    // (Burst is left as the ideal combo window; accuracy is a sustained-fight concept.)
    const accuracy = Math.max(0, Math.min(100, opts.accuracy ?? 100)) / 100;
    const sustainedDps = (combat.dps * cwm + procDps + hsFrac * hsBonusPerShot * fireRate) * accuracy;

    // Melee damage: base × per-level growth (heavy grows at light's fractional rate —
    // validated vs known values, e.g. Bebop heavy +2.91/boon = 1.58 × 116/63), then
    // melee-damage items + 50% of your bonus weapon damage, mitigated by the target's
    // dedicated melee-resist channel (its own armour, not bullet armour). Surfaced
    // separately, not in burst.
    const lightMeleeBase = hero.lightMeleeDamage ?? 0;
    const meleeGrowth = lightMeleeBase > 0 ? 1 + Math.max(0, level - 1) * ((hero.meleePerLevel ?? 0) / lightMeleeBase) : 1;
    const weaponPctSum = inv.weaponPct + sumPercentModifiers(items, "bulletDamage");
    const meleeMult = 1 + (sumPercentModifiers(items, "meleeDamage") + 0.5 * weaponPctSum) / 100;
    const meleeResistFactor = 1 - sumPercentModifiers(targetItems, "meleeResist") / 100;
    const melee = {
        light: lightMeleeBase * meleeGrowth * meleeMult * meleeResistFactor,
        heavy: (hero.heavyMeleeDamage ?? 0) * meleeGrowth * meleeMult * meleeResistFactor,
    };

    const theirEhp = targetStats.maxHealth / Math.max(1 - (targetStats.bulletResist ?? 0) / 100, 0.05);
    const timeToKill = sustainedDps > 0 ? targetStats.maxHealth / sustainedDps : null;

    // Spirit-scaling item damage for the Spirit panel: active-item on-cast damage and
    // on-hit spirit procs (Mystic Shot). Listed regardless of the scenario toggles — it's
    // a build property — at the current Spirit, mitigated by the target's spirit resist.
    const spiritItemDamage = effects
        .filter((e): e is ActiveDamageEffect | OnHitProcEffect =>
            (e.kind === "activeDamage" || e.kind === "onHitProc") && e.damageType === "spirit")
        .map((e) => {
            const healthPctDamage = e.kind === "activeDamage" ? e.healthPctDamage ?? 0 : 0;
            const ignoreResist = e.kind === "activeDamage" ? e.ignoreResist : false;
            const raw = e.value + spiritPower * (e.spiritScale ?? 0) + (targetStats.maxHealth ?? 0) * (healthPctDamage / 100);
            return {
                name: (e.itemName ?? "").split(":")[0],
                value: raw * (ignoreResist ? 1 : spiritResFactor),
                perProc: e.kind === "onHitProc",
            };
        });

    // Imbue recompute: map each assigned ability id → the imbue item's magnitude (Spirit Power +
    // duration %). `opts.imbueAssign` is imbue item id → ability id; the magnitude comes from that
    // item's ImbueEffect. Applied to the assigned ability only inside buildAbilityRows.
    const imbueByAbility = new Map<number, ImbueForAbility>();
    if (opts.imbueAssign) {
        for (const { it, effects: effs } of itemEffects) {
            const abilityId = opts.imbueAssign[it.id];
            if (abilityId == null) continue;
            for (const e of effs) {
                if (e.kind !== "imbue") continue;
                const prev = imbueByAbility.get(abilityId) ?? { spiritPower: 0, durationPct: 0 };
                imbueByAbility.set(abilityId, {
                    spiritPower: prev.spiritPower + (e.imbuedSpiritPower ?? 0),
                    durationPct: prev.durationPct + (e.imbuedDurationPct ?? 0),
                });
            }
        }
    }

    const abilities = buildAbilityRows(hero.abilities ?? [], heroStats, targetStats, opts.abilityRanks, spiritAmpMult, imbueByAbility, hero.name, opts.tierBehaviorsOverride ?? TIER_BEHAVIORS);
    const burst = computeBurst(
        opts,
        effects,
        heroStats,
        targetStats,
        damagePerShot,
        combat.falloffMultiplier,
        abilities,
        disabled,
        target.hero.critDamageReceivedScale ?? 1,
        spiritAmpMult
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
        spiritItemDamage,
        sustain: { heal: healSustain },
        spiritAmpMult,
    };
}
