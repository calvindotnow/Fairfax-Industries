import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const included = [
  {
    title: "Weapon damage",
    body: "Damage per shot × your shot count, with the headshot (crit) bonus applied to the headshots you specify.",
  },
  {
    title: "Ability damage",
    body: "Each ability's damage at the current level. Ultimates are off by default — most heroes don't ult in a burst — but toggle any ability on or off.",
  },
  {
    title: "Damage over time",
    body: "DoT is broken out three ways: applied per second, a 0.5s slice folded into the burst total, and the full amount if the target sits in it for the whole duration.",
  },
  {
    title: "On-hit & conditional procs",
    body: "Per-shot and conditional item procs (e.g. range-gated weapon bonuses) count toward both the burst total and sustained DPS (a proc fires every cooldown, capped at your fire rate).",
  },
  {
    title: "Melee damage",
    body: "Light and heavy melee, including each hero’s per-level growth (some ramp faster — Abrams scales harder than most), reduced by the target’s bullet resist. Shown separately, not folded into the burst total.",
  },
  {
    title: "Target resistances",
    body: "Per-hero base bullet and spirit resist, per-level resist growth, and headshot/crit damage-taken reduction (some heroes simply take less). Incoming damage is reduced accordingly.",
  },
  {
    title: "Effective HP",
    body: "Both fighters show effective HP — raw health scaled by resistance — so a burst is always measured against what it actually has to chew through.",
  },
];

const excluded = [
  {
    title: "Item stacking buffs",
    body: "Stacks-over-time items (bonuses that build up as you fight) aren't modeled yet — the data doesn't expose per-stack values. Their flat and percentage stats still count.",
  },
  {
    title: "Active-item combos",
    body: "Active items as explicit combo steps aren’t sequenced yet. Their passive flat/percentage stats still count.",
  },
  {
    title: "Some melee detail",
    body: "Melee covers base + per-level scaling, but not yet its +50% Weapon-Damage scaling, melee-damage items, or the separate Melee-Resist stat.",
  },
];

export default function MethodologyPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section className="max-w-2xl">
        <Link
          href="/hideout"
          className="group mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Back to New Build
        </Link>
        <p className="overline mb-5">Methodology</p>
        <h1 className="font-display text-4xl leading-[1.05] text-foreground md:text-5xl">
          How the numbers are made
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Fairfax shows its work. Every damage figure comes from one shared
          engine that runs your build against a real enemy’s resistances using
          current patch data. Here’s exactly what it counts, what it doesn’t
          yet, and why a few choices are deliberate.
        </p>
      </section>

      {/* Included */}
      <section className="space-y-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl text-foreground">What’s counted</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Everything below is computed from the live data and folded into the
            results you see on a build.
          </p>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
          {included.map((f) => (
            <div key={f.title} className="bg-background p-6">
              <h3 className="text-lg text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Two deliberate choices */}
      <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
        <div className="bg-background p-6">
          <p className="overline mb-3">How resistances work</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Damage isn’t applied raw. The target’s bullet and spirit resist —
            base, plus per-level growth, plus any items — scales down incoming
            weapon and ability damage separately. A build that shreds one enemy
            can stall against another’s resist profile, which is the whole point
            of testing the matchup.
          </p>
        </div>
        <div className="bg-background p-6">
          <p className="overline mb-3">How level is derived</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            There’s no level slider, and that’s intentional. Your level is read
            from the souls your build costs — it’s the level you’d actually be at
            that net worth. Buying an upgrade collapses the components it’s built
            from, so souls and stats are never double-counted.
          </p>
        </div>
      </section>

      {/* Not yet */}
      <section className="space-y-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl text-foreground">
            Not modeled yet
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Stated plainly, because trusting the numbers means knowing their
            edges. This is theorycraft math, not a replacement for the practice
            range — treat it as a fast, honest approximation where the game is
            opaque.
          </p>
        </div>
        <div className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
          {excluded.map((f) => (
            <div key={f.title} className="bg-background p-6">
              <h3 className="text-lg text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Changelog */}
      <section className="max-w-2xl space-y-4">
        <h2 className="font-display text-2xl text-foreground">Changelog</h2>
        <ul className="space-y-4">
          <li className="surface p-5">
            <p className="font-display text-sm tracking-wide text-primary">
              2026-06-25
            </p>
            <p className="mt-1 text-base text-foreground">
              Initial methodology published.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Documents the model as it stands today: damage-over-time, base
              resists and innate traits, attacker- and target-side effective HP,
              headshot/crit damage reduction, item upgrade-path collapse,
              souls-derived level, and stateless share links. Ultimates ship off
              by default in the burst.
            </p>
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Found a number you can’t reproduce?{" "}
          <Link href="/hideout" className="text-primary hover:opacity-90">
            Open a build
          </Link>{" "}
          and check it against the breakdown — the engine is the source of truth.
        </p>
      </section>
    </div>
  );
}
