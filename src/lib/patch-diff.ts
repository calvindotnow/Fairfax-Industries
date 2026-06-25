/**
 * Patch-diff core (R-5). Pure functions over stat snapshots — no DB, no React —
 * so they're fully testable. A snapshot is captured each sync (see lib/snapshot);
 * diffing the two most recent ones yields "what changed for my build."
 */

/** A snapshot of the numbers that matter for theorycrafting, keyed by entity name. */
export interface SnapshotPayload {
    heroes: Record<string, Record<string, number>>;
    items: Record<string, Record<string, number>>;
}

export interface StatChange {
    stat: string;
    from: number | null; // null = stat didn't exist before
    to: number | null; // null = stat removed
}

export interface EntityChange {
    kind: "hero" | "item";
    name: string;
    status: "added" | "removed" | "changed";
    changes: StatChange[];
}

export function buildPayload(
    heroes: { name: string; maxHealth: number; bulletDamage: number; weaponFireRate: number; bulletResist: number; spiritResist: number }[],
    items: { name: string; soulCost: number; modifiers: { statName: string; flatBonus: number; percentBonus: number }[] }[]
): SnapshotPayload {
    return {
        heroes: Object.fromEntries(
            heroes.map((h) => [h.name, {
                maxHealth: h.maxHealth,
                bulletDamage: h.bulletDamage,
                weaponFireRate: h.weaponFireRate,
                bulletResist: h.bulletResist,
                spiritResist: h.spiritResist,
            }])
        ),
        items: Object.fromEntries(
            items.map((i) => [i.name, {
                soulCost: i.soulCost,
                ...Object.fromEntries(i.modifiers.map((m) => [m.statName, m.percentBonus || m.flatBonus])),
            }])
        ),
    };
}

function diffGroup(kind: "hero" | "item", prev: Record<string, Record<string, number>>, curr: Record<string, Record<string, number>>): EntityChange[] {
    const out: EntityChange[] = [];
    const names = new Set([...Object.keys(prev), ...Object.keys(curr)]);
    for (const name of names) {
        const a = prev[name];
        const b = curr[name];
        if (a && !b) { out.push({ kind, name, status: "removed", changes: [] }); continue; }
        if (!a && b) { out.push({ kind, name, status: "added", changes: [] }); continue; }
        const changes: StatChange[] = [];
        const stats = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const stat of stats) {
            const from = a[stat] ?? null;
            const to = b[stat] ?? null;
            if (from !== to) changes.push({ stat, from, to });
        }
        if (changes.length > 0) out.push({ kind, name, status: "changed", changes });
    }
    return out;
}

/** Every hero/item that was added, removed, or had a stat change between two snapshots. */
export function diffSnapshots(prev: SnapshotPayload, curr: SnapshotPayload): EntityChange[] {
    return [...diffGroup("hero", prev.heroes, curr.heroes), ...diffGroup("item", prev.items, curr.items)];
}
