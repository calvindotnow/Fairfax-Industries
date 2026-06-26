import { getHeroes, getItems } from "@/lib/data";
import { decodeBuild } from "@/lib/build-code";
import { simulate } from "@/lib/sim";
import type { ItemWithModifiers } from "@/db/schema";

async function loadData() {
  return { heroes: getHeroes(), items: getItems() };
}

// Resolve a share code into the heroes, items, and simulated result. Ultimates
// default off, mirroring the build tool, since the code doesn't store ability toggles.
export async function resolveBuild(code: string) {
  const { heroes, items } = await loadData();
  const s = decodeBuild(code, heroes, items);
  if (!s) return null;
  const hero = heroes.find((h) => h.id === s.heroId) ?? null;
  const target = heroes.find((h) => h.id === s.targetId) ?? null;
  if (!hero || !target) return null;
  const equipped = s.loadout.map((id) => items.find((i) => i.id === id)).filter(Boolean) as ItemWithModifiers[];
  const targetEquipped = s.targetLoadout.map((id) => items.find((i) => i.id === id)).filter(Boolean) as ItemWithModifiers[];
  const ultIds = hero.abilities.filter((a) => a.type === "ultimate").map((a) => a.id);
  const result = simulate(
    { hero, items: equipped },
    { hero: target, items: targetEquipped, matchAttackerLevel: s.matchTargetLevel },
    { range: s.range, shots: s.shots, headshots: s.headshots, disabledAbilityIds: ultIds },
  );
  return { hero, target, equipped, targetEquipped, result };
}
