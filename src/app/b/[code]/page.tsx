import { getHeroes, getItems } from "@/lib/data";
import { decodeBuild } from "@/lib/build-code";
import { simulate } from "@/lib/sim";
import type { ItemWithModifiers } from "@/db/schema";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

const CAT_COLOR: Record<string, string> = {
    weapon: "var(--weapon-400)",
    vitality: "var(--vitality-400)",
    spirit: "var(--spirit-400)",
};

async function loadData() {
    return { heroes: getHeroes(), items: getItems() };
}

// Resolve a share code into the heroes, items, and simulated result. Ultimates
// default off, mirroring the build tool, since the code doesn't store ability toggles.
async function resolveBuild(code: string) {
    const { heroes, items } = await loadData();
    const s = decodeBuild(code, heroes, items);
    if (!s) return null;
    const hero = heroes.find((h) => h.id === s.heroId) ?? null;
    const target = heroes.find((h) => h.id === s.targetId) ?? null;
    if (!hero || !target) return null;
    const equipped = s.loadout.map((id) => items.find((i) => i.id === id)).filter(Boolean) as ItemWithModifiers[];
    const targetEquipped = s.targetLoadout.map((id) => items.find((i) => i.id === id)).filter(Boolean) as ItemWithModifiers[];
    const ultIds = hero.abilities.filter((a) => a.type === "ultimate").map((a) => a.id);
    const result = simulate(
        { hero, items: equipped },
        { hero: target, items: targetEquipped, matchAttackerLevel: s.matchTargetLevel },
        { range: s.range, shots: s.shots, headshots: s.headshots, disabledAbilityIds: ultIds }
    );
    return { hero, target, equipped, targetEquipped, result };
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
    const { code } = await params;
    const b = await resolveBuild(code);
    if (!b) return { title: "Build not found — Fairfax Industries" };
    const title = `${b.hero.name} vs ${b.target.name} — ${Math.round(b.result.burst.total).toLocaleString()} burst`;
    const description = `A Deadlock build: ${b.hero.name} (Lvl ${b.result.level}) vs ${b.target.name}. ${Math.round(b.result.sustainedDps).toLocaleString()} sustained DPS. Open it in the Fairfax Industries build tool.`;
    return { title, description, openGraph: { title, description } };
}

const fmt = (n: number) => Math.round(n).toLocaleString();

export default async function SharedBuildPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    const b = await resolveBuild(code);
    if (!b) notFound();
    const { hero, target, equipped, targetEquipped, result } = b;

    return (
        <div className="space-y-10">
            <div>
                <p className="overline mb-3">Shared build</p>
                <h1 className="font-display text-4xl md:text-5xl leading-tight text-foreground">
                    {hero.name} <span className="text-muted-foreground">vs</span> {target.name}
                </h1>
                <p className="mt-3 text-sm text-muted-foreground">
                    Level {result.level} · {fmt(result.soulsSpent)} souls of items · range {result.range} m
                </p>
                <div className="mt-6">
                    <Link
                        href={`/hideout?b=${code}`}
                        className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                        Open in New Build →
                    </Link>
                </div>
            </div>

            {/* Headline numbers */}
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                {[
                    { label: "Total burst", value: fmt(result.burst.total), accent: true },
                    { label: "Sustained DPS", value: fmt(result.sustainedDps) },
                    { label: "Time to kill", value: result.timeToKill != null ? `${result.timeToKill.toFixed(1)}s` : "—" },
                    { label: "Target EHP", value: fmt(result.theirEhp) },
                ].map((s) => (
                    <div key={s.label} className="bg-background p-5">
                        <div className="overline text-[10px]">{s.label}</div>
                        <div
                            className="mt-1 font-display tabular-nums"
                            style={{ fontSize: 30, color: s.accent ? "var(--brass-300)" : "var(--text)", textShadow: s.accent ? "0 0 24px var(--brass-glow)" : "none" }}
                        >
                            {s.value}
                        </div>
                    </div>
                ))}
            </section>

            {/* Loadouts */}
            <section className="grid gap-6 md:grid-cols-2">
                <Loadout title={`${hero.name} — attacker`} accent="var(--brass-400)" items={equipped} souls={result.soulsSpent} />
                <Loadout title={`${target.name} — target`} accent="var(--danger-500)" items={targetEquipped} souls={result.targetSoulsSpent} emptyHint="Base stats · no items" />
            </section>

            <p className="text-sm text-muted-foreground">
                Numbers from the Fairfax damage engine. See{" "}
                <Link href="/methodology" className="text-foreground underline-offset-2 hover:underline">how this is calculated</Link>.
            </p>
        </div>
    );
}

function Loadout({ title, accent, items, souls, emptyHint }: { title: string; accent: string; items: ItemWithModifiers[]; souls: number; emptyHint?: string }) {
    return (
        <div className="rounded-lg border border-border bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between">
                <span className="overline text-[10px]" style={{ color: accent }}>{title}</span>
                <span className="font-display tabular-nums text-sm" style={{ color: "var(--cash-500)" }}>§{fmt(souls)}</span>
            </div>
            {items.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{emptyHint ?? "No items."}</p>
            ) : (
                <ul className="mt-4 flex flex-col gap-2">
                    {items.map((it) => (
                        <li key={it.id} className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded" style={{ background: "var(--surface-raised)", border: `1px solid ${CAT_COLOR[it.category] ?? "var(--border)"}55` }}>
                                {it.imageUrl ? (
                                    <Image src={it.imageUrl} alt="" width={36} height={36} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                                ) : null}
                            </span>
                            <span className="flex-1 text-sm text-foreground">{it.name}</span>
                            <span className="font-display tabular-nums text-xs" style={{ color: "var(--cash-500)" }}>§{fmt(it.soulCost)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
