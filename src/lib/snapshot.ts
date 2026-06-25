/**
 * Capture a stat snapshot into the DB (R-5). Called once per sync so patch history
 * accumulates over time; the /patch-notes page diffs the two most recent rows.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { statSnapshots } from "@/db/schema";
import { buildPayload } from "@/lib/patch-diff";

export async function captureSnapshot(label?: string): Promise<void> {
    // Self-creating so it works before any drizzle migration has run.
    db.run(sql`CREATE TABLE IF NOT EXISTS stat_snapshots (
        id integer PRIMARY KEY AUTOINCREMENT,
        taken_at integer NOT NULL,
        label text NOT NULL,
        payload text NOT NULL
    )`);
    const hs = await db.query.heroes.findMany();
    const its = await db.query.items.findMany({ with: { modifiers: true } });
    const payload = buildPayload(hs, its);
    await db.insert(statSnapshots).values({
        takenAt: new Date(),
        label: label ?? new Date().toISOString().slice(0, 10),
        payload: JSON.stringify(payload),
    });
}
