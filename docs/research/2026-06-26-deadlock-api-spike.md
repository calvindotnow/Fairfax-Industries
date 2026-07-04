# deadlock-api.com analytics spike — Phase 1 / Lane Lab data layer

*Live spike, 2026-06-26. Validates the analytics endpoints Lane Lab needs and sets the baked
schema + bundle budget. All calls unauthenticated, HTTP 200. Verdict: **no blockers** — every
endpoint we assumed exists, returns usable data with large samples, and keys on the same
hero/item/ability IDs we already sync from `/v1/assets/*`.*

## Endpoints (all under `https://api.deadlock-api.com`)

| Dataset | Endpoint | Key fields | Sample sizes | Raw / gzip |
|---|---|---|---|---|
| **Hero counter** | `/v1/analytics/hero-counter-stats` | `hero_id, enemy_hero_id, wins, matches_played` (+ KDA/econ) | 5.8k–58k per pair (median ~19k) | 567 KB / ~78 KB |
| **Hero synergy** | `/v1/analytics/hero-synergy-stats` | `hero_id1, hero_id2, wins, matches_played` (per-hero `…1/…2`) | ≥6k per pair | 254 KB / ~35 KB |
| **Item stats** | `/v1/analytics/item-stats` | `item_id, wins, losses, matches, players, avg_buy_time_s, avg_buy_time_relative` | large | 1.4 MB / ~193 KB (all heroes, `bucket=hero`) |
| **Counter items** | `/v1/analytics/item-stats?enemy_hero_ids=` | same, filtered to "items vs enemy hero Y" | ~38k per pair | ~35 KB/pair; **49 MB if all 38×38** |
| **Ability order** | `/v1/analytics/ability-order-stats?hero_id=` | `abilities[16], wins, losses, matches, players, total_k/d/a` | thousands | 240 KB/hero full; **top-10/hero = ~15 KB gzip all** |
| **Build path** | `/v1/analytics/item-flow-stats` | nodes w/ `avg_net_worth_at_buy` per 4 phases; edges | huge | **1.9 MB/hero, 73 MB all → infeasible full** |

Winrate = `wins / matches_played` (counter/synergy have no `losses` field; item-stats does).

## Shared filter params (confirmed, exact names)

`min_average_badge`/`max_average_badge` (0–116, rank bracket) · `game_mode` (`normal`|`street_brawl`|…) ·
`min_unix_timestamp`/`max_unix_timestamp` (patch window; **default = last 30 days**) or `min/max_match_id` ·
`min_matches`/`max_matches` (sample floor; default 20) · `same_lane_filter` (bool; default **true** on
counter/synergy, **false** on item-stats) · `min/max_duration_s` · `min/max_networth`.

Item-stats extras: `enemy_hero_ids` (comma list — "what beats hero(es) Y"), `enemy_hero_ids_all_match`,
`min/max_bought_at_s` (timing window), `item_order` (a purchase-**ordering** constraint needing ≥2 ids —
NOT an ordinal-slot filter), `bucket` (`hero`/`team`/`game_time_min`/`net_worth_by_1000`/…).

## ID alignment (confirmed — no mapping layer needed)

- **Hero ids** match `/v1/assets/heroes` (Seven = 2 both places).
- **Item ids** match `/v1/assets/items` (e.g. 1009965641 = Monster Rounds, 7409189 = Improved Spirit).
- **Ability ids** in `ability-order-stats.abilities[]` are item-ids of `type=ability`, resolved via
  `GET /v1/assets/items/by-hero-id/{hero_id}` filtering `type=ability` (there is **no** separate
  abilities endpoint — `/abilities` 404s). Add this call per hero to the sync to build a name map.

## Auth / rate limits

Public reads need no auth. Headers: `ratelimit-limit: 200`, `ratelimit-period: 60`. Tiers: **200 req/min**
unauth, 400 with `X-API-KEY`, 2000 global. A sync of ~76 calls (flow + ability-order per 38 heroes)
finishes in <30s. Grab a free key for headroom + good citizenship; consider sponsoring.

## Recommended baked schema + budget

Bake a **separate `src/lib/lane-lab-data.json`** (NOT into `baked-data.json`, to cap the main bundle),
keyed by dataset:

```jsonc
{
  "counter_stats":  [ /* 1,406 directed pairs, same-lane, min_matches=100 */ ],
  "synergy_stats":  [ /*   703 undirected pairs, same-lane, min_matches=100 */ ],
  "ability_orders": { "<hero_id>": [ /* top-10 by matches, min_matches=50 */ ] },
  "item_stats":     { "<hero_id>": [ /* bucket=hero, min_matches=200, ~150 items */ ] },
  "counter_item_stats": { "<hero_id>": { "<enemy_id>": [ /* curated — see decision */ ] } }
}
```

- **CORE** (counter + synergy + ability-orders top-10 + hero-level item-stats): **~2.3 MB raw / ~321 KB gzip.** Comfortable for a `/hideout`-only JSON.
- **+ enemy-specific counter items**: depends on curation (the one real decision below).

**Curation thresholds:** `min_matches=100` (counter/synergy), `200` (item-stats), `50` (ability-orders, top-10/hero).

## Decisions this surfaces for the Lane Lab v1 spec

1. **Counter-item chip granularity (the key one).** "Good vs Seven" *item* chips need the
   `enemy_hero_ids` data, but all 38×38 pairs is 49 MB raw — not bakeable. Options:
   - **(a) Top-N counter items per all pairs** — e.g. top-8 items/pair → est. ~2.6 MB raw / ~370 KB gzip; gives enemy-specific chips for *every* matchup.
   - **(b) Top-5 worst matchups per hero only** (~6.5 MB raw / ~930 KB gzip) — enemy-specific only for your hardest lanes; elsewhere fall back to hero-counter-stats winrate.
   - **(c) v1 = hero-level item-stats only** (193 KB gzip) — "popular/winning items on your hero," NOT enemy-specific (weakest; defeats the counter pitch).
   Recommendation: **(a)** — enemy-specific everywhere at a modest size.
2. **Build-path (Lane Lab v2) curation.** Full `item-flow-stats` is 73 MB. Bake **top-20 nodes/phase, no edges** (~600 KB, uses `avg_net_worth_at_buy` as the souls signal) or approximate with `avg_buy_time_s` from the CORE item-stats. Defer to v2.
3. **Synergy scoring** needs a baseline: compare pair `wins/matches_played` against each hero's solo winrate (from `/v1/analytics/hero-stats`) to label "good with X."
4. **No causal counter score** — item `wins/matches` is "won while holding it," not a controlled counter metric. Present as a winrate-vs-baseline delta with sample size, honestly.

## Sync impact

Extend `scripts/sync-deadlock-api.ts`: + ~5 analytics fetches (counter, synergy, item-stats bucket=hero,
per-hero ability-order, per-hero by-hero-id ability map) + curated counter-item fetches; write
`lane-lab-data.json`; add accessors to `src/lib/data.ts`; the daily Action commits it on change.
