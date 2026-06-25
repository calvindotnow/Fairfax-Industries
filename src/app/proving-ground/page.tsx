import { db } from "@/db";
import ProvingGround from "@/components/proving-ground";
import type { HeroWithAbilities, ItemWithModifiers } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function ProvingGroundPage() {
    const heroes = (await db.query.heroes.findMany({
        with: { abilities: true },
        orderBy: (h, { asc }) => [asc(h.name)],
    })) as HeroWithAbilities[];

    const items = (await db.query.items.findMany({
        with: { modifiers: true },
        orderBy: (i, { asc }) => [asc(i.tier), asc(i.name)],
    })) as ItemWithModifiers[];

    return <ProvingGround heroes={heroes} items={items} />;
}
