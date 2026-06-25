# Deadlock API sample

Snapshot of the community **deadlock-api** assets feed that `scripts/sync-deadlock-api.ts`
scrapes, captured so you can browse the raw shape and decide what we should pull and what
counts as a "live" item. Regenerate any time by re-running the scraper's fetch.

## Endpoints

| What | URL |
| --- | --- |
| Items / upgrades | `https://api.deadlock-api.com/v1/assets/items` |
| Heroes | `https://api.deadlock-api.com/v1/assets/heroes?only_active=true` |

At capture time: **726** total item entries (251 are weapon/vitality/spirit *upgrades*), **38** heroes.

## Files here

- **`alchemical-fire.raw.json`** — one complete, untouched item entry (the weapon item you
  named). Every field the API returns, including the rich description and `tooltip_sections`.
- **`hero-example.raw.json`** — one complete hero entry (Infernus) for the same purpose.
- **`items-overview.json`** — all 251 weapon/vitality/spirit upgrades, trimmed to the fields
  that matter for sorting live-vs-junk, with the description HTML stripped to plain text
  (`descText`). Each row also flags `keptByCurrentScraper` vs `isLive`.
- **`leaked-nonlive-items.json`** — the 15 entries the current scraper keeps but that are
  **not** live (the testers/leftovers you've been seeing).

## Live vs. not-live

The current scraper keeps an item if it's an `upgrade`, slotted weapon/vitality/spirit,
not tier 5, has a localized name, and has shop art. That still lets **15 dead items**
through (e.g. `Glass Cannon v2`, `Majestic Leap - Disabled`, `Soul Explosion`).

The reliable signals the API exposes (and the scraper currently ignores):

- **`shopable`** — `true` for 173 upgrades, `false` for 78. False = not buyable in the live shop.
- **`disabled`** — `true` for 78 upgrades. These are removed/test entries.
- **`item_tier === 5`** — the alternate-mode (Breakneck) pool, already excluded.

`shopable === true && disabled !== true && item_tier !== 5` ⇒ **156 live items** (vs 171 today).

## The description gap

The scraper stores `it.description`, but `description` is an **object**, not a string:

```json
"description": { "desc": "Throw a flask that explodes on contact … <svg>…</svg> spirit damage per second and reduces enemy Bullet Resist.<br><br>50% less effective vs non-heroes." }
```

So today's `typeof it.description === "string"` check stores `null`, and the shop tooltip
doesn't render descriptions at all. The real write-up lives in:

- **`description.desc`** — full prose, but laced with inline `<svg>` icons and
  `<span class="…">` / `<br>` markup that needs stripping or sanitizing.
- **`tooltip_sections`** — the structured, per-stat breakdown the in-game card shows.

To get the longer in-game write-ups, we'd pull `description.desc` (strip the HTML/SVG, or
keep a sanitized subset) and optionally fold in `tooltip_sections`.
