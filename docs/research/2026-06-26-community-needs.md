# Deadlock theorycrafting site — community/market research

*Compiled 2026-06-26. Question that prompted it: a top-rank player friend said the site "seems kind of useless — the info is stuff high-ranked players already know." This report tests that critique and looks for unmet community needs a two-sided theorycrafting simulator could own.*

> **Signal caveat up front:** Reddit indexed poorly through web search (several r/DeadlockTheGame queries returned nothing crawlable), so a chunk of evidence comes from forums.playdeadlock.com, Steam discussions, the Deadlock wiki, and creator/guide sites. Items flagged "inferred" are directional, not quoted.

## The short version

The friend's critique is **fair against a single-build DPS/EHP calculator** — that category is already crowded (deadlockcalc.com, deadlock-calculator.vercel.app, deadlab.gg, Statlocker), and that information genuinely is internalized at top rank. It is **weak against the two things this tool uniquely does**: the *attacker-vs-target* combat model and *counter-target* modeling. The genuinely unmet, non-memorizable needs cluster around **matchup-specific and patch-churning questions** ("does my build kill *this* enemy build before they kill me, *this* patch") rather than static facts.

**Positioning recommendation:** stop competing on "calculate my build's stats"; compete on **"win the matchup."**

## 1. Top unmet needs / complaints (ranked)

