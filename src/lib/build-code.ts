/**
 * Stateless build sharing. A build (heroes + loadouts + scenario) is packed into
 * a compact URL-safe string — the link *is* the storage, so there's no database
 * of builds to manage.
 *
 * Heroes/items are referenced by a stable hash of their (unique) NAME, not by a
 * position in a sorted list. This keeps codes **patch-stable**: adding or removing
 * items between game patches no longer shifts everyone else's references. An item
 * that's removed in a later patch simply drops out of the decoded build instead of
 * silently resolving to the wrong neighbour. (Introduced in format VERSION 2.)
 *
 * Name-hashing alone can't distinguish "every referenced item still exists" from
 * "an item was silently renamed/replaced and now hashes to something else" — a link
 * can still resolve to a *different* item set after a patch without anyone noticing.
 * VERSION 3 adds a 2-byte **pool fingerprint**: an FNV-1a hash over the sorted list
 * of all item names at encode time, truncated to 16 bits. On decode, we recompute the
 * same fingerprint over the *current* item pool — if it disagrees, the item pool has
 * changed shape since the link was minted, and the decoded build's exact contents are
 * no longer guaranteed. We still decode best-effort (same as V2's per-item drop
 * behavior) and let the caller decide whether to warn the user.
 *
 * `decodeBuild` keeps its historical signature/behavior (a bare `ShareState | null`)
 * so existing call sites don't need to change. `decodeBuildMeta` is the additive entry
 * point that also reports the pool-mismatch verdict; use it wherever the UI should
 * surface a "this link may be stale" notice.
 *
 * VERSION 1 (positional, name-sorted) and VERSION 2 (name-hash, no fingerprint) codes
 * are still decoded for backward compatibility with links shared before VERSION 3.
 * Neither carries pool-provenance information, so `decodeBuildMeta` reports
 * `poolMismatch: false` for them ("unknown provenance" — we have nothing to compare
 * against, so we don't guess and don't warn) rather than treating every legacy link as
 * suspect.
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

const VERSION_1 = 1;
const VERSION_2 = 2;
const VERSION = 3;
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

// 16-bit fingerprint of the whole item pool's shape: FNV-1a over the sorted, joined
// item names. Order-independent (we sort first) so re-fetching/re-ordering the same
// data never trips a false mismatch — only an actual add/remove/rename does.
function poolFingerprint(items: ItemWithModifiers[]): [number, number] {
    const names = items.map((i) => i.name).sort();
    const h = fnv1a(names.join("")) & 0xffff;
    return [(h >> 8) & 0xff, h & 0xff];
}

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
        ...poolFingerprint(items),
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

// Shared body decoder for VERSION 2 and VERSION 3: identical name-hash payload,
// starting at byte offset `start` (1 for V2 — right after the version byte; 3 for
// V3 — after the version byte + 2-byte pool fingerprint).
function decodeHashedBody(
    b: number[],
    start: number,
    heroes: HeroWithAbilities[],
    items: ItemWithModifiers[]
): ShareState {
    const heroByHash = new Map(heroes.map((h) => [heroHash(h.name), h.id]));
    const itemByHash = new Map(items.map((i) => [itemHash(i.name), i.id]));

    let p = start;
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
}

export interface DecodeResult {
    state: ShareState | null;
    /** true only for a VERSION 3 code whose embedded pool fingerprint disagrees with
     *  the current item pool — i.e. the item list has changed shape (added/removed/
     *  renamed) since the link was minted, so some referenced items may have silently
     *  dropped or resolved differently. V1/V2 codes carry no fingerprint ("unknown
     *  provenance") and always report `false` here rather than being guessed at. */
    poolMismatch: boolean;
}

export function decodeBuild(
    code: string,
    heroes: HeroWithAbilities[],
    items: ItemWithModifiers[]
): ShareState | null {
    return decodeBuildMeta(code, heroes, items).state;
}

/** Additive sibling of `decodeBuild` that also reports pool-fingerprint drift, for UI
 *  surfaces that want to warn the user ("this link was made on an older patch").
 *  Decoding itself is always best-effort, exactly like `decodeBuild` — a mismatch
 *  never blocks decoding, it's just surfaced alongside the result. */
export function decodeBuildMeta(
    code: string,
    heroes: HeroWithAbilities[],
    items: ItemWithModifiers[]
): DecodeResult {
    try {
        const b = base64UrlToBytes(code);
        if (b.length < 1) return { state: null, poolMismatch: false };
        if (b[0] === VERSION_1) return { state: decodeV1(b, heroes, items), poolMismatch: false };
        if (b[0] === VERSION_2) return { state: decodeHashedBody(b, 1, heroes, items), poolMismatch: false };
        if (b[0] !== VERSION) return { state: null, poolMismatch: false };

        const [expectedHi, expectedLo] = poolFingerprint(items);
        const gotHi = b[1] ?? 0;
        const gotLo = b[2] ?? 0;
        const poolMismatch = gotHi !== expectedHi || gotLo !== expectedLo;

        const state = decodeHashedBody(b, 3, heroes, items);
        return { state, poolMismatch };
    } catch {
        return { state: null, poolMismatch: false };
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
