/**
 * Stateless build sharing. A build (heroes + loadouts + scenario) is packed into
 * a compact URL-safe string — the link *is* the storage, so there's no database
 * of builds to manage.
 *
 * Heroes/items are referenced by a stable hash of their (unique) NAME, not by a
 * position in a sorted list. This keeps codes **patch-stable**: adding or removing
 * items between game patches no longer shifts everyone else's references. An item
 * that's removed in a later patch simply drops out of the decoded build instead of
 * silently resolving to the wrong neighbour. (Format VERSION 2.)
 *
 * VERSION 1 codes — positional, name-sorted — are still decoded for backward
 * compatibility with links shared before the switch.
 */
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";

export interface ShareState {
    heroId: number | null;
    targetId: number | null;
    loadout: number[];
    targetLoadout: number[];
    range: number;
    shots: number;
    headshots: number;
    matchTargetLevel: boolean;
}

const VERSION = 2;
const HERO_NONE = 0xffff; // sentinel hero hash for "unset"

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n || 0)));

// FNV-1a 32-bit string hash — deterministic and dependency-free.
function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
// Heroes: 16-bit (small pool, negligible collisions). Items: 24-bit (~300 items → ~0.003 expected collisions).
const heroHash = (name: string) => fnv1a(name) & 0xffff;
const itemHash = (name: string) => fnv1a(name) & 0xffffff;

function bytesToBase64Url(bytes: number[]): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b & 0xff);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(code: string): number[] {
    let s = code.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    return Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function encodeBuild(
    state: ShareState,
    heroes: HeroWithAbilities[],
    items: ItemWithModifiers[]
): string {
    const heroById = new Map(heroes.map((h) => [h.id, h]));
    const itemById = new Map(items.map((i) => [i.id, i]));

    const heroBytes = (id: number | null): [number, number] => {
        const h = id == null ? null : heroById.get(id);
        const v = h ? heroHash(h.name) : HERO_NONE;
        return [(v >> 8) & 0xff, v & 0xff];
    };
    const itemBytes = (ids: number[]): number[] => {
        const out: number[] = [];
        for (const id of ids) {
            const it = itemById.get(id);
            if (!it) continue;
            const v = itemHash(it.name);
            out.push((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
        }
        return out;
    };

    const a = itemBytes(state.loadout); // 3 bytes per item
    const t = itemBytes(state.targetLoadout);
    const bytes = [
        VERSION,
        ...heroBytes(state.heroId),
        ...heroBytes(state.targetId),
        state.matchTargetLevel ? 1 : 0,
        clampByte(state.range),
        clampByte(state.shots),
        clampByte(state.headshots),
        a.length / 3, ...a,
        t.length / 3, ...t,
    ];
    return bytesToBase64Url(bytes);
}

export function decodeBuild(
    code: string,
    heroes: HeroWithAbilities[],
    items: ItemWithModifiers[]
): ShareState | null {
    try {
        const b = base64UrlToBytes(code);
        if (b.length < 1) return null;
        if (b[0] === 1) return decodeV1(b, heroes, items);
        if (b[0] !== VERSION) return null;

        const heroByHash = new Map(heroes.map((h) => [heroHash(h.name), h.id]));
        const itemByHash = new Map(items.map((i) => [itemHash(i.name), i.id]));

        let p = 1;
        const readHero = (): number | null => {
            const v = ((b[p++] ?? 0) << 8) | (b[p++] ?? 0);
            return v === HERO_NONE ? null : heroByHash.get(v) ?? null;
        };
        const heroId = readHero();
        const targetId = readHero();
        const matchTargetLevel = b[p++] === 1;
        const range = b[p++];
        const shots = b[p++];
        const headshots = b[p++];
        const readItems = (): number[] => {
            const n = b[p++] ?? 0;
            const out: number[] = [];
            for (let i = 0; i < n; i++) {
                const v = ((b[p++] ?? 0) << 16) | ((b[p++] ?? 0) << 8) | (b[p++] ?? 0);
                const id = itemByHash.get(v);
                if (id != null) out.push(id); // dropped items (removed in a later patch) simply fall away
            }
            return out;
        };
        const loadout = readItems();
        const targetLoadout = readItems();
        return { heroId, targetId, loadout, targetLoadout, range, shots, headshots, matchTargetLevel };
    } catch {
        return null;
    }
}

// Legacy positional decoder (VERSION 1) — name-sorted indices, 1 byte each.
function decodeV1(b: number[], heroes: HeroWithAbilities[], items: ItemWithModifiers[]): ShareState | null {
    if (b.length < 9) return null;
    const heroesByName = [...heroes].sort((a, c) => a.name.localeCompare(c.name));
    const itemsByName = [...items].sort((a, c) => a.name.localeCompare(c.name));
    let p = 1;
    const heroId = heroesByName[b[p++]]?.id ?? null;
    const targetId = heroesByName[b[p++]]?.id ?? null;
    const matchTargetLevel = b[p++] === 1;
    const range = b[p++];
    const shots = b[p++];
    const headshots = b[p++];
    const readItems = (): number[] => {
        const n = b[p++] ?? 0;
        const out: number[] = [];
        for (let i = 0; i < n; i++) {
            const it = itemsByName[b[p++]];
            if (it) out.push(it.id);
        }
        return out;
    };
    const loadout = readItems();
    const targetLoadout = readItems();
    return { heroId, targetId, loadout, targetLoadout, range, shots, headshots, matchTargetLevel };
}