### 1. "Will my build actually kill *that* specific enemy, and who dies first?" — two-sided combat math (STRONG)
Every existing calculator models **one build in a vacuum**: your DPS, your EHP. None resolve a *duel* — your DPS vs their resists/EHP and their DPS vs your EHP simultaneously to produce a real time-to-kill race. Even strong players compute this fuzzily because doing it by hand means juggling both kits, resist diminishing-returns, and falloff at once.
- The laning meta is framed as trade/all-in/sustain *races*, but with the explicit caveat that "individual builds can have a drastic impact on outcomes" ([Mobalytics matchups](https://mobalytics.gg/deadlock/tier-list/matchups), [BoostRoom laning guide](https://boostroom.com/blog/deadlock-laning-guide-solo-vs-duo-lanes-matchups-and-tempo)).
- **Survives the objection:** experts know the *heuristics* ("Yamato wins duels"), not the exact TTK delta once both sides itemize. The answer changes every time either build changes — un-memorizable by construction.

### 2. Counter-building against a live enemy lineup (STRONG)
The single most-repeated coaching point in 2026 itemization content: **copying a static build is a mistake because the opponents change.** Players know they *should* counter-build and *which* item counters *what* directionally; they do **not** compute *how much* a counter item actually shifts the matchup.
- [BoostRoom – common mistakes](https://boostroom.com/blog/5-common-deadlock-mistakes-holding-you-back-and-fixes-that-work) ("the players who climb fastest learn a build *system*, not one build per hero"); [esportsinsider counter guide](https://esportsinsider.com/deadlock-guide-to-counter-every-hero); [Carrylord meta](https://carrylord.com/deadlock/top-builds-power-spikes-and-counter-buys/).
- **Survives the objection:** "does buying Toxic Bullets (55% heal-reduction) actually flip this specific TTK race?" is the calc nobody does by hand. The attacker/target model can show the before/after flip.

### 3. Opaque resist / EHP / diminishing-returns math (STRONG)
Resist stacks diminishingly, debuffs apply first as flat reductions, and negative-base-resist heroes have hard ceilings — counterintuitive results that high-rank players argue about and miscompute.
- [Spirit Resist Scaling thread](https://forums.playdeadlock.com/threads/spirit-resist-scaling.36664/): worked example "1 − 45% = 0.55 − 15% = 0.4675 − 12% = 0.4114 → 58.86% spirit resist," and the finding that Pocket (negative base) caps ~84% resist no matter how many items he buys while McGinnis can approach 99%.
- The 2026 patch made it *worse to memorize*: damage-reduction debuffs now stack **diminishingly instead of additively** ([deadlock.wiki 05-22-2026](https://deadlock.wiki/Update:May_22,_2026), [deadlockpatchnotes](https://www.deadlockpatchnotes.com/patches/05-22-2026-update)); Bullet Velocity flipped to additive — so the "shred deletes resist" intuition is now wrong.
- **Survives the objection hard:** this is the "feels like I know it but the number says otherwise" zone. EHP-vs-a-given-attacker is a killer feature.

### 4. Hidden damage decimals, tick mechanics, and falloff tooltips don't show (STRONG)
Displayed DPS is provably wrong vs measured DPS, by 2–12% across heroes, because of hidden decimals and undocumented mechanics.
- [Spirit Scaling and Damage Investigation](https://forums.playdeadlock.com/threads/spirit-scaling-and-damage-investigation.68241/): "spirit scaling is hiding a few decimal points"; Bebop Hyper Beam shows 273 DPS but does 250.42; Infernus Flame Dash has an undocumented +1s linger; a hidden 0.75 close-range multiplier. The author asks for peer review — i.e. **players want a tool to do this for them.**
- Bullet falloff: 100% within 40m, 90% past 41m ([falloff thread](https://forums.playdeadlock.com/threads/falloff-bullet-damage-is-90-on-very-short-distance-and-target-locking-on-csing.113212/)).
- **Survives the objection:** if the in-game tooltip is wrong, "experts already know it" can't be true — they know the wrong number.

### 5. Patch-churn: "what changed and how does it affect *my* build" (MEDIUM–STRONG)
Patches are large and frequent — May 22 2026 had 76 item + 33 hero + 52 gameplay changes; June 11 had 19 hero + 2 item + 5 gameplay ([deadlocklabs patches](https://deadlocklabs.gg/patches/)). Players track *what* changed but nobody tells them *how their saved build's numbers moved.*
- **Survives the objection by nature:** new every patch. A live-data sim that re-computes saved builds (`/b/<code>`) is the strongest structural answer to "facts go stale."

### 6. In-game build/itemization UI is genuinely disliked (MEDIUM)
- Build browser is buggy/clunky — builds don't appear until you manually "Browse Builds" ([forum thread](https://forums.playdeadlock.com/threads/builds-dont-show-up-in-game-unless-you-hit-browse-builds-on-the-hero-first.4323/)).
- UI called "far too disorganized"; players say you can see per-spell damage but **"not your overall stats"** ([Steam discussion](https://steamcommunity.com/app/1422450/discussions/0/600778060484094777/)) — an explicit ask for an aggregated stat panel, which the tool has.
- Item-shop decision fatigue with ~173 items is plausible but direct evidence was thin (inferred).

### 7. Weapon-DPS optimization is computed manually (MEDIUM)
Players hand-build "max DPS" setups and argue fire-rate vs raw damage, headshot breakpoints, ramp items ([1v9 max weapon build](https://1v9.gg/blog/deadlock-max-weapon-damage-build), [Steam "Highest gun dps?"](https://steamcommunity.com/app/1422450/discussions/0/6404770483182604371/), [wiki DPS](https://deadlock.wiki/Damage_per_second)). Conditionals like Intensifying Magazine's ramp are exactly what hand-math gets wrong. Partly vulnerable to the objection (existing calcs do single-build DPS too) — a feature-table item, not a differentiator.

## 2. Competitive landscape — gap map

| Tool | What it does | What it does NOT do |
|---|---|---|
| **deadlockcalc.com** | Build planner, real-time DPS/EHP, item-condition toggles, level/ability scaling, shareable builds, tier list | Single build in isolation; no opponent; no duel/TTK race; no counter modeling |
| **deadlock-calculator.vercel.app** | Items + purchase routing, imbue assignment, level/souls/stat checkpoints, ability upgrade breakpoints, TTK | TTK vs a generic dummy, not a *built* enemy |
| **deadlab.gg** | "Build Calculator" (couldn't load — DNS failed at fetch; likely same category) | Unknown, likely same gap |
| **Statlocker** | Stats tracker, Eternus item paths/ability orders, community build library, tier lists, public API | Descriptive (what winners did), not prescriptive sim; no matchup math |
| **Tracklock** | Match tracking, hero win-rates, "Pocket Pro" builds, opponent tagging | Tracker, not a calculator |
| **Mobalytics / deadlocktracker.gg** | Aggregated highest-winrate builds, patch notes, matchup tier list | Aggregate stats, no custom combat sim |
| **deadlock-api.com** | Open data backend (win-rates, item stats, ability paths), drop-in shop components | Data layer, not a player-facing theorycrafter |

**The white space is unambiguous:** every theorycrafting tool is **one-sided**; every "matchup" product is **empirical win-rate aggregation**. **Nobody simulates build-A-vs-build-B combat** — the lane this tool already occupies. Static DPS/EHP is **table stakes you must match but cannot win on.**

## 3. Concrete opportunities for the simulator

**Lean on what already exists (highest ROI — differentiators):**
- **Lead with the duel, not the build.** Reframe the headline value as "see who wins this matchup." The attacker-vs-target model + TTK + execute thresholds is the one thing no competitor has. (Need #1)
- **Counter-build mode.** Lock an enemy build, then surface which counter items most shift the TTK race ("Toxic Bullets flips this from a loss to a win at min 18"). Leans on counter-target modeling + item procs. (Need #2)
- **EHP-vs-this-attacker panel.** Effective HP against the specific enemy's damage profile, with correct diminishing-returns + debuff-ordering math baked in (incl. the 2026 diminishing-debuff change and negative-base-resist ceilings). (Needs #3, #4)
- **"This patch changed your build" diff.** Re-run a saved `/b/<code>` build on the new patch and show what moved. (Need #5)

**Net-new but high-value:**
- **Breakpoint finder** ("how much Spirit until rank-2 of X one-shots a 600-HP target", "fire-rate breakpoint where Build A out-DPSes Build B") — productizes the spreadsheet behavior. (Needs #4, #7)
- **Trust signal: "real numbers, not tooltip numbers."** Publicly note where the tool corrects known tooltip lies (hidden decimals, linger durations, falloff) — a credibility wedge with skeptical high-rank players.

## 4. Direct answer to the friend's critique

**Is "useless for high-rank" fair?** Partly, and narrowly. It's fair *if* the site reads as "another DPS/EHP calculator," because that info is internalized at top rank and the category is crowded. If the front door shows a single build's stat panel, the reaction is rational.

**It's wrong about the parts that matter:**
1. **Two-sided matchup math is not "known."** Top players know heuristics; they don't hand-compute the TTK race between two specific itemized builds, or exact EHP against a specific attacker after diminishing-returns and debuff ordering. The resist and spirit-scaling forum threads — written by clearly advanced players asking for help — prove even the dedicated can't reliably do this by hand.
2. **The tooltips are wrong** (2–12% DPS error, hidden linger/decimals). You can't "already know" a number the game misreports.
3. **Counter-building and patch-churn are non-memorizable by design.** A live-data sim is the only thing that stays current; human memory is exactly what goes stale.

**Audience:** don't abandon high-rank — they'll respect a corrected-numbers matchup sim. But the *broadest* demand (itemization paralysis, "what do I buy vs this team," clunky in-game UI, "I copy a build and it's wrong because opponents change") sits at **mid-rank**, where counter-build and matchup features are *educational*, not just confirmatory. Best play: an *edge* for experts (corrected math, breakpoints) and a *teacher* for mid-rank (counter-build, "who wins"), on the same two-sided engine.

## 5. Caveats / signal honesty

- **Reddit was under-sampled** — web search failed to surface crawlable r/DeadlockTheGame threads for several pointed queries. Direction corroborated by forums/Steam/creator content; itemization-paralysis (#6) and "compute by hand" (#7) are partly inferred.
- **SPA competitors didn't render** in fetch (deadlock-calculator returned only a title; deadlab.gg failed DNS). Their feature lists come from search snippets — verify deadlab.gg and deadlock-calculator firsthand before treating the gap map as final.
- **deadlock.io resist article 403'd**; resist mechanics sourced from the forum thread + wiki patch notes (reliable but secondhand on exact current formulas).
- **No direct evidence** that a two-sided combat sim has been *explicitly requested* — the white space is inferred from (a) absence of such a tool and (b) abundant demand for the questions it answers. Strong inference, not a quoted "please build this."
- **Patch specifics** are current as of the June 11 2026 patch per deadlocklabs; verify against the live API before shipping numbers.

### Key sources
[spirit scaling investigation](https://forums.playdeadlock.com/threads/spirit-scaling-and-damage-investigation.68241/) · [spirit resist scaling](https://forums.playdeadlock.com/threads/spirit-resist-scaling.36664/) · [deadlockcalc builder](https://www.deadlockcalc.com/builder) · [deadlock-calculator](https://deadlock-calculator.vercel.app/) · [Statlocker builds](https://statlocker.gg/builds/build-library) · [Tracklock](https://tracklock.gg/) · [deadlock-api GitHub](https://github.com/deadlock-api/deadlock-api) · [BoostRoom mistakes](https://boostroom.com/blog/5-common-deadlock-mistakes-holding-you-back-and-fixes-that-work) · [esportsinsider counters](https://esportsinsider.com/deadlock-guide-to-counter-every-hero) · [deadlock.wiki 05-22-2026](https://deadlock.wiki/Update:May_22,_2026) · [deadlocklabs patches](https://deadlocklabs.gg/patches/) · [in-game build browser complaint](https://forums.playdeadlock.com/threads/builds-dont-show-up-in-game-unless-you-hit-browse-builds-on-the-hero-first.4323/)
