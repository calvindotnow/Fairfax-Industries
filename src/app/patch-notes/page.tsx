import { getSnapshots } from "@/lib/data";
import { diffSnapshots, type SnapshotPayload, type EntityChange } from "@/lib/patch-diff";
import { format } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

const fmt = (n: number | null) => (n == null ? "—" : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2));

export default async function PatchNotesPage() {
    const snaps = getSnapshots();

    return (
        <div className="space-y-10">
            <section className="max-w-2xl">
                <p className="overline mb-5">Patch notes</p>
                <h1 className="font-display text-4xl leading-[1.05] text-foreground md:text-5xl">What changed</h1>
                <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                    Every data sync is snapshotted, so we can show exactly how a patch moved the numbers — hero stats, item costs, and modifiers.
                </p>
            </section>

            {snaps.length < 2 ? (
                <section className="rounded-lg border border-border bg-[var(--surface)] p-6">
                    <p className="text-sm text-muted-foreground">
                        Patch tracking started
                        {snaps[0] ? <> on <span className="text-foreground">{format(snaps[0].takenAt!, "PP")}</span></> : null}. A comparison will appear here after the next data sync captures a second snapshot.
                    </p>
                </section>
            ) : (
                <PatchDiff
                    prev={JSON.parse(snaps[1].payload) as SnapshotPayload}
                    curr={JSON.parse(snaps[0].payload) as SnapshotPayload}
                    fromLabel={snaps[1].label}
                    toLabel={snaps[0].label}
                />
            )}

            <p className="text-sm text-muted-foreground">
                See <Link href="/methodology" className="text-foreground underline-offset-2 hover:underline">how the numbers are made</Link>.
            </p>
        </div>
    );
}

function PatchDiff({ prev, curr, fromLabel, toLabel }: { prev: SnapshotPayload; curr: SnapshotPayload; fromLabel: string; toLabel: string }) {
    const changes = diffSnapshots(prev, curr);
    if (changes.length === 0) {
        return (
            <section className="rounded-lg border border-border bg-[var(--surface)] p-6">
                <p className="text-sm text-muted-foreground">No stat changes between <span className="text-foreground">{fromLabel}</span> and <span className="text-foreground">{toLabel}</span>.</p>
            </section>
        );
    }
    const heroes = changes.filter((c) => c.kind === "hero");
    const items = changes.filter((c) => c.kind === "item");
    return (
        <div className="space-y-8">
            <p className="text-sm text-muted-foreground">
                <span className="text-foreground">{fromLabel}</span> → <span className="text-foreground">{toLabel}</span> · {changes.length} change{changes.length === 1 ? "" : "s"}
            </p>
            {heroes.length > 0 && <ChangeGroup title="Heroes" changes={heroes} />}
            {items.length > 0 && <ChangeGroup title="Items" changes={items} />}
        </div>
    );
}

function ChangeGroup({ title, changes }: { title: string; changes: EntityChange[] }) {
    return (
        <section>
            <h2 className="overline mb-3">{title}</h2>
            <div className="overflow-hidden rounded-lg border border-border bg-[var(--surface)] divide-y divide-[var(--border)]">
                {changes.map((c) => (
                    <div key={`${c.kind}-${c.name}`} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-4">
                        <span className="w-48 shrink-0 text-foreground">
                            {c.name}
                            {c.status !== "changed" && (
                                <span className="ml-2 text-xs uppercase tracking-wide" style={{ color: c.status === "added" ? "var(--cash-500)" : "var(--danger-500)" }}>{c.status}</span>
                            )}
                        </span>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                            {c.changes.map((s) => {
                                const up = s.from != null && s.to != null && s.to > s.from;
                                return (
                                    <span key={s.stat} className="text-muted-foreground">
                                        {s.stat}{" "}
                                        <span className="tabular-nums">{fmt(s.from)}</span>
                                        <span className="mx-1" style={{ color: up ? "var(--cash-500)" : "var(--danger-500)" }}>→</span>
                                        <span className="tabular-nums" style={{ color: up ? "var(--cash-500)" : "var(--danger-500)" }}>{fmt(s.to)}</span>
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
