/** Length of the default burst window, in seconds. Tunable in one place. */
export const FIRE_WINDOW_SECONDS = 1.5;

/** Shots that fit in ~1.5s of fire at the given (items-included) fire rate. Min 1. */
export function defaultShotsForFireRate(fireRate: number): number {
  if (!Number.isFinite(fireRate) || fireRate <= 0) return 1;
  return Math.max(1, Math.round(fireRate * FIRE_WINDOW_SECONDS));
}

/** Seconds of fire that `shots` represents at `fireRate`. 0 when fireRate <= 0. */
export function secondsOfFire(shots: number, fireRate: number): number {
  if (!Number.isFinite(fireRate) || fireRate <= 0) return 0;
  return shots / fireRate;
}

/** Case-insensitive name filter for the hero picker. Empty query → all. */
export function filterHeroes<T extends { name: string }>(heroes: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return heroes;
  return heroes.filter((h) => h.name.toLowerCase().includes(q));
}

/**
 * Lane Lab v2 (D1) — pure enemy-loadout selection + the one-way "take control"
 * transition, extracted so the hard invariants are unit-testable without a
 * component harness.
 */

/**
 * Which enemy list the sim/counter actually read (works for id lists or equipped
 * item lists — generic over the element type).
 * Auto on + available → the derived (auto) list; otherwise the hand-built one.
 * Auto off ⇒ returns `manual` unchanged ⇒ byte-identical no-op vs pre-v2.
 */
export function effectiveEnemyLoadout<T>(
  autoEnemy: boolean,
  autoEnemyAvailable: boolean,
  autoLoadout: T[],
  manualLoadout: T[],
): T[] {
  return autoEnemy && autoEnemyAvailable ? autoLoadout : manualLoadout;
}

/**
 * The manual (`targetLoadout`) seed to commit when a manual enemy edit happens while
 * auto is on: the derived enemy that was on screen, capped, with the edit applied —
 * so the user keeps exactly what they saw plus their change. Never derived from, nor
 * writes into, the auto path itself. `maxItems` caps an add.
 */
export function takeControlSeed(
  autoLoadout: number[],
  edit: { type: "add"; id: number } | { type: "remove"; id: number },
  maxItems: number,
): number[] {
  const base = autoLoadout.slice(0, maxItems);
  if (edit.type === "remove") return base.filter((x) => x !== edit.id);
  if (base.includes(edit.id) || base.length >= maxItems) return base; // add is a no-op when owned/full
  return [...base, edit.id];
}
