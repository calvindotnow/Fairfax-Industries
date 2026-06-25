/**
 * Standalone domain types for the damage-simulation engine.
 *
 * These are intentionally decoupled from the database layer (Drizzle) so the
 * engine is a portable, pure-TypeScript module: it can be lifted into any UI
 * (including a fresh project) without dragging the data layer along. The DB row
 * types are structurally compatible, so DB rows can be passed in directly.
 */

export type DamageType = "weapon" | "spirit";
export type AbilityDamageKind = "spirit" | "weapon" | null;

/** A flat or percent bonus to a single computed stat. */
export interface StatModifier {
    statName: string;
    flatBonus: number;
    percentBonus: number;
}

/** A direct-damage effect an item adds (proc, conditional flat/percent add). */
export interface ItemEffect {
    kind: "onHitProc" | "onHitFlat" | "conditionalWeaponPct";
    damageType?: DamageType;
    value: number;
    valueType?: "flat" | "percentOfShot";
    condition?: "headshot";
    procCooldown?: number; // seconds; 0 = every shot
    rangeMin?: number; // meters
    rangeMax?: number; // meters
    itemName?: string;
}

export interface AbilityData {
    id: number;
    name: string;
    type: string; // "signature" | "ultimate" | ...
    cooldown?: number | null;
    baseDamage?: number | null;
    spiritScaling?: number | null;
    dotDps?: number | null;
    dotDuration?: number | null;
    damageKind?: string | null; // "spirit" | "weapon" | null in practice
    imageUrl?: string | null;
}

export interface HeroData {
    id: number;
    name: string;
    role?: string | null;
    imageUrl?: string | null;
    maxHealth: number;
    healthRegen: number;
    bulletDamage: number;
    weaponFireRate: number;
    bulletResist: number;
    spiritPower: number;
    spiritResist: number;
    moveSpeed: number;
    sprintSpeed: number;
    stamina: number;
    bulletDamagePerLevel?: number;
    healthPerLevel?: number;
    spiritPerLevel?: number;
    bulletResistPerLevel?: number;
    spiritResistPerLevel?: number;
    critDamageReceivedScale?: number; // headshot/crit damage taken multiplier (1 = normal)
    spiritScaling?: string | null; // JSON map of stat -> per-spirit coefficient
    falloffStart: number;
    falloffEnd: number;
}

export interface HeroWithAbilities extends HeroData {
    abilities: AbilityData[];
}

export interface ItemData {
    id: number;
    name: string;
    category: "weapon" | "vitality" | "spirit";
    tier: number;
    soulCost: number;
    imageUrl?: string | null;
    description?: string | null;
    isActive?: boolean;
    effects?: string | null; // JSON array of ItemEffect
    modifiers: StatModifier[];
}

/** Final computed stat values, keyed by stat name. */
export type ComputedStats = Record<string, number>;

// ─── Engine inputs/outputs ────────────────────────────────────────────────────

export interface Build {
    hero: HeroWithAbilities;
    items: ItemData[];
}

export interface Target {
    hero: HeroWithAbilities;
    items?: ItemData[];
    /** When true, the target levels to the attacker's level (no items granted). */
    matchAttackerLevel?: boolean;
}

export interface SimOptions {
    range: number;
    shots: number;
    headshots: number;
    disabledAbilityIds?: number[];
}

export interface AbilityRow {
    id: number;
    name: string;
    type: string;
    imageUrl?: string | null;
    cooldown?: number | null;
    damageType: "weapon" | "spirit" | "utility";
    isUltimate: boolean;
    isDot: boolean;
    /** Display string for the table (e.g. "132" or "95/s" or "—"). */
    display: string;
    /** Contribution to the instant burst (0 for DoT/utility). */
    burstDamage: number;
    /** Mitigated DoT damage per second (0 for non-DoT). */
    dotPerSec: number;
    /** Mitigated DoT damage over the full duration if the enemy sits in it (0 for non-DoT). */
    dotFull: number;
}

export interface BurstProc {
    name?: string;
    count: number;
    dmg: number;
}

export interface BurstResult {
    total: number;
    abilityDamage: number;
    weaponDamage: number;
    headshotExtra: number;
    procDamage: number;
    procs: BurstProc[];
    /** DoT slice folded into the burst total (≈0.5s worth — a realistic tag). */
    dotBurst: number;
    /** Total sustained DoT damage per second across all DoT abilities. */
    dotPerSec: number;
    /** Total DoT damage if the enemy sits in every DoT for its full duration. */
    dotFull: number;
}

export interface SimResult {
    soulsSpent: number;
    level: number;
    nextLevelSouls: number | null;
    levelProgressPct: number;
    targetSoulsSpent: number;
    targetLevel: number;
    investment: { weaponPct: number; healthPct: number; spiritFlat: number };

    heroStats: ComputedStats;
    targetStats: ComputedStats;

    range: number;
    sustainedDps: number;
    damagePerShot: number;
    timeToKill: number | null; // seconds
    theirEhp: number;

    abilities: AbilityRow[];
    burst: BurstResult;
}
