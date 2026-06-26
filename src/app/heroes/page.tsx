import Link from "next/link";
import Image from "next/image";
import { heroSlug } from "@/lib/slug";
import { getHeroes } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HeroesPage() {
  const roster = getHeroes();

  return (
    <div className="space-y-10">
      <section className="max-w-2xl">
        <p className="overline mb-5">Roster</p>
        <h1 className="font-display text-4xl leading-[1.05] text-foreground md:text-5xl">
          Heroes
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Every hero in the current patch, with base stats and abilities. Open
          any one straight into a build.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {roster.map((h) => (
          <Link
            key={h.id}
            href={`/heroes/${heroSlug(h.name)}`}
            className="group surface overflow-hidden rounded-lg transition-colors hover:border-border"
          >
            <div className="aspect-square overflow-hidden bg-background/40">
              {h.imageUrl ? (
                <Image
                  src={h.imageUrl}
                  alt={h.name}
                  width={240}
                  height={240}
                  className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                />
              ) : null}
            </div>
            <div className="p-3">
              <p className="font-display text-base text-foreground">{h.name}</p>
              {h.role ? (
                <p className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                  {h.role}
                </p>
              ) : null}
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
