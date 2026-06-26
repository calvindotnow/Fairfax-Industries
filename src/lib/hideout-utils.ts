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
