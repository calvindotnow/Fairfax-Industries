import { test, expect } from "bun:test";
import { encodeBuild, decodeBuild, type ShareState } from "./build-code";
import type { HeroWithAbilities, ItemWithModifiers } from "../db/schema";

// The codec only reads `.id` and `.name`, so minimal fixtures suffice.
const heroes = [
    { id: 10, name: "Abrams" },
    { id: 11, name: "Bebop" },
    { id: 12, name: "Yamato" },
] as unknown as HeroWithAbilities[];

const items = [
    { id: 100, name: "Close Quarters" },
    { id: 101, name: "Extended Magazine" },
    { id: 102, name: "Monster Rounds" },
] as unknown as ItemWithModifiers[];

test("round-trips a full build", () => {
    const s: ShareState = { heroId: 12, targetId: 10, loadout: [100, 101], targetLoadout: [102], range: 30, shots: 10, headshots: 2, matchTargetLevel: false };
    expect(decodeBuild(encodeBuild(s, heroes, items), heroes, items)).toEqual(s);
});

test("round-trips an empty / null-hero build", () => {
    const s: ShareState = { heroId: null, targetId: null, loadout: [], targetLoadout: [], range: 25, shots: 8, headshots: 0, matchTargetLevel: true };
    expect(decodeBuild(encodeBuild(s, heroes, items), heroes, items)).toEqual(s);
});

test("patch-stable: codes resolve by name even when ids change on re-sync", () => {
    const s: ShareState = { heroId: 11, targetId: 12, loadout: [101], targetLoadout: [], range: 40, shots: 5, headshots: 1, matchTargetLevel: false };
    const code = encodeBuild(s, heroes, items);
    // A later patch re-syncs the DB: a new item is inserted and ids all shift.
    const heroesAfter = [{ id: 70, name: "Abrams" }, { id: 71, name: "Bebop" }, { id: 72, name: "Yamato" }] as unknown as HeroWithAbilities[];
    const itemsAfter = [{ id: 999, name: "Aaa New Item" }, { id: 500, name: "Close Quarters" }, { id: 501, name: "Extended Magazine" }, { id: 502, name: "Monster Rounds" }] as unknown as ItemWithModifiers[];
    const decoded = decodeBuild(code, heroesAfter, itemsAfter)!;
    expect(decoded.heroId).toBe(71); // Bebop, by name
    expect(decoded.targetId).toBe(72); // Yamato
    expect(decoded.loadout).toEqual([501]); // Extended Magazine, new id
});

test("an item removed in a later patch drops out, the rest survive", () => {
    const s: ShareState = { heroId: 10, targetId: 11, loadout: [100, 101, 102], targetLoadout: [], range: 25, shots: 8, headshots: 0, matchTargetLevel: false };
    const code = encodeBuild(s, heroes, items);
    const itemsAfter = items.filter((i) => i.id !== 101); // Extended Magazine removed
    expect(decodeBuild(code, heroes, itemsAfter)!.loadout).toEqual([100, 102]);
});

test("still decodes legacy VERSION 1 (positional) codes", () => {
    // Hand-built V1 code: [1, heroIdx, targetIdx, matchLevel, range, shots, headshots, aLen, ...a, tLen, ...t]
    // name-sorted heroes: Abrams(0) Bebop(1) Yamato(2); items: Close Quarters(0) Extended Magazine(1) Monster Rounds(2)
    const bytes = [1, 2, 0, 0, 30, 10, 2, 2, 0, 1, 1, 2];
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b & 0xff);
    const code = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const decoded = decodeBuild(code, heroes, items)!;
    expect(decoded.heroId).toBe(12); // Yamato
    expect(decoded.targetId).toBe(10); // Abrams
    expect(decoded.loadout).toEqual([100, 101]); // Close Quarters, Extended Magazine
    expect(decoded.targetLoadout).toEqual([102]); // Monster Rounds
});
