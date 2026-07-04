import { test, expect } from "bun:test";
import { encodeBuild, decodeBuild, decodeBuildMeta, type ShareState } from "./build-code";
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

// Local copies of the codec's private base64url helpers, for hand-crafting a legacy
// (pre-fingerprint) VERSION 2 code out of a freshly-encoded VERSION 3 code in tests.
function base64UrlToBytesForTest(code: string): number[] {
    let s = code.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    return Array.from(bin, (ch) => ch.charCodeAt(0));
}
function bytesToBase64UrlForTest(bytes: number[]): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b & 0xff);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

test("VERSION 3: round-trips a full build and reports no pool mismatch", () => {
    const s: ShareState = { heroId: 12, targetId: 10, loadout: [100, 101], targetLoadout: [102], range: 30, shots: 10, headshots: 2, matchTargetLevel: false };
    const code = encodeBuild(s, heroes, items);
    expect(decodeBuild(code, heroes, items)).toEqual(s);
    const meta = decodeBuildMeta(code, heroes, items);
    expect(meta.state).toEqual(s);
    expect(meta.poolMismatch).toBe(false);
});

test("VERSION 3: identical pool (even reconstructed/re-sorted) reports no mismatch", () => {
    const s: ShareState = { heroId: 10, targetId: 11, loadout: [100, 101, 102], targetLoadout: [], range: 25, shots: 8, headshots: 0, matchTargetLevel: false };
    const code = encodeBuild(s, heroes, items);
    // Same set of item names, different array order / object identity — pool fingerprint
    // is order-independent (sorted internally), so this must NOT be flagged as a mismatch.
    const itemsReordered = [...items].reverse().map((i) => ({ ...i }));
    const meta = decodeBuildMeta(code, heroes, itemsReordered);
    expect(meta.poolMismatch).toBe(false);
});

test("VERSION 3: a reshuffled item pool (rename/remove/add) reports a pool mismatch", () => {
    const s: ShareState = { heroId: 11, targetId: 12, loadout: [101], targetLoadout: [100], range: 40, shots: 5, headshots: 1, matchTargetLevel: false };
    const code = encodeBuild(s, heroes, items);
    // Simulate a patch: rename one item, remove another, add a new one, re-sort.
    const itemsAfter = [
        { id: 100, name: "Close Quarters" },
        { id: 101, name: "Extended Magazine Mk2" }, // renamed
        { id: 103, name: "Brand New Item" }, // added
        // "Monster Rounds" (id 102) removed
    ].sort((a, b) => a.name.localeCompare(b.name)) as unknown as ItemWithModifiers[];
    const meta = decodeBuildMeta(code, heroes, itemsAfter);
    expect(meta.poolMismatch).toBe(true);
    // Still decodes best-effort: survives what it can resolve by name.
    expect(meta.state).not.toBeNull();
    expect(meta.state!.loadout).toEqual([]); // "Extended Magazine" no longer exists under that name
    expect(meta.state!.targetLoadout).toEqual([100]); // "Close Quarters" still resolves
});

test("VERSION 3: decodeBuild (legacy signature) still decodes best-effort on pool mismatch", () => {
    const s: ShareState = { heroId: 10, targetId: 11, loadout: [100], targetLoadout: [], range: 20, shots: 6, headshots: 0, matchTargetLevel: true };
    const code = encodeBuild(s, heroes, items);
    const itemsAfter = [...items, { id: 999, name: "New Thing" }] as unknown as ItemWithModifiers[];
    const decoded = decodeBuild(code, heroes, itemsAfter);
    expect(decoded).not.toBeNull();
    expect(decoded!.loadout).toEqual([100]);
});

test("decodeBuildMeta on legacy VERSION 2 code: decodes, mismatch reported as false (unknown provenance, not flagged)", () => {
    // Build a V2 code by hand: VERSION=2 has no fingerprint bytes, same body shape as V3 otherwise.
    // Easiest reliable way: encode with current (V3) encoder, then patch the version byte down to 2
    // and drop the 2 fingerprint bytes, to simulate a code minted before fingerprinting existed.
    const s: ShareState = { heroId: 12, targetId: 10, loadout: [100], targetLoadout: [101], range: 30, shots: 10, headshots: 2, matchTargetLevel: false };
    const code = encodeBuild(s, heroes, items);
    const bytes = base64UrlToBytesForTest(code);
    const v2Bytes = [2, ...bytes.slice(3)]; // strip 2 fingerprint bytes, set version back to 2
    const v2Code = bytesToBase64UrlForTest(v2Bytes);
    const meta = decodeBuildMeta(v2Code, heroes, items);
    expect(meta.state).toEqual(s);
    expect(meta.poolMismatch).toBe(false);
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
