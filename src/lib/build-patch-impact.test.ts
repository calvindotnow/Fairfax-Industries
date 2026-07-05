import { test, expect } from "bun:test";
import { computeBuildPatchImpact, type BuildEntities } from "./build-patch-impact";
import type { SnapshotPayload } from "./patch-diff";

// Fixtures modeled on the REAL baked snapshot shape:
//   heroes[name] = { maxHealth, bulletDamage, weaponFireRate, bulletResist, spiritResist }
//   items[name]  = { soulCost, <flat statName → value>... }
// (see src/lib/baked-data.json — Infernus/Extended Magazine samples).

const prev: SnapshotPayload = {
    heroes: {
        Abrams: { maxHealth: 600, bulletDamage: 18, weaponFireRate: 4, bulletResist: 0, spiritResist: 0 },
        Haze: { maxHealth: 550, bulletDamage: 12, weaponFireRate: 6, bulletResist: 0, spiritResist: 0 },
        Wraith: { maxHealth: 560, bulletDamage: 14, weaponFireRate: 5, bulletResist: 0, spiritResist: 0 },
    },
    items: {
        "Extended Magazine": { soulCost: 800, bulletDamage: 8 },
        "Basic Magazine": { soulCost: 500, bulletDamage: 6 },
        "Healing Rite": { soulCost: 500, maxHealth: 40 },
    },
};
const curr: SnapshotPayload = {
    heroes: {
        // Abrams: two stats moved — maxHealth 600→650 (buff), bulletDamage 18→16 (nerf)
        Abrams: { maxHealth: 650, bulletDamage: 16, weaponFireRate: 4, bulletResist: 0, spiritResist: 0 },
        // Haze unchanged
        Haze: { maxHealth: 550, bulletDamage: 12, weaponFireRate: 6, bulletResist: 0, spiritResist: 0 },
        // Wraith unchanged
        Wraith: { maxHealth: 560, bulletDamage: 14, weaponFireRate: 5, bulletResist: 0, spiritResist: 0 },
    },
    items: {
        // Extended Magazine: bulletDamage 8→10 (buff)
        "Extended Magazine": { soulCost: 800, bulletDamage: 10 },
        // Basic Magazine unchanged
        "Basic Magazine": { soulCost: 500, bulletDamage: 6 },
        // Healing Rite: soulCost 500→600 (nerf)
        "Healing Rite": { soulCost: 600, maxHealth: 40 },
    },
};

// A build: Abrams (attacker) vs Haze (target), holding Extended Magazine + Basic Magazine.
// Target holds Healing Rite.
const build: BuildEntities = {
    heroName: "Abrams",
    targetName: "Haze",
    itemNames: ["Extended Magazine", "Basic Magazine"],
    targetItemNames: ["Healing Rite"],
};

test("intersects only the build's own entities against the patch diff", () => {
    const impact = computeBuildPatchImpact(prev, curr, build);
    // Abrams changed (attacker hero), Extended Magazine changed (attacker item),
    // Healing Rite changed (target item). Basic Magazine unchanged; Haze unchanged;
    // Wraith not in the build at all → never appears.
    const names = impact.affected.map((a) => a.name).sort();
    expect(names).toEqual(["Abrams", "Extended Magazine", "Healing Rite"]);
    expect(impact.affected.some((a) => a.name === "Wraith")).toBe(false);
    expect(impact.affected.some((a) => a.name === "Basic Magazine")).toBe(false);
});

test("tags each affected entity with its role in the build", () => {
    const impact = computeBuildPatchImpact(prev, curr, build);
    const byName = Object.fromEntries(impact.affected.map((a) => [a.name, a]));
    expect(byName["Abrams"].role).toBe("attacker");
    expect(byName["Extended Magazine"].role).toBe("attackerItem");
    expect(byName["Healing Rite"].role).toBe("targetItem");
});

test("carries the underlying stat changes (old→new) per affected entity", () => {
    const impact = computeBuildPatchImpact(prev, curr, build);
    const abrams = impact.affected.find((a) => a.name === "Abrams")!;
    // maxHealth 600→650, bulletDamage 18→16 — order-independent
    const changes = Object.fromEntries(abrams.changes.map((c) => [c.stat, [c.from, c.to]]));
    expect(changes["maxHealth"]).toEqual([600, 650]);
    expect(changes["bulletDamage"]).toEqual([18, 16]);

    const mag = impact.affected.find((a) => a.name === "Extended Magazine")!;
    expect(mag.changes).toEqual([{ stat: "bulletDamage", from: 8, to: 10 }]);

    const rite = impact.affected.find((a) => a.name === "Healing Rite")!;
    expect(rite.changes).toEqual([{ stat: "soulCost", from: 500, to: 600 }]);
});

test("reports unaffected when none of the build's inputs changed", () => {
    // A build using only entities that didn't move between snapshots.
    const untouched: BuildEntities = {
        heroName: "Haze",
        targetName: "Wraith",
        itemNames: ["Basic Magazine"],
        targetItemNames: [],
    };
    const impact = computeBuildPatchImpact(prev, curr, untouched);
    expect(impact.affected).toEqual([]);
    expect(impact.unaffected).toBe(true);
});

test("counts changed stats across the build (headline)", () => {
    const impact = computeBuildPatchImpact(prev, curr, build);
    // Abrams: 2 stat changes; Extended Magazine: 1; Healing Rite: 1 = 4 total.
    expect(impact.totalStatChanges).toBe(4);
    expect(impact.affected.length).toBe(3);
});

test("an attacker item that is also on the target is attributed to both sides", () => {
    // Extended Magazine held by BOTH attacker and target; it changed.
    const both: BuildEntities = {
        heroName: "Wraith", // unchanged hero
        targetName: "Wraith",
        itemNames: ["Extended Magazine"],
        targetItemNames: ["Extended Magazine"],
    };
    const impact = computeBuildPatchImpact(prev, curr, both);
    const mags = impact.affected.filter((a) => a.name === "Extended Magazine");
    // One entry per (name, role) — attackerItem and targetItem are distinct rows.
    expect(mags.map((m) => m.role).sort()).toEqual(["attackerItem", "targetItem"]);
});

test("attacker hero and target hero can both be flagged when both changed", () => {
    const mirror: BuildEntities = {
        heroName: "Abrams",
        targetName: "Abrams", // same hero on both sides, and it changed
        itemNames: [],
        targetItemNames: [],
    };
    const impact = computeBuildPatchImpact(prev, curr, mirror);
    expect(impact.affected.map((a) => a.role).sort()).toEqual(["attacker", "target"]);
});

test("degrades cleanly when the build references entities absent from the snapshot", () => {
    const ghost: BuildEntities = {
        heroName: "NonexistentHero",
        targetName: "Haze",
        itemNames: ["Nonexistent Item"],
        targetItemNames: [],
    };
    const impact = computeBuildPatchImpact(prev, curr, ghost);
    // Nothing the snapshot knows about changed → treated as unaffected, no throw.
    expect(impact.affected).toEqual([]);
    expect(impact.unaffected).toBe(true);
});
