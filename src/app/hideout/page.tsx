import Hideout from "@/components/hideout";
import { decodeBuild } from "@/lib/build-code";
import { getHeroes, getItems } from "@/lib/data";

export const dynamic = "force-dynamic";

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
    const initialBuild = code ? decodeBuild(code, heroes, items) : null;
    const heroParam = Array.isArray(sp.hero) ? sp.hero[0] : sp.hero;
    const initialHeroId =
        heroParam != null && heroes.some((h) => h.id === Number(heroParam))
            ? Number(heroParam)
            : null;

    return <Hideout heroes={heroes} items={items} initialHeroId={initialHeroId} initialBuild={initialBuild} />;
}
