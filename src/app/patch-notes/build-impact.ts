import { getHeroes, getItems } from "@/lib/data";
import { decodeBuildMeta } from "@/lib/build-code";
import { computeBuildPatchImpact, type BuildEntities, type BuildPatchImpact } from "@/lib/build-patch-impact";
import type { SnapshotPayload } from "@/lib/patch-diff";

export interface ResolvedBuildImpact {
    heroName: string;
    targetName: string;
    /** true when the share code decoded but its item-pool fingerprint (VERSION 3) is stale. */
    poolMismatch: boolean;
    impact: BuildPatchImpact;
}

/**
 * Decode a share code against the current pool, map its entities to names, and compute the
 * build-scoped patch impact between two snapshots (prev → curr). Returns `null` when the
 * code is undecodable — the caller falls back to the general page + a small notice.
 */
export function resolveBuildImpact(
    code: string,
    prev: SnapshotPayload,
    curr: SnapshotPayload
): ResolvedBuildImpact | null {
    const heroes = getHeroes();
    const items = getItems();
    const { state, poolMismatch } = decodeBuildMeta(code, heroes, items);
    if (!state) return null;

    const heroName = heroes.find((h) => h.id === state.heroId)?.name ?? null;
    const targetName = heroes.find((h) => h.id === state.targetId)?.name ?? null;
    if (!heroName || !targetName) return null;

    const nameOf = (id: number) => items.find((i) => i.id === id)?.name;
    const itemNames = state.loadout.map(nameOf).filter((n): n is string => !!n);
    const targetItemNames = state.targetLoadout.map(nameOf).filter((n): n is string => !!n);

    const build: BuildEntities = { heroName, targetName, itemNames, targetItemNames };
    const impact = computeBuildPatchImpact(prev, curr, build);
    return { heroName, targetName, poolMismatch, impact };
}
