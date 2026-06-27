import type { Metadata } from "next";
import LaneMatchup from "@/components/lane-matchup";
import { decodeBuild } from "@/lib/build-code";
import { getHeroes, getItems } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Lane Matchup — Fairfax Industries",
};

export default async function LanePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const heroes = getHeroes();
    const items = getItems();

    const sp = await searchParams;
    const code = Array.isArray(sp.b) ? sp.b[0] : sp.b;
    const initialBuild = code ? decodeBuild(code, heroes, items) : null;
    const heroParam = Array.isArray(sp.hero) ? sp.hero[0] : sp.hero;
    const initialHeroId =
        heroParam != null && heroes.some((h) => h.id === Number(heroParam))
            ? Number(heroParam)
            : null;

    return <LaneMatchup heroes={heroes} items={items} initialHeroId={initialHeroId} initialBuild={initialBuild} />;
}
