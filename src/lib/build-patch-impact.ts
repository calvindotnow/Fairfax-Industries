/**
 * Build-scoped patch impact (Track F1) — "how did the latest patch move MY build?".
 *
 * DESIGN — Variant B (targeted deltas), not a re-sim. The two baked stat snapshots
 * (see `src/lib/baked-data.json` → `snapshots`) carry only a thin slice of the game
 * data: per hero `{maxHealth, bulletDamage, weaponFireRate, bulletResist, spiritResist}`
 * and per item `{soulCost, <flat statName → value>}`. They contain NO abilities, no item
 * `effects`, no per-level growth, and no ability upgrade profiles — the very inputs the
 * pure engine (`src/lib/sim`) needs to construct `HeroWithAbilities` / `ItemData` and run
 * `simulate()` against the previous patch. A faithful re-sim of the previous snapshot is
 * therefore impossible from this data, so we do NOT fabricate output deltas (burst %, TTK).
 *
 * Instead we intersect the build's own hero + target + items against the change list that
 * `patch-diff` already computes, and report exactly which of THIS build's inputs changed,
 * with old→new values and which side (attacker / target / their item) they sit on. The UI
 * frames this honestly as "these inputs to your build changed" — real numbers, no invented
 * output. If the two snapshots ever grow to carry the full engine inputs, this can be
 * upgraded to Variant A (re-sim) without touching the surface's contract.
 */
import { diffSnapshots, type SnapshotPayload, type StatChange } from "./patch-diff";

/** The identity of a build, by entity NAME (the snapshot's key). Names come from the
 *  decoded share code resolved against the current pool. */
export interface BuildEntities {
    heroName: string | null;
    targetName: string | null;
    itemNames: string[]; // attacker's equipped items
    targetItemNames: string[]; // target's equipped items
}

/** Which side of the build an affected entity sits on. */
export type BuildRole = "attacker" | "target" | "attackerItem" | "targetItem";

export interface AffectedEntity {
    kind: "hero" | "item";
    role: BuildRole;
    name: string;
    changes: StatChange[];
}

export interface BuildPatchImpact {
    /** Every one of the build's own entities that the patch touched, tagged by role.
     *  Same entity can appear twice under different roles (e.g. an item on both sides). */
    affected: AffectedEntity[];
    /** Total number of individual stat changes across all affected entities (headline). */
    totalStatChanges: number;
    /** True when the patch didn't touch any input to this build — surfaced positively. */
    unaffected: boolean;
}

const HERO_ROLES: Array<{ role: BuildRole; getName: (b: BuildEntities) => string | null }> = [
    { role: "attacker", getName: (b) => b.heroName },
    { role: "target", getName: (b) => b.targetName },
];

/**
 * Intersect a build's entities with the patch diff of two snapshots. Pure — no DB, no
 * React, fully testable against the real snapshot shapes.
 */
export function computeBuildPatchImpact(
    prev: SnapshotPayload,
    curr: SnapshotPayload,
    build: BuildEntities
): BuildPatchImpact {
    const diff = diffSnapshots(prev, curr);
    // Only "changed" entities carry stat deltas we can attribute to a build's inputs;
    // added/removed heroes/items don't apply to an already-assembled build's numbers.
    const changedByName = new Map<string, StatChange[]>();
    for (const c of diff) {
        if (c.status === "changed") changedByName.set(`${c.kind}:${c.name}`, c.changes);
    }

    const affected: AffectedEntity[] = [];

    for (const { role, getName } of HERO_ROLES) {
        const name = getName(build);
        if (!name) continue;
        const changes = changedByName.get(`hero:${name}`);
        if (changes) affected.push({ kind: "hero", role, name, changes });
    }

    const pushItems = (names: string[], role: BuildRole) => {
        for (const name of names) {
            const changes = changedByName.get(`item:${name}`);
            if (changes) affected.push({ kind: "item", role, name, changes });
        }
    };
    pushItems(build.itemNames, "attackerItem");
    pushItems(build.targetItemNames, "targetItem");

    const totalStatChanges = affected.reduce((sum, a) => sum + a.changes.length, 0);
    return { affected, totalStatChanges, unaffected: affected.length === 0 };
}
