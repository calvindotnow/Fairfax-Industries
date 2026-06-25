/**
 * Stateless build sharing. A build (heroes + loadouts + scenario) is packed into
 * a compact URL-safe string — the link *is* the storage, so there's no database
 * of builds to manage.
 *
 * Items/heroes are referenced by their position in a NAME-SORTED list rather than
 * their database id, so codes stay stable across data re-syncs (ids can shift on
 * re-insert; alphabetical order does not). Codes may shift only when the item pool
 * itself changes between game patches — an accepted limitation for build links.
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

const VERSION = 1;
const NONE = 255; // sentinel hero index for "unset"

function sortedRefs(heroes: HeroWithAbilities[], items: ItemWithModifiers[]) {
    const heroesByName = [...heroes].sort((a, b) => a.name.localeCompare(b.name));
    const itemsByName = [...items].sort((a, b) => a.name.localeCompare(b.name));
    return { heroesByName, itemsByName };
}

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n || 0)));

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
    const { heroesByName, itemsByName } = sortedRefs(heroes, items);
    const heroIdx = (id: number | null) => {
        const i = id == null ? -1 : heroesByName.findIndex((h) => h.id === id);
        return i < 0 ? NONE : i;
    };
    const itemIdxs = (ids: number[]) =>
        ids.map((id) => itemsByName.findIndex((it) => it.id === id)).filter((i) => i >= 0 && i < 255);

    const a = itemIdxs(state.loadout);
    const t = itemIdxs(state.targetLoadout);
    const bytes = [
        VERSION,
        heroIdx(state.heroId),
        heroIdx(state.targetId),
        state.matchTargetLevel ? 1 : 0,
        clampByte(state.range),
        clampByte(state.shots),
        clampByte(state.headshots),
        a.length, ...a,
        t.length, ...t,
    ];
    return bytesToBase64Url(bytes);
}

export function decodeBuild(
    code: string,
    heroes: HeroWithAbilities[],
    items: ItemWithModifiers[]
): ShareState | null {
    try {
        const { heroesByName, itemsByName } = sortedRefs(heroes, items);
        const b = base64UrlToBytes(code);
        if (b.length < 9 || b[0] !== VERSION) return null;
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
    } catch {
        return null;
    }
}
