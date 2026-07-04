import DamageCalculator from "@/components/damage-calculator";
import { decodeBuildMeta } from "@/lib/build-code";
import { getHeroes, getItems } from "@/lib/data";

export const dynamic = "force-dynamic";

// Shown when the share code's embedded item-pool fingerprint (VERSION 3) disagrees
// with the current item pool — the link was made on an older patch, so some items
// may have been renamed/removed/added since and the decoded build is best-effort.
function PatchDriftNotice() {
    return (
        <div
            className="mb-6 rounded-lg px-4 py-3 text-sm"
            style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border-brass)",
                color: "var(--text-muted)",
            }}
        >
            <span style={{ color: "var(--brass-300)" }}>⚠</span>{" "}
            This build link was made on an older patch — some items may have changed.
        </div>
    );
}

export default async function HideoutPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const heroes = getHeroes();
    const items = getItems();

    // Seed from the URL server-side so the right build/hero renders on the first
    // paint (no flash of the default before a client effect corrects it). A full
    // share code (?b=) wins over a single ?hero= portrait link.
    const sp = await searchParams;
    const code = Array.isArray(sp.b) ? sp.b[0] : sp.b;
    const { state: initialBuild, poolMismatch } = code
        ? decodeBuildMeta(code, heroes, items)
        : { state: null, poolMismatch: false };
    const heroParam = Array.isArray(sp.hero) ? sp.hero[0] : sp.hero;
    const initialHeroId =
        heroParam != null && heroes.some((h) => h.id === Number(heroParam))
            ? Number(heroParam)
            : null;

    return (
        <>
            {poolMismatch ? <PatchDriftNotice /> : null}
            <DamageCalculator heroes={heroes} items={items} initialHeroId={initialHeroId} initialBuild={initialBuild} />
        </>
    );
}
