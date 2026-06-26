import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { heroSlug } from "@/lib/slug";
import { deriveAbilityScaling } from "@/lib/sim";
import { getHeroes } from "@/lib/data";

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));

// Prebuild every hero page from the baked data (no DB; all slugs are known).
export function generateStaticParams() {
  return getHeroes().map((h) => ({ slug: heroSlug(h.name) }));
}

export default async function HeroDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const roster = getHeroes();

  // Resolve by name slug; fall back to numeric id for back-compat with old links.
  const numericId = Number(slug);
  const hero =
    roster.find((h) => heroSlug(h.name) === slug) ??
    (Number.isFinite(numericId) ? roster.find((h) => h.id === numericId) : undefined);

  if (!hero) notFound();

  const stats: { label: string; value: string }[] = [
    { label: "Health", value: fmt(hero.maxHealth) },
    { label: "Health regen", value: `${fmt(hero.healthRegen)}/s` },
    { label: "Bullet damage", value: fmt(hero.bulletDamage) },
    { label: "Fire rate", value: `${fmt(hero.weaponFireRate)}/s` },
    { label: "Bullet resist", value: `${fmt(hero.bulletResist)}%` },
    { label: "Spirit resist", value: `${fmt(hero.spiritResist)}%` },
    { label: "Move speed", value: `${fmt(hero.moveSpeed)} m/s` },
    { label: "Sprint speed", value: `${fmt(hero.sprintSpeed)} m/s` },
    { label: "Stamina", value: fmt(hero.stamina) },
  ];

  const critScale = hero.critDamageReceivedScale ?? 1;
  const critReductionPct = Math.round((1 - critScale) * 100);

  return (
    <div className="space-y-12">
      <Link
        href="/heroes"
        className="group inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        All heroes
      </Link>

      {/* Header */}
      <section className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {hero.imageUrl ? (
          <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg surface">
            <Image
              src={hero.imageUrl}
              alt={hero.name}
              width={112}
              height={112}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          {hero.role ? <p className="overline mb-3">{hero.role}</p> : null}
          <h1 className="font-display text-4xl leading-[1.05] text-foreground md:text-5xl">
            {hero.name}
          </h1>
          {hero.description ? (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {hero.description}
            </p>
          ) : null}
          <Link
            href={`/hideout?hero=${hero.id}`}
            className="group mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open in New Build
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Base stats */}
      <section className="space-y-4">
        <h2 className="font-display text-2xl text-foreground">Base stats</h2>
        <p className="text-sm text-muted-foreground">
          Level&nbsp;1, no items — the floor every build is measured from.
        </p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-background p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {s.label}
              </p>
              <p className="mt-1 font-display text-2xl text-foreground">{s.value}</p>
            </div>
          ))}
          {critReductionPct !== 0 ? (
            <div className="bg-background p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Headshot taken
              </p>
              <p className="mt-1 font-display text-2xl text-foreground">
                {critReductionPct > 0 ? "−" : "+"}
                {Math.abs(critReductionPct)}%
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* Abilities — only the stats that apply to each (range/duration/cooldown/damage) */}
      <section className="space-y-4">
        <h2 className="font-display text-2xl text-foreground">Abilities</h2>
        {hero.abilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No abilities recorded for this hero yet.
          </p>
        ) : (
          <div className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
            {hero.abilities.map((a) => {
              // An ability can have both an impact hit and a damage-over-second zone
              // (e.g. Storm Cloud) — show both rather than hiding the DoT.
              const damage =
                [
                  (a.baseDamage ?? 0) > 0 ? fmt(a.baseDamage!) : null,
                  (a.dotDps ?? 0) > 0 ? `${fmt(a.dotDps!)}/s` : null,
                ]
                  .filter(Boolean)
                  .join(" + ") || null;
              const { damageScalePerSpirit, scalesWithSpirit } = deriveAbilityScaling(a);
              const abilityStats = [
                a.cooldown ? { label: "Cooldown", value: `${fmt(a.cooldown)}s` } : null,
                a.range ? { label: "Range", value: `${fmt(a.range)} m` } : null,
                a.duration ? { label: "Duration", value: `${fmt(a.duration)}s` } : null,
                a.charges && a.charges > 1
                  ? {
                      label: "Charges",
                      value: `×${a.charges}${a.chargeCooldown ? ` · ${fmt(a.chargeCooldown)}s` : ""}`,
                    }
                  : null,
                damage ? { label: "Damage", value: damage } : null,
              ].filter((x): x is { label: string; value: string } => x !== null);

              return (
                <div key={a.id} className="flex gap-4 bg-background p-5">
                  {a.imageUrl ? (
                    <Image
                      src={a.imageUrl}
                      alt=""
                      width={44}
                      height={44}
                      className="h-11 w-11 shrink-0 object-contain"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="text-base text-foreground">{a.name}</p>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {a.type}
                      </span>
                    </div>
                    {a.description ? (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {a.description}
                      </p>
                    ) : null}
                    {abilityStats.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                        {abilityStats.map((s) => (
                          <div key={s.label}>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {s.label}
                            </p>
                            <p className="font-display tabular-nums text-sm text-foreground">
                              {s.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {scalesWithSpirit ? (
                      <p
                        className="mt-2.5 inline-flex items-center gap-1 text-[11px]"
                        style={{ color: "var(--spirit-400)" }}
                        title="This ability grows with Spirit Power, which rises as you level and buy spirit items."
                      >
                        <span aria-hidden>↗</span>
                        Scales with Spirit Power
                        {damageScalePerSpirit > 0
                          ? ` · +${damageScalePerSpirit} damage per Spirit`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
