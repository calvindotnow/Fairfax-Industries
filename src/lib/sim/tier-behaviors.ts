/**
 * Curated tier-behavior overrides.
 *
 * Some ability rank upgrades add a *mechanic* rather than a number the API exposes as a property
 * delta — e.g. an ability that strikes twice at max rank. The rank system already applies every
 * numeric tier upgrade (damage / range / duration / charges / cooldown); this table captures the
 * non-numeric ones the data can't describe, as a small, explicit, per-patch-auditable override.
 *
 * ACCURACY DISCIPLINE: only add an entry you have verified against deadlock.wiki AND the API's
 * tier upgrade data for the current patch. When they disagree, do not encode it. This table must
 * never fabricate a mechanic — an empty table is correct until a real behavior is confirmed.
 *
 * The table is intentionally tiny. Match on hero name + an ability-name test (abilities are named,
 * ids churn across syncs) + a rank threshold. `damageMult` multiplies the ability's computed damage
 * (direct hit and DoT alike) once the trained rank reaches the threshold. The shape leaves room for
 * future behavior kinds (add fields to `TierBehavior` and handle them where the table is applied).
 */

/** A behavior a rank threshold unlocks. Start with a flat damage multiplier (a second strike ⇒ 2×);
 *  extend this interface for future non-numeric mechanics (e.g. added targets, conditional bonuses). */
export interface TierBehavior {
    /** Multiplies the ability's computed damage once `rank >= minRank` (e.g. 2 for a double strike). */
    damageMult?: number;
    /** Human-readable note for tooltips / audits — what the mechanic is and where it was verified. */
    note?: string;
}

/** One curated override: (hero, ability, rank threshold) → behavior. */
export interface TierBehaviorEntry {
    hero: string;
    /** Case-insensitive test against the ability's display name. */
    abilityNameTest: RegExp;
    /** The trained rank (0–3) at or above which the behavior applies. */
    minRank: number;
    behavior: TierBehavior;
}

/**
 * The curated table. **Currently empty by design** — the canonical candidate, Shiv's "Slice and
 * Dice hits twice", was checked against deadlock.wiki and the API's tier data (2026-07-04) and does
 * NOT double at max rank: its Tier 3 is "+50 Impact Damage / cooldown-reduction-on-hit", and the
 * echo/second strike is a Rage (ultimate-unlock) mechanic, not a rank threshold. Encoding a ×2 here
 * would fabricate a behavior the current patch doesn't have. Add verified entries as patches
 * introduce (or reveal) genuine rank-threshold mechanics.
 */
export const TIER_BEHAVIORS: TierBehaviorEntry[] = [];

/**
 * Resolve the tier behavior for an ability at a trained rank, if the curated table has a matching
 * entry whose threshold is met. Returns `null` when nothing applies (the common case).
 */
export function tierBehaviorFor(
    heroName: string,
    abilityName: string,
    rank: number,
    table: TierBehaviorEntry[] = TIER_BEHAVIORS
): TierBehavior | null {
    for (const e of table) {
        if (e.hero === heroName && e.abilityNameTest.test(abilityName) && rank >= e.minRank) {
            return e.behavior;
        }
    }
    return null;
}
