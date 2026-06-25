import { test, expect } from "bun:test";
import { diffSnapshots, buildPayload, type SnapshotPayload } from "./patch-diff";

const prev: SnapshotPayload = {
    heroes: { Abrams: { maxHealth: 600, bulletDamage: 18 }, OldHero: { maxHealth: 500, bulletDamage: 10 } },
    items: { "Basic Magazine": { soulCost: 500, bulletDamage: 6 } },
};
const curr: SnapshotPayload = {
    heroes: { Abrams: { maxHealth: 650, bulletDamage: 18 }, NewHero: { maxHealth: 550, bulletDamage: 12 } },
    items: { "Basic Magazine": { soulCost: 500, bulletDamage: 8 } },
};

test("detects a changed stat with from/to", () => {
    const d = diffSnapshots(prev, curr);
    const abrams = d.find((c) => c.name === "Abrams")!;
    expect(abrams.status).toBe("changed");
    expect(abrams.changes).toEqual([{ stat: "maxHealth", from: 600, to: 650 }]);
});

test("detects added and removed entities", () => {
    const d = diffSnapshots(prev, curr);
    expect(d.find((c) => c.name === "NewHero")?.status).toBe("added");
    expect(d.find((c) => c.name === "OldHero")?.status).toBe("removed");
});

test("detects an item buff", () => {
    const mag = diffSnapshots(prev, curr).find((c) => c.name === "Basic Magazine")!;
    expect(mag.kind).toBe("item");
    expect(mag.changes).toEqual([{ stat: "bulletDamage", from: 6, to: 8 }]);
});

test("identical snapshots produce no changes", () => {
    expect(diffSnapshots(prev, prev)).toEqual([]);
});

test("buildPayload shapes heroes and items", () => {
    const p = buildPayload(
        [{ name: "Abrams", maxHealth: 600, bulletDamage: 18, weaponFireRate: 4, bulletResist: 0, spiritResist: 0 }],
        [{ name: "Mag", soulCost: 500, modifiers: [{ statName: "bulletDamage", flatBonus: 6, percentBonus: 0 }] }]
    );
    expect(p.heroes.Abrams.maxHealth).toBe(600);
    expect(p.items.Mag).toEqual({ soulCost: 500, bulletDamage: 6 });
});
