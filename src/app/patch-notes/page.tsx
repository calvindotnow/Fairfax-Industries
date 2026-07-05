import { getSnapshots } from "@/lib/data";
import { diffSnapshots, type SnapshotPayload, type EntityChange } from "@/lib/patch-diff";
import type { AffectedEntity, BuildRole } from "@/lib/build-patch-impact";
import { resolveBuildImpact } from "./build-impact";
import { format } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

const fmt = (n: number | null) => (n == null ? "—" : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2));

const ROLE_LABEL: Record<BuildRole, string> = {
    attacker: "Your hero",
    target: "Their hero",
    attackerItem: "Your item",
    targetItem: "Their item",
};

export default async function PatchNotesPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
    const snaps = getSnapshots();
    const { b: code } = await searchParams;

    const haveTwo = snaps.length >= 2;
    const prev = haveTwo ? (JSON.parse(snaps[1].payload) as SnapshotPayload) : null;
    const curr = haveTwo ? (JSON.parse(snaps[0].payload) as SnapshotPayload) : null;

    // Build-scoped impact, only when a code is present and we have two snapshots to diff.
    const build = code && prev && curr ? resolveBuildImpact(code, prev, curr) : null;
    const undecodable = !!code && !build;

    return (
        <div className="space-y-10">
            <section className="max-w-2xl">
                <p className="overline mb-5">Patch notes</p>
                <h1 className="font-display text-4xl leading-[1.05] text-foreground md:text-5xl">What changed</h1>
                <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                    Every data sync is snapshotted, so we can show exactly how a patch moved the numbers — hero stats, item costs, and modifiers.
                </p>
            </section>

            {undecodable && (
                <section className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--surface-raised)", border: "1px solid var(--border-brass)", color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--brass-300)" }}>⚠</span>{" "}
                    We couldn&apos;t read that build link — showing the full patch below instead.
                </section>
            )}

            {build && prev && curr && (
                <BuildImpactSection
                    heroName={build.heroName}
                    targetName={build.targetName}
                    affected={build.impact.affected}
                    totalStatChanges={build.impact.totalStatChanges}
                    unaffected={build.impact.unaffected}
                    poolMismatch={build.poolMismatch}
                    fromLabel={snaps[1].label}
                    toLabel={snaps[0].label}
                />
            )}

            {!haveTwo ? (
                <section className="rounded-lg border border-border bg-[var(--surface)] p-6">
                    <p className="text-sm text-muted-foreground">
                        Patch tracking started
                        {snaps[0] ? <> on <span className="text-foreground">{format(snaps[0].takenAt!, "PP")}</span></> : null}. A comparison will appear here after the next data sync captures a second snapshot.
                    </p>
                </section>
            ) : (
                <PatchDiff prev={prev!} curr={curr!} fromLabel={snaps[1].label} toLabel={snaps[0].label} generalHeading={!!build} />
            )}

            <p className="text-sm text-muted-foreground">
                See <Link href="/methodology" className="text-foreground underline-offset-2 hover:underline">how the numbers are made</Link>.
            </p>
        </div>
    );
}

// ─── Build-scoped impact ────────────────────────────────────────────────────────
// "How did this patch move MY build?" — Variant B (targeted deltas): the two stat
// snapshots are too thin to faithfully re-simulate the build under the previous patch
// (no abilities / item effects / per-level growth), so instead of inventing output
// numbers (burst %, TTK) we show exactly which of THIS build's inputs the patch touched.
function BuildImpactSection({
    heroName, targetName, affected, totalStatChanges, unaffected, poolMismatch, fromLabel, toLabel,
}: {
    heroName: string; targetName: string; affected: AffectedEntity[]; totalStatChanges: number;
    unaffected: boolean; poolMismatch: boolean; fromLabel: string; toLabel: string;
}) {
    return (
        <section className="rounded-lg border p-6" style={{ borderColor: "var(--border-brass)", background: "var(--surface)", boxShadow: "inset 0 1px 0 var(--line-soft)" }}>
            <p className="overline mb-2" style={{ color: "var(--brass-300)" }}>Your build under this patch</p>
            <h2 className="font-display text-2xl text-foreground">
                {heroName} <span className="text-muted-foreground">vs</span> {targetName}
            </h2>

            {poolMismatch && (
                <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--brass-300)" }}>⚠</span>{" "}
                    This link was made on an older patch — some items may have changed since, so the list below is best-effort.
                </p>
            )}

            {unaffected ? (
                <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--cash-500)" }}>✓</span>{" "}
                    This patch didn&apos;t touch your build&apos;s inputs — none of your hero, their hero, or the items on either side changed between{" "}
                    <span className="text-foreground">{fromLabel}</span> and <span className="text-foreground">{toLabel}</span>.
                </p>
            ) : (
                <>
                    <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                        This patch changed <span className="text-foreground tabular-nums">{totalStatChanges}</span> stat{totalStatChanges === 1 ? "" : "s"} across{" "}
                        <span className="text-foreground tabular-nums">{affected.length}</span> of your build&apos;s inputs. These are the inputs that moved — real numbers, old → new.
                    </p>
                    <div className="mt-5 overflow-hidden rounded-lg border border-border divide-y divide-[var(--border)]" style={{ background: "var(--surface-raised)" }}>
                        {affected.map((a) => (
                            <div key={`${a.role}-${a.name}`} className="flex flex-col gap-1.5 p-4 sm:flex-row sm:items-baseline sm:gap-4">
                                <span className="w-52 shrink-0">
                                    <span className="text-foreground">{a.name}</span>
                                    <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>{ROLE_LABEL[a.role]}</span>
                                </span>
                                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                                    {a.changes.map((s) => {
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
                    <p className="mt-3 text-xs" style={{ color: "var(--text-dim)" }}>
                        We show which of your build&apos;s inputs the patch moved, not a re-simulated burst/DPS delta — the patch snapshots don&apos;t carry enough (abilities, item effects, level scaling) to re-run the engine on the old patch faithfully. Open the build to see its current numbers.
                    </p>
                </>
            )}
        </section>
    );
}

function PatchDiff({ prev, curr, fromLabel, toLabel, generalHeading }: { prev: SnapshotPayload; curr: SnapshotPayload; fromLabel: string; toLabel: string; generalHeading?: boolean }) {
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
            {generalHeading && <h2 className="overline" style={{ color: "var(--text-dim)" }}>Everything that changed this patch</h2>}
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
