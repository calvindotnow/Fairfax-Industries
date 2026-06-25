/**
 * Game constants and lookups: souls→level progression, investment bonuses,
 * and the stat definitions used when aggregating modifiers.
 * These are the editable "source of truth" numbers from the game / wiki.
 */

// ─── Souls → Level ────────────────────────────────────────────────────────────
// Cumulative soul thresholds to reach each level (global across all heroes).
// Source: deadlock-api hero level_info.required_gold. Max level 36 at 40,000.
export const SOULS_LEVEL_TABLE = [
    0, 300, 600, 900, 1500, 2200, 3000, 3800, 4600, 5400, 6200, 7100, 8000, 9000,
    10000, 11000, 12000, 13200, 14500, 16000, 17500, 19000, 20500, 22000, 23500,
    25000, 26500, 28000, 29500, 31000, 32500, 34000, 35500, 37000, 38500, 40000,
];
export const MAX_LEVEL = SOULS_LEVEL_TABLE.length;
export const MAX_SOULS = SOULS_LEVEL_TABLE[SOULS_LEVEL_TABLE.length - 1];

export function levelFromSouls(souls: number): number {
    let level = 1;
    for (let i = 0; i < SOULS_LEVEL_TABLE.length; i++) {
        if (souls >= SOULS_LEVEL_TABLE[i]) level = i + 1;
        else break;
    }
    return level;
}

export function soulsForLevel(level: number): number {
    const i = Math.max(0, Math.min(SOULS_LEVEL_TABLE.length - 1, level - 1));
    return SOULS_LEVEL_TABLE[i];
}

// ─── Investment bonuses ───────────────────────────────────────────────────────
// Souls spent on items of a category grant a passive bonus to the matching stat,
// scaling with total category spend (stepwise breakpoints, capped at 28,800).
// Source: deadlock.wiki/Items. Weapon→weapon damage %, vitality→health %,
// spirit→spirit power (flat). Applied to base stats first.
// EDITABLE — correct individual values here if the wiki updates.
export const INVESTMENT_BONUS: { souls: number; weapon: number; health: number; spirit: number }[] = [
    { souls: 800, weapon: 9, health: 9, spirit: 7 },
    { souls: 1600, weapon: 12, health: 12, spirit: 11 },
    { souls: 2400, weapon: 15, health: 15, spirit: 15 },
    { souls: 3200, weapon: 18, health: 20, spirit: 19 },
    { souls: 4800, weapon: 46, health: 38, spirit: 38 },
    { souls: 6400, weapon: 54, health: 42, spirit: 45 },
    { souls: 8000, weapon: 62, health: 46, spirit: 52 },
    { souls: 11200, weapon: 74, health: 50, spirit: 59 },
    { souls: 16000, weapon: 86, health: 54, spirit: 66 },
    { souls: 22400, weapon: 100, health: 64, spirit: 75 },
    { souls: 28800, weapon: 115, health: 70, spirit: 100 },
];

/** Investment bonus for a given total souls spent in one category (stepwise). */
export function investmentBonus(soulsInCategory: number): { weapon: number; health: number; spirit: number } {
    let row = { weapon: 0, health: 0, spirit: 0 };
    for (const r of INVESTMENT_BONUS) {
        if (soulsInCategory >= r.souls) row = { weapon: r.weapon, health: r.health, spirit: r.spirit };
        else break;
    }
    return row;
}

// ─── Stat definitions ─────────────────────────────────────────────────────────
// Which stats exist and how their modifiers stack (additive vs asymptotic).
export interface StatDefinition {
    key: string;
    label: string;
    unit: string;
    decimals: number;
    stacking: "additive" | "asymptotic";
}

export const STAT_DEFINITIONS: StatDefinition[] = [
    { key: "maxHealth", label: "Max Health", unit: "", decimals: 0, stacking: "additive" },
    { key: "healthRegen", label: "Health Regen", unit: "/s", decimals: 1, stacking: "additive" },
    { key: "bulletDamage", label: "Weapon Damage", unit: "", decimals: 1, stacking: "additive" },
    { key: "weaponFireRate", label: "Fire Rate", unit: "/s", decimals: 1, stacking: "additive" },
    { key: "bulletResist", label: "Bullet Resist", unit: "%", decimals: 1, stacking: "asymptotic" },
    { key: "spiritPower", label: "Spirit Power", unit: "", decimals: 0, stacking: "additive" },
    { key: "spiritResist", label: "Spirit Resist", unit: "%", decimals: 1, stacking: "asymptotic" },
    { key: "moveSpeed", label: "Move Speed", unit: " m/s", decimals: 1, stacking: "additive" },
    { key: "sprintSpeed", label: "Sprint Speed", unit: " m/s", decimals: 1, stacking: "additive" },
    { key: "stamina", label: "Stamina", unit: "", decimals: 0, stacking: "additive" },
];
