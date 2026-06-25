/**
 * Public API of the simulation engine.
 *
 * UI should import from here: `import { simulate, parseEffects } from "@/lib/sim"`.
 * The engine is pure TypeScript with no React or database dependencies.
 */
export { simulate, parseEffects, calculateStats, calculateAbilityDamage, applyLevel } from "./engine";
export {
    SOULS_LEVEL_TABLE,
    MAX_LEVEL,
    MAX_SOULS,
    INVESTMENT_BONUS,
    STAT_DEFINITIONS,
    levelFromSouls,
    soulsForLevel,
    investmentBonus,
} from "./tables";
export type {
    Build,
    Target,
    SimOptions,
    SimResult,
    AbilityRow,
    BurstResult,
    BurstProc,
    ItemEffect,
    ItemData,
    HeroData,
    HeroWithAbilities,
    AbilityData,
    ComputedStats,
    StatModifier,
    DamageType,
} from "./types";
export type { StatDefinition } from "./tables";
