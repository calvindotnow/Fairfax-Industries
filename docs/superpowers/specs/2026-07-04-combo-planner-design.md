# Combo Planner — 1v1 kill-sequencer (design, spec-only)

*Track F2 from `docs/superpowers/plans/2026-07-04-open-upgrades-agent-handoff.md` (Tier F, owner
go-ahead required). This is a **spec-only** deliverable — no code was written or changed. It exists so
the owner can approve, reduce, or reject the feature before any implementation session begins.*

*One-line brief (from the dispatch doc): "extend the execute math into a 1v1 kill-sequencer (abilities
- bullets to a threshold), distinct from the **PARKED** combined-damage 2v2 solver — which stays
parked."*

---

## 0. The owner reads this first — decision framing

**The product question.** "Can I secure this kill?" Given my build vs this target: what *sequence* of my
abilities + bullets (+ item actives) reaches the kill threshold (including %-HP execute windows), from
what starting HP, and how long does it take? Today `simulate()` returns a **simultaneous lump** burst
plus a static execute line (`ExecutePanel`). A planner makes **order and timing** first-class.

**Trade-offs:**

- **Value — real but narrow, and thinner than it looks.** The honest win over intuition is *not* "how
  much damage" (the burst total already answers that) — it's **timing**: "your combo takes 3.4s, of
  which 2.1s is waiting on a second Q charge; the target out-heals you if the fight runs past 2.6s."
  That's a genuine insight players don't compute in their heads. But — see the roadmap's own critique
  that pros *"already know this"* — the *order* of a 3-ability burst is usually obvious to the player
  who owns the hero; where a sequencer beats intuition is (a) **charge/cooldown gating** (can I fit two
  casts before this window closes?) and (b) **execute-window sequencing** (does bullet-then-ability
  cross the 15%-execute line that ability-then-bullet doesn't?). Narrow, but the one place the "they
  already know" critique weakens.

- **Cost — Medium** (engine) **+ Medium** (UI), per §3. One new pure function
  (`planCombo`) over existing burst/execute pieces, plus a timeline UI. **No** engine structural
  change (unlike the 2v2 solver) and **no** new baked data. The main cost is the UI surface + the
  honesty scaffolding the accuracy moat demands.

- **Risk — the timing-model credibility gap is real and load-bearing.** The data we sync carries
  cooldowns, charges, durations, DoT tick-rates, fire rate — **but no cast times, windups, or travel
  time** (confirmed on deadlock.wiki, §2). A v1 timing model must assume **casts are instantaneous**,
  which makes every "time-to-kill" **optimistic by roughly 0.3–1.2s per cast**. For a tool whose entire
  moat is *trustworthy numbers*, a confidently-wrong 3.4s is worse than no number. The caveat cannot be
  fine print — it has to be structural in the UI (§2, §4).

- **Recommendation — BUILD-REDUCED.** Do **not** ship "time-to-kill in seconds" as a headline number in
  v1. Ship the sequencer as an **ordering + gating** tool: an ordered combo builder that (a) resolves
  the burst *in sequence* so execute windows are evaluated at each step (the one thing that's exactly
  correct with the data we have), (b) surfaces **cooldown/charge feasibility** ("this needs 2 casts of Q
  but you have 1 charge — the second is +6.0s away"), and (c) reports timing as an explicit **lower
  bound** ("≥2.1s of cooldown/fire-rate gaps, before cast animations") — never a precise wall-clock. This
  keeps every number defensible, delivers the real insight (gating + execute-order), and defers the
  seconds-precise TTK until/unless cast-time data exists. Full seconds-accurate TTK is a **don't-build-yet**
  until the data gap closes.

**If the owner wants one sentence:** build the ordering/gating sequencer that grows out of `ExecutePanel`;
report timing as a labelled lower bound, not a wall-clock; revisit precise TTK only if cast-time data
becomes available.

---

## 1. Product scope

**Strictly 1v1.** The combined-damage **2v2 combo solver stays parked** — this spec does not touch it.
The roadmap parks it for structural reasons (multi-attacker is a structural engine change, sequencing/
timing is hard to model, synergy data is hero-keyed so it can't validate combo *builds*). This feature
is the *single-attacker* slice: one build, one target, order-aware. It deliberately inherits none of the
2v2 solver's blockers except the timing one, which §2 confronts head-on.

**What the user manipulates — a sequence builder (recommend), not an auto-optimizer, for v1.**
Two candidate interaction models:

- **(A) Manual sequence builder** — the user drags/clicks their abilities, bullet-bursts, and item
  actives into an ordered strip ("Q → 4 bullets → Ult → melee"). The planner resolves each step against
  the running target HP and reports where execute windows are crossed and where cooldown/charge gaps
  open. *This is the recommended v1.*
- **(B) Auto-suggest optimal order** — the planner searches permutations of the equipped kit for the
  order that crosses the kill threshold soonest / from the highest starting HP.

**Recommend (A) for v1, with (B) explicitly deferred.** Reasons:
1. (B)'s "optimal" is only as trustworthy as the timing model — and the timing model is the weak link.
   Auto-ranking sequences by a wall-clock we've admitted is optimistic launders a caveat into a
   ranking, exactly the credibility failure the moat can't afford.
2. (A) is honest: the *user* asserts the order; the planner *evaluates* it. Every number shown is a
   consequence of the user's stated plan, not a claim about the "best" plan.
3. (A) reuses the existing burst/execute math almost wholesale (§3); (B) needs a search + a scoring
   function that bakes in the timing assumptions.
4. Matches the app's established stance ("empirical proposes, the sim proves"; the calculator resolves
   *your* stated build, it doesn't auto-build for you).
   *(B) is a clean fast-follow once (A)'s timing model is trusted — same "bounded search over a pure
   function" shape as the counter recommender.)*

**What the user reads:**
- **Kill secured from HP ≥ X%** — the highest target starting-HP fraction at which the stated sequence
  still kills (crossing a `kind:"kill"` execute line counts as a kill). This is the headline and it is
  **fully defensible** — it's pure damage accounting, no timing.
- **The sequence timeline** — each step as a chip, the running target-HP bar after each step, execute
  lines marked (reusing `ExecutePanel`'s bar), and a marker where a step is **gated** (waiting on a
  cooldown/charge/reload).
- **Time-to-execute — as a labelled lower bound**, e.g. "≥2.1s (cooldown/fire-rate gaps; excludes cast
  animations — real time is longer)." Never a bare "3.4s." See §2/§4.
- **Feasibility flags** — "needs 2× Q, you have 1 charge (next +6.0s)", "reload after shot 8 (+X.Xs)".

**Where it lives — a mode/panel on the Damage Calculator (`/hideout`), NOT a dedicated surface.**
The damage-lane-split spec (`docs/superpowers/specs/2026-06-27-damage-lane-split-design.md`) split
`/hideout` into a Damage Calculator and a Lane Matchup surface, on the principle that a *4-entity lane*
doesn't belong crammed into the workbench's tab strip. That reasoning **argues for** co-locating the
combo planner with the Damage Calculator, not against:
- The combo planner is **1v1** — the exact attacker-vs-target scope the Damage Calculator already owns.
  It has none of the multi-entity layout pressure that justified the lane's own page.
- It is a **direct extension of `ExecutePanel`**, which lives on the Damage Calculator today. The
  planner is "the execute panel, but ordered" — it should grow where its seed already is.
- It reuses the calculator's entire build/target/scenario state (`useBuild`) with zero new entities.
  A dedicated route would duplicate that surface for no layout gain.

Concretely: a **"Combo" lens/tab** alongside Damage / Vitality / Spirit, or an expandable section that
*replaces* the current static `ExecutePanel` with the ordered version. Recommend the latter — it's an
in-place upgrade of an existing panel, lowest new surface area, and keeps the execute story in one place.

---

## 2. The timing model — the hard part (rigorous + honest)

This section is the whole ballgame. The accuracy moat means the timing model's caveats must be **part
of the UI design**, not a footnote.

### 2a. What we can model defensibly (data we HAVE)

Per-ability and per-weapon fields already flow through the engine (`AbilityRow`, `ComputedStats`,
resolved per rank via the `upgrades` profile):

| Quantity | Source | Defensible use in a timeline |
|---|---|---|
| **Ability cooldown** | `AbilityRow.cooldown` (per-rank) | Gate: a second cast of the same ability can't occur until `cooldown` after the first. |
| **Charges + charge cooldown** | `AbilityRow.charges`, `chargeCooldown` | Gate: N charges fire back-to-back; the (N+1)th waits `chargeCooldown`. |
| **Ability duration / DoT duration + DoT dps** | `AbilityRow.duration`, `dotPerSec`, `dotFull`, `dotDuration` | DoT contributes damage *over time* — a step can be "hold DoT for t seconds → +dps·t", and the timeline can advance real (lower-bound) time across a burn. |
| **Weapon fire rate** | `heroStats.weaponFireRate` | N bullets take `N / fireRate` seconds — the one genuinely time-accurate primitive (already used for `burstDuration` in `computeBurst`). |
| **Reload / mag** *(if synced)* | — *(not currently in engine; see gap)* | Would gate long bullet strings. |
| **Execute thresholds** | `abilityExecute()` (`pct`, `kind`) | Evaluated **at the running HP after each step** — the core new capability. Pure accounting, timing-independent. |

**The bullet timing and cooldown/charge gating are real.** A sequence that fires 8 bullets then waits
for Q's cooldown has a *defensible lower bound* on its duration: `8/fireRate + max(0, cooldown_gap)`.
That lower bound is honest and useful.

### 2b. What we CANNOT model (data the API does not carry)

**Confirmed by research (§ below): deadlock.wiki lists cooldowns, durations, charges, DoT tick-rates —
and no cast time, cast point, windup, or travel time anywhere.** The synced `properties`/`upgrades` JSON
carries no such fields either (grep of `baked-data.json` for `castTime|cast_time|windup|channel|
activation|chargeTime` → zero hits). So the following are **unmodelable from our data**:

- **Cast time / cast point / windup** — the animation delay before an ability's damage lands. Varies
  wildly (an instant Bebop hook vs a channeled ult). *This is the single biggest source of optimism.*
- **Travel time** — projectile/skillshot flight; a hook or a lob isn't instantaneous.
- **Animation lock / cast recovery** — the post-cast window before you can act again (fire, cast again).
- **Stun-lock / CC interaction** — "Q stuns 1.6s, so the target can't heal or escape during the combo"
  is a *real* combat fact (Abrams Seismic lists a 1.6s stun; Haze Sleep 2.75s) but modeling it means
  modeling the target's *reactions*, which the sim explicitly does not do (attacker-vs-static-target).

### 2c. The v1 timing model — stated assumptions

Model the **defensible subset** and label every timing number as a lower bound:

1. **Casts are instantaneous** (0 cast time, 0 windup, 0 travel, 0 recovery). *Effect: all times are
   optimistic; each cast that in reality has a windup makes the real combo ~0.3–1.2s longer. A 3-cast
   combo could be ~1–3s slower in practice.* → **This is why v1 must not headline a wall-clock TTK.**
2. **The target is static** — no movement, no healing during the combo, no escapes, no reactions. Same
   assumption `simulate()` already makes; the planner inherits it. (DoT-vs-heal is where it bites: a
   combo that "kills at 2.6s" on paper loses to a target regenerating past that.)
3. **Bullet timing is real:** N bullets = `N / fireRate` seconds. (The one exact primitive.)
4. **Cooldown/charge gating is real:** re-using an ability inserts `max(0, cooldown − elapsed)` of
   forced wait; charges deplete then wait `chargeCooldown`. These gaps are honest lower bounds.
5. **DoT accrues over its stated duration** at the resolved per-second rate; a "hold" step advances the
   (lower-bound) clock and adds `dotPerSec · t`.
6. **Damage is order-resolved, not lumped:** each step subtracts its mitigated damage from running HP,
   and each execute threshold is tested against HP *at that step* (so `kind:"kill"` lines can end the
   sequence early, and `kind:"bonus"` windows are flagged when entered).

**The UI consequence of these assumptions (accuracy-moat rule): the caveats are structural, not fine
print.**
- Every timing figure renders with a **"≥" prefix and a one-tap "why" note** ("Lower bound: cooldown +
  fire-rate gaps only. Excludes cast/windup/travel animations, which the game data doesn't provide — real
  time is longer.").
- The **headline** is "Kill secured from ≥ X% HP" (timing-independent, exact), not a seconds number.
- The seconds figure is a **secondary, explicitly-bounded** readout, styled as an estimate (muted, "≥"
  prefix), never a confident precise number.

### 2d. Research — deadlock.wiki cast-time findings (load-bearing)

Actual cast-time data on the wiki *would materially change this verdict* (it would let v1 headline a
real TTK). It does not exist:

- **Abrams** (`deadlock.wiki/Abrams`): abilities list **Cooldown, Duration, Stun Duration, tick
  interval** (Siphon Life 42s CD / 4s / ticks 0.25s; Shoulder Charge 33s CD / 1.4s; Seismic Impact
  215s CD / 1.6s stun). **No cast time / cast point / windup shown.**
- **Haze** (`deadlock.wiki/Haze`): Sleep Dagger 30s CD / 2.75s sleep / 0.1s wake-up delay; Smoke Bomb
  8s / 33s CD / 1.5s fade; Fixation 6s; Bullet Dance 3.5s / 165s CD. **No cast time / windup shown.**
- A dedicated `Cast_Time` concept page **404s** — cast time is not a documented, per-ability wiki stat.

**Conclusion of the research:** the wiki exposes exactly the timing primitives the engine already syncs
(cooldowns, durations, charges, tick rates) and **not** the ones a seconds-accurate TTK needs (cast/
windup/travel). This confirms the BUILD-REDUCED verdict: precise wall-clock TTK is not credibly
buildable from available data today. (If a future data source — Valve's ability KV files parsed for
`m_flChannelMoveSpeed`/cast-point fields, or a community dataset — surfaces cast points, revisit; that
would unlock headline TTK and flip the verdict toward full BUILD.)

---

## 3. Engine impact

**No structural change. One new pure function + small type additions. No new baked data.**

### New surface area

- **`planCombo(build, target, opts, sequence): ComboPlan` — new pure function in `src/lib/sim/`** (its
  own module, e.g. `combo.ts`, to keep `engine.ts` focused; `simulate` stays untouched). It:
  - Runs (or accepts) the same resolved `AbilityRow[]` + weapon/proc/active pieces `simulate()` already
    produces, so **all mitigation, spirit-amp, imbue, tier-behavior, rank, and execute logic is reused,
    not reimplemented** (this is the key cost-saver — the damage math is done).
  - Walks the ordered `sequence` (ability id | `{bullets:n}` | `{active:itemId}` | `{hold:seconds}`),
    maintaining running `targetHp` and a lower-bound `elapsed` clock + per-ability cooldown/charge
    ledger.
  - At each step: subtract mitigated damage (from the existing per-step values), advance the clock by
    the defensible increment (bullets → `n/fireRate`; ability re-use → cooldown/charge gap; hold →
    `t` + DoT accrual), and test `abilityExecute()` thresholds against the new `targetHp`.
  - Returns `ComboPlan`: ordered `steps[]` (each with `hpAfter`, `hpAfterPct`, `elapsedLowerBound`,
    `gatedBy?`, `crossedExecute?`), plus summary `{ killSecuredFromHpPct, totalElapsedLowerBound,
    gatedTotalSeconds, unreachable? }`.
- **Types (in `types.ts`):** `ComboStep` (a union of the step kinds above), `ComboPlanStep`,
  `ComboPlan`. `SimOptions` gets an optional `sequence?: ComboStep[]` **or** — cleaner — `planCombo`
  takes the sequence as its own argument and reuses `SimOptions` unchanged for the damage resolution.
  Recommend the latter (keeps `simulate`'s contract stable).
- **`ExecutePanel` upgrade (UI, `damage-calculator.tsx`):** from a static burst-vs-threshold bar to the
  ordered timeline (§1). Consumes `ComboPlan`. Medium UI lift; no other component structural change.
- **`useBuild` (`use-build.ts`):** owns the `sequence` state + a derived `plan = planCombo(...)`
  memo, alongside the existing `executes` memo. Small.

### What does NOT change

- `simulate()`'s signature and return shape — untouched (the planner is additive).
- The sync / baked data — **nothing new to bake** (all inputs already synced).
- No multi-attacker anything (that's the parked 2v2 solver).

### Test strategy — hand-computed sequence fixtures

Consistent with `engine.test.ts` (pure, `toBe`/`toBeCloseTo`, hand-computed expectations):

- **Ordering correctness:** a 2-step sequence where the order changes whether a `kind:"kill"` execute
  line is crossed — assert `killSecuredFromHpPct` differs between orders, with hand-computed HP after
  each step.
- **Cooldown gating:** a sequence re-using one ability twice; assert the second step's `gatedBy` and the
  inserted cooldown gap (`elapsedLowerBound` = first-cast + `max(0, cooldown)`).
- **Charge gating:** a 3-charge ability used 4 times; assert charges 1–3 are gap-free and the 4th waits
  `chargeCooldown`.
- **Bullet timing:** N bullets → `N/fireRate` seconds exactly (the one precise number).
- **DoT hold:** a burn ability + a `hold:t` step → damage = `dotPerSec · t`, HP subtracted, clock += t.
- **Execute at step:** burst that leaves the target above a `bonus` line, then bullets that cross it →
  assert `crossedExecute` fires on the crossing step, not before.
- **Lower-bound honesty:** assert `elapsedLowerBound` counts only bullet + cooldown/charge/hold time and
  **excludes** any cast-time term (there is none) — a locking test that the model stays a lower bound.

---

## 4. Verification plan (should it proceed)

1. `bun test` green, with the new `combo.test.ts` fixtures above (hand-computed, locking).
2. **Engine-number cross-check** against `simulate()`: for a single-burst sequence (all abilities +
   default bullets, no re-use, no holds), `planCombo`'s total damage must equal `simulate()`'s
   `burst.total` (minus/plus the documented DoT-window convention) — proving the planner reuses, not
   re-derives, the damage math. Any drift is a bug.
3. **In-game stress test (the accuracy moat):** pick 2–3 real kill combos in the practice range,
   record the actual wall-clock, and confirm `planCombo`'s lower bound is **always ≤** the observed real
   time (a lower bound that's ever exceeded is a broken model). Document the typical gap (the cast-time
   optimism) as the honest caveat text.
4. **UI verification** (preview tools / `bun --bun next dev`): the ordered timeline renders, execute
   lines mark correctly, gated steps show their gap, and every seconds figure carries the "≥ / excludes
   cast animations" label. Confirm the headline is "kill from ≥X% HP", not a bare TTK.
5. **Docs discipline (same change):** flip `features.md` (F2 idea → shipped/next), update `/methodology`
   (`src/app/methodology/page.tsx`) to state the combo planner's timing model + its explicit
   assumptions/limits, and log the cast-time data gap honestly in `bugs.md` as a known approximation.
6. Re-read the Global constraints before merge (stay static, no tracker, no paywalled number, "Proving
   Ground" retired).

---

## 5. Open questions for the owner (at go-ahead)

1. **Approve BUILD-REDUCED?** (ordering + gating + lower-bound timing) vs full BUILD (headline TTK — not
   recommended until cast-time data exists) vs DON'T-BUILD-YET.
2. **Manual sequence builder (recommended) vs auto-optimizer** — confirm (A) for v1, (B) deferred.
3. **In-place `ExecutePanel` upgrade (recommended) vs a new "Combo" tab** on the Damage Calculator.
4. Worth a timeboxed look at **Valve ability KV files** (a non-deadlock-api source) for cast-point
   fields? If they're parseable, that flips the verdict toward headline TTK. If not, the lower-bound
   model is the ceiling.
5. Reload/mag gating — currently not in the engine. In scope for v1 bullet-string gating, or defer?
