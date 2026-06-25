# Fairfax Industries

**Proving Ground** — a theorycrafting sandbox for [Deadlock](https://playdeadlock.com).
Pick a hero, build a loadout, choose a target, and see exactly how much damage you deal:
weapon DPS, ability and DoT damage, burst, time-to-kill, resists, and item upgrade paths,
all computed live.

> **Fan project.** Not affiliated with or endorsed by Valve. Deadlock is a trademark of
> Valve Corporation. Game data comes from the community-run
> [deadlock-api.com](https://deadlock-api.com).

<!-- 🔗 Live: https://fairfax.industries (not yet hosted) -->
<!-- Add a screenshot or GIF here once hosted — it's the single biggest thing for a public repo. -->
<!-- ![Proving Ground](docs/screenshot.png) -->

## Features

- **Attacker vs. target simulation** — every number reflects the target's real defenses, not base stats.
- **Item shop** with the full live item pool, search, tiers, and rich in-game descriptions.
- **Upgrade paths** — buying an upgrade collapses its components (Rapid Rounds → Swift Striker), so souls and stats never double-count.
- **Give the target a build too** — toggle who you're buying for; their health and resists feed the damage math.
- **Base resists & innate traits** — per-hero spirit resist, per-level resist growth, and headshot/crit damage reduction (e.g. Seven).
- **Damage-over-time modeling** — sustained DoT/sec, a realistic 0.5s burst slice, and full "if they sit in it" totals.
- **Match level** — level the enemy to the attacker's level in one click, no items.
- **Shareable build links** — copy a self-contained URL; no account, no database, nothing to expire.

## Getting started

Requires [Bun](https://bun.sh).

```bash
bun install
bun run db:reset   # creates the SQLite schema and scrapes fresh game data (~10s)
bun run dev        # http://localhost:3000/proving-ground
```

`db:reset` is only needed on first run (or to wipe and re-pull). Day to day, `bun run dev` is all you need.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run sync` | Re-scrape heroes & items into the existing database |
| `bun run db:reset` | Drop the DB, recreate the schema, and sync from scratch |
| `bun run test` | Run the simulation engine tests |
| `bun run lint` | Lint |

## What's modeled

- **Weapon damage** with range falloff and bullet-resist mitigation
- **Ability damage** (direct + DoT) with spirit-resist mitigation and spirit-power scaling
- **Souls → level** scaling and per-category investment bonuses (weapon / vitality / spirit)
- **Resistances** — base, per-level growth, and asymptotic (diminishing) item stacking
- **Headshot/crit** bonus damage and per-hero crit-damage-taken reduction
- **Item upgrade trees** reconstructed from the API's component data

## Under the hood

The damage math lives in a single, dependency-free engine (`src/lib/sim`) — no React, no
database, just pure functions. `simulate(build, target, opts)` returns every number the UI
shows, and it's covered by tests.

Game data is scraped once and **cached** in a local SQLite database via
[`scripts/sync-deadlock-api.ts`](scripts/sync-deadlock-api.ts). The website reads from that
database and never calls the upstream API on a page load, so site traffic generates no load
on the community API — it's only touched when you run `sync`.

Builds are shared statelessly: a build (both heroes, both loadouts, scenario settings) is
packed into a short URL-safe code, so the link *is* the storage — no database of builds.
Items and heroes are referenced by a stable, name-sorted index rather than database id, so
links keep working across data refreshes. See [`src/lib/build-code.ts`](src/lib/build-code.ts).

## Tech stack

[Next.js](https://nextjs.org) (App Router) · React · TypeScript · [Drizzle ORM](https://orm.drizzle.team)
+ SQLite · [Tailwind CSS](https://tailwindcss.com) · [Bun](https://bun.sh)

## Project structure

```
src/
  app/                 Next.js routes (/, /proving-ground)
  components/          UI — proving-ground, buy-menu, …
  lib/
    sim/               The damage engine (pure, tested) — engine, tables, types
    build-code.ts      Stateless build-link encode/decode
  db/                  Drizzle schema + client
scripts/
  sync-deadlock-api.ts Scrapes heroes & items into SQLite
docs/
  api-sample/          Captured API snapshots for reference
```

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for where this is headed — the near-term themes are
mobile/touch support, trust surfaces (methodology + data-freshness), hosting, and deeper
engine work. It's a living list of ideas, not commitments.

## Status & contributing

This is a hobby project, maintained best-effort by one person — issues and pull requests are
welcome, but may be reviewed slowly, and there's no guarantee of support or that any given
idea gets built. If you'd like to contribute, opening an issue to discuss first is the
surest way to land a change.

## Credits

- Game data: the community [deadlock-api.com](https://deadlock-api.com) project.
- Deadlock © Valve Corporation. This is an unofficial, non-commercial fan tool.

## License

[MIT](LICENSE) — use it, fork it, build on it. The license covers this project's code only;
Deadlock's names, stats, and art remain the property of Valve Corporation.
