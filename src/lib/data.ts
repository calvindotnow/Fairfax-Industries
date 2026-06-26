/**
 * Read access to the game data, baked into the build by the sync script
 * (`src/lib/baked-data.json`). The app reads from here instead of a runtime
 * database, so it deploys to any serverless host with no DB connection. To
 * refresh the data, run `bun run sync` (regenerates the JSON) and redeploy.
 */
import type { HeroWithAbilities, ItemWithModifiers, StatSnapshot } from "@/db/schema";
import baked from "./baked-data.json";

// JSON dates arrive as strings; the read paths don't use the row timestamps
// (freshness comes from `getSyncedAt`), so the structural cast is safe.
const data = baked as unknown as {
    syncedAt: string;
    heroes: HeroWithAbilities[];
    items: ItemWithModifiers[];
    snapshots: StatSnapshot[];
};

export function getHeroes(): HeroWithAbilities[] {
    return data.heroes;
}

export function getItems(): ItemWithModifiers[] {
    return data.items;
}

/** The two most recent stat snapshots, newest first — for the patch-notes diff.
 *  `takenAt` is revived from its baked ISO string back into a Date. */
export function getSnapshots(): StatSnapshot[] {
    return data.snapshots.map((s) => ({ ...s, takenAt: new Date(s.takenAt as unknown as string) }));
}

/** When the baked data was last synced (for the data-freshness badge). */
export function getSyncedAt(): Date | null {
    return data.syncedAt ? new Date(data.syncedAt) : null;
}
