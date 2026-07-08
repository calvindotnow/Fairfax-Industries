/**
 * Sync real Deadlock data from the community deadlock-api assets endpoints
 * into the local SQLite database. Run: `bun scripts/sync-deadlock-api.ts`
 *
 * Source: https://api.deadlock-api.com/v1/assets  (open, community-run)
 * This replaces the hand-seeded placeholder heroes/items/abilities.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { heroes, abilities, items, itemStatModifiers } from "../src/db/schema";
import { captureSnapshot } from "../src/lib/snapshot";
import { distillBuildPath } from "../src/lib/build-path";

const HEROES_URL = "https://api.deadlock-api.com/v1/assets/heroes?only_active=true";
const ITEMS_URL = "https://api.deadlock-api.com/v1/assets/items";

// Identify ourselves to the community API so the maintainers can see who's calling.
const FETCH_OPTS: RequestInit = {
    headers: { "User-Agent": "fairfax-industries-deadlock-sandbox (+https://github.com/)" },
};

// ─── Lane Lab analytics ───────────────────────────────────────────────────────
const ANALYTICS_API = "https://api.deadlock-api.com/v1/analytics";
const LANE_LAB = { min_average_badge: 80, min_matches: 100, window_days: 30 } as const;
const TOP_N_COUNTER_ITEMS = 16;
const BUILD_PATH_MIN_PICKRATE = 0.08; // keep only items >= 8% of a hero's matches on their build path
// Curated-aggregate floors (research appendix conventions): global item stats + per-hero ability orders.
const ITEM_AGG_MIN_MATCHES = 200; // sample floor for global per-item win/pick
const ABILITY_ORDER_MIN_MATCHES = 50; // sample floor per observed skill order
const TOP_N_ABILITY_ORDERS = 10; // keep the top-N most-common orders per hero
// Optional dev cap: set LANE_LAB_MAX_HEROES to a small number to validate the script quickly.
// When unset the full active-hero roster is used (the daily CI action bakes all heroes).
const MAX_HEROES = process.env.LANE_LAB_MAX_HEROES ? Number(process.env.LANE_LAB_MAX_HEROES) : Infinity;

async function getJSON(url: string): Promise<any> {
    const headers: Record<string, string> = {
        "User-Agent": "fairfax-industries-deadlock-sandbox (+https://github.com/)",
    };
    if (process.env.DEADLOCK_API_KEY) headers["X-API-KEY"] = process.env.DEADLOCK_API_KEY;
    for (let attempt = 0; attempt <= 2; attempt++) {
        if (attempt > 0) await sleep(attempt * 1000);
        const res = await fetch(url, { headers });
        if (res.ok) return res.json();
        if (attempt < 2) {
            console.warn(`  [warn] ${res.status} ${url} — retrying in ${attempt + 1}s…`);
        } else {
            throw new Error(`${res.status} ${url}`);
        }
    }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const num = (v: any): number | null =>
    typeof v === "number" ? v : typeof v?.value === "number" ? v.value : null;

// Parse a property value that may be a unit-suffixed string ("10m", "5", "-1.0")
// or a {value} wrapper. Returns null for non-finite results.
const pnum = (v: unknown): number | null => {
    const raw = v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (typeof raw === "string") {
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};
// First positive (> 0) parsed value among the candidates, else null.
const firstPos = (...vals: unknown[]): number | null => {
    for (const v of vals) {
        const n = pnum(v);
        if (n != null && n > 0) return n;
    }
    return null;
};

// ── Ability ranks ──────────────────────────────────────────────────────────────
// Each ability has up to 3 upgrade tiers (`ab.upgrades[].property_upgrades`), every entry a
// { name, bonus, upgrade_type }. We precompute the ability's full stat profile at ranks 0–3
// (cumulative) so the engine and UI just index by rank, and synthesize a readable change list
// per tier (the API ships no prose for tiers — the property deltas *are* "what they change").
type RankStats = { damage: number; scale: number; dotDps: number; dotDuration: number; range: number | null; duration: number | null; charges: number | null; cooldown: number | null };
type RankKeys = { directKey?: string; dpsKey?: string; dotDurKey?: string; rangeKey?: string; durKey?: string };
type PropUpgrade = { name: string; bonus: unknown; upgrade_type?: string };

// Friendly labels for the property names that show up in tier upgrades.
const UPGRADE_LABEL: Record<string, string> = {
    Damage: "Damage", ImpactDamage: "Impact damage", BonusDamage: "Bonus damage", DPS: "Damage/sec",
    BuffDamage: "Buff damage", BleedDPSPerStack: "Bleed damage/sec", AbilityCharges: "Charges",
    AbilityCooldown: "Cooldown", AbilityCastRange: "Range", Radius: "Radius", AbilityDuration: "Duration",
    BleedDuration: "Bleed duration", StunDuration: "Stun duration", SlowPercent: "Slow",
    BulletResistReduction: "Bullet resist reduction", WeaponDamageBonus: "Weapon damage",
    BonusFireRate: "Fire rate", BonusMoveSpeed: "Move speed", EnemyHealthPercent: "Execute threshold",
    SleepDuration: "Sleep duration", DebuffDuration: "Debuff duration", EvasionPercent: "Evasion",
    LifestealPercentHero: "Lifesteal vs heroes",
};
const prettyProp = (name: string) =>
    UPGRADE_LABEL[name] ?? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^Ability /, "");

// Render one upgrade as readable text: "+100 Damage", "−75s Cooldown", "+10m Radius",
// "+0.09/Spirit Bleed damage/sec", "+113% Damage".
function describeUpgrade(pu: PropUpgrade): string {
    const label = prettyProp(pu.name);
    const raw = String(pu.bonus);
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n === 0) return label; // placeholder / no-op
    if (pu.upgrade_type === "EAddToScale") return `+${n}/Spirit ${label}`;
    // EMultiplyBase ships a percent (113 → "+113%"); EMultiplyScale ships a multiplier
    // factor on the Spirit-scaling coefficient (1.22 → "+22%"), so convert it.
    if (pu.upgrade_type === "EMultiplyBase") return `+${n}% ${label}`;
    if (pu.upgrade_type === "EMultiplyScale") return `+${Math.round((n - 1) * 100)}% ${label}`;
    const unit = /m$/.test(raw) ? "m" : /(Cooldown|Duration|Time)$/.test(pu.name) ? "s"
        : /(Percent|Resist|Slow|FireRate|Speed|Evasion|Lifesteal)/.test(pu.name) ? "%" : "";
    return `${n > 0 ? "+" : "−"}${Math.abs(n)}${unit} ${label}`;
}

// Apply one upgrade to a mutable rank profile (the damage fields are what the engine reads;
// range/duration/charges/cooldown are display). EAddToScale bumps the per-Spirit coefficient.
function applyUpgradeToProfile(s: RankStats, pu: PropUpgrade, keys: RankKeys): void {
    const n = parseFloat(String(pu.bonus));
    if (!Number.isFinite(n) || n === 0) return;
    const t = pu.upgrade_type;
    const addTo = (field: "damage" | "dotDps") => {
        if (t === "EAddToScale") s.scale += n;
        else if (t === "EMultiplyBase") s[field] *= 1 + n / 100;
        else if (t === "EMultiplyScale") s.scale *= n;
        else s[field] += n; // (none) / EAddToBase
    };
    if (pu.name === keys.directKey) addTo("damage");
    else if (pu.name === keys.dpsKey) addTo("dotDps");
    else if (keys.dotDurKey && pu.name === keys.dotDurKey) s.dotDuration += n;
    else if (pu.name === "AbilityCharges") s.charges = (s.charges ?? 0) + n;
    else if (pu.name === "AbilityCooldown" && s.cooldown != null) s.cooldown = Math.max(0, s.cooldown + n);
    else if (keys.rangeKey && pu.name === keys.rangeKey) s.range = (s.range ?? 0) + n;
    else if (keys.durKey && pu.name === keys.durKey) s.duration = (s.duration ?? 0) + n;
}

// Build the 4-rank profile (cumulative) + the 3 tier change lists from an ability's upgrades.
function buildRankProfile(base: RankStats, upgrades: { property_upgrades?: PropUpgrade[] }[], keys: RankKeys) {
    const ranks: RankStats[] = [{ ...base }];
    const tiers: string[][] = [];
    let cur = { ...base };
    for (let i = 0; i < 3; i++) {
        const tier = upgrades[i]?.property_upgrades ?? [];
        cur = { ...cur };
        tiers.push(tier.map(describeUpgrade));
        for (const pu of tier) applyUpgradeToProfile(cur, pu, keys);
        ranks.push({ ...cur });
    }
    return { ranks, tiers };
}

// Infer which computed stat a stacking/active-buff property boosts, from its name
// (these properties carry no provided_property_type). Shared by stacking + active buffs.
const statFromPropName = (k: string): string | null =>
    /FireRate/i.test(k) ? "weaponFireRate"
    : /(WeaponPower|WeaponDamage|BaseAttack)/i.test(k) ? "bulletDamage"
    : /Health/i.test(k) ? "maxHealth"
    : /SprintSpeed/i.test(k) ? "sprintSpeed"
    : /MoveSpeed/i.test(k) ? "moveSpeed"
    : /(BulletResist|BulletArmor)/i.test(k) ? "bulletResist"
    : /(SpiritResist|TechResist|MagicResist)/i.test(k) ? "spiritResist"
    : /(SpiritPower|TechPower)/i.test(k) ? "spiritPower"
    : null;

// Source engine: ~52.49 units per meter
const UNITS_PER_METER = 52.49;

// Map Deadlock item modifier types -> our computed-stat model
const MOD_MAP: Record<string, [string, "flat" | "percent"]> = {
    MODIFIER_VALUE_HEALTH_MAX: ["maxHealth", "flat"],
    MODIFIER_VALUE_HEALTH_REGEN_PER_SECOND: ["healthRegen", "flat"],
    MODIFIER_VALUE_OUT_OF_COMBAT_HEALTH_REGEN: ["healthRegen", "flat"],
    MODIFIER_VALUE_TECH_POWER: ["spiritPower", "flat"],
    MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE: ["bulletDamage", "percent"],
    MODIFIER_VALUE_ALL_DAMAGE_MULTIPLIER: ["bulletDamage", "percent"],
    MODIFIER_VALUE_FIRE_RATE: ["weaponFireRate", "percent"],
    MODIFIER_VALUE_BULLET_ARMOR_DAMAGE_RESIST: ["bulletResist", "percent"],
    MODIFIER_VALUE_TECH_RESIST: ["spiritResist", "percent"],
    MODIFIER_VALUE_MOVEMENT_SPEED_MAX: ["moveSpeed", "flat"],
    MODIFIER_VALUE_SPRINT_SPEED_BONUS: ["sprintSpeed", "flat"],
    MODIFIER_VALUE_STAMINA: ["stamina", "flat"],
    MODIFIER_VALUE_MELEE_DAMAGE_INCREASE: ["meleeDamage", "percent"],
    MODIFIER_VALUE_MELEE_RESIST: ["meleeResist", "percent"],
};

// Pick the first real raster image (.webp/.png); ignores malformed paths like `panorama:""`.
function pickImage(i: any): string | null {
    for (const url of [i.shop_image_webp, i.image_webp]) {
        // real item art lives under /items/ or /upgrades/ — an /abilities/ path is a junk fallback
        if (typeof url === "string" && /\.(webp|png)$/i.test(url) && !/\/abilities\//.test(url)) return url;
    }
    return null;
}

// Strip the API's HTML/SVG-laced description down to readable prose.
// `description` is an object ({ desc }); the text is wrapped in inline <svg> icons,
// <span class="…"> labels, and <br> line breaks that we flatten to plain text.
function cleanDescription(desc: any): string | null {
    const raw =
        typeof desc === "string" ? desc : typeof desc?.desc === "string" ? desc.desc : null;
    if (!raw) return null;
    const text = raw
        .replace(/<svg[\s\S]*?<\/svg>/gi, "") // drop inline stat icons
        .replace(/<br\s*\/?>/gi, "\n") // line breaks -> newlines
        .replace(/<[^>]+>/g, "") // drop remaining tags, keep their text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/[ \t]+/g, " ")
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return text || null;
}

// Some items lack a localized name and fall back to a class_name like "upgrade_weapon_eater".
function prettyName(name: string): string {
    if (/^[a-z0-9_]+$/.test(name)) {
        return name
            .replace(/^upgrade_/, "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return name;
}

// Parse direct-damage effects (procs, conditional flat/percent adds) from an item's properties.
function parseItemEffects(props: Record<string, any>, itemName: string, isActive = false) {
    const effects: any[] = [];
    const add = (e: any) => effects.push({ ...e, itemName });
    const pf = (v: any) => parseFloat(v); // tolerates "15m" style values
    // The real re-proc gate is the item's AbilityCooldown (e.g. Mystic Shot = 8s),
    // NOT the short internal ProcCooldown (=1s). Using ProcCooldown made cooldown-gated
    // procs fire many times in a burst — badly inflating slow weapons (shotguns), whose
    // shots span more seconds. Prefer AbilityCooldown, then ProcCooldown, then 1s.
    const procCd = pf(props.AbilityCooldown?.value) || pf(props.ProcCooldown?.value) || 1;

    // Spirit-power scaling on a property: only when it scales on ETechPower (Spirit).
    const spiritScaleOf = (prop: unknown): number | undefined => {
        const sf = (prop as { scale_function?: { specific_stat_scale_type?: string; stat_scale?: unknown } } | undefined)?.scale_function;
        if (sf?.specific_stat_scale_type !== "ETechPower") return undefined;
        return pf(sf.stat_scale) || undefined;
    };

    for (const k of Object.keys(props)) {
        const val = pf(props[k]?.value);
        if (!val) continue;
        const spiritScale = spiritScaleOf(props[k]);

        // Cooldown-gated spirit proc (e.g. Mystic Shot: +40 spirit + 1.2/Spirit, 8s cooldown)
        if (/^ProcBonusMagicDamage$/i.test(k))
            add({ kind: "onHitProc", damageType: "spirit", value: val, valueType: "flat", procCooldown: procCd, spiritScale });
        // Per-bullet spirit add (no cooldown)
        else if (/^BulletsBonusMagicDamage$/i.test(k))
            add({ kind: "onHitProc", damageType: "spirit", value: val, valueType: "flat", procCooldown: 0, spiritScale });
        // Cooldown-gated weapon proc dealing a % of the shot (e.g. +125% base attack)
        else if (/^ProcBaseAttackDamagePercent$/i.test(k))
            add({ kind: "onHitProc", damageType: "weapon", value: val, valueType: "percentOfShot", procCooldown: procCd });
    }

    // Active items' own on-cast direct damage (Arctic Blast 175 +0.70/Spirit, Cold Front,
    // Silence Wave, Phantom Strike, …). Only active items deal damage on press; passive
    // items with a `Damage` field are conditional procs (Tankbuster, Lightning Scroll) we
    // don't fold in here. A real damage field has a damage css_class and no "%" postfix.
    if (isActive) {
        const dmgKey = ["Damage", "ImpactDamage"].find((k) => {
            const pr = props[k];
            return /tech_damage|bullet_damage/.test(pr?.css_class || "") && !String(pr?.postfix || "").includes("%") && pf(pr?.value) > 0;
        });
        if (dmgKey) {
            const pr = props[dmgKey];
            add({
                kind: "activeDamage",
                damageType: pr.css_class === "tech_damage" ? "spirit" : "weapon",
                value: pf(pr.value),
                spiritScale: spiritScaleOf(pr),
            });
        }
    }

    // Charge-up / current-health bonus damage on a passive item (Tankbuster: +40 flat plus
    // 8% of the target's health, ignores Spirit Resist, after a charge-up). For a calculator
    // we assume the breakpoint is met and show the ideal full-health number, always on.
    const healthDmgKey = Object.keys(props).find((k) => /HealthDamage$/i.test(k) && /tech_damage|bullet_damage/.test(props[k]?.css_class || "") && String(props[k]?.postfix || "").includes("%"));
    if (healthDmgKey) {
        const pctV = pf(props[healthDmgKey]?.value);
        if (pctV) add({
            kind: "activeDamage",
            damageType: props[healthDmgKey].css_class === "tech_damage" ? "spirit" : "weapon",
            value: pf(props.Damage?.value) || 0,
            healthPctDamage: pctV,
            ignoreResist: true,
            alwaysOn: true,
        });
    }

    // Flat headshot bonus (e.g. Headshot Booster +45, Headhunter +75)
    const hsKey = Object.keys(props).find((k) => /HeadShotBonusDamage/i.test(k));
    if (hsKey) {
        const v = pf(props[hsKey]?.value);
        if (v)
            add({
                kind: "onHitFlat",
                condition: "headshot",
                damageType: props[hsKey]?.css_class === "tech_damage" ? "spirit" : "weapon",
                value: v,
                valueType: "flat",
            });
    }

    // Range-conditional weapon power (additive into the weapon-power bucket when in range)
    const longK = Object.keys(props).find((k) => /^LongRangeBonusWeaponPower$/i.test(k));
    if (longK) {
        const v = pf(props[longK]?.value);
        const min = pf(props.LongRangeBonusWeaponPowerMinRange?.value) || 15;
        if (v) add({ kind: "conditionalWeaponPct", value: v, rangeMin: min });
    }
    const closeK = Object.keys(props).find((k) => /^CloseRangeBonusWeaponPower$/i.test(k));
    if (closeK) {
        const v = pf(props[closeK]?.value);
        const max = pf(props.CloseRangeBonusWeaponPowerMaxRange?.value) || 15;
        if (v) add({ kind: "conditionalWeaponPct", value: v, rangeMax: max });
    }

    // Burst Fire dual-rate: a baseline fire-rate bonus that jumps to a higher value
    // while hitting an enemy hero (not both — it replaces). value = activated, baseValue = baseline.
    const activated = pf(props.ActivatedFireRate?.value);
    if (activated) {
        const baseline = pf(props.BonusFireRate?.value) || 0;
        add({ kind: "conditionalFireRate", value: activated, baseValue: baseline });
    }

    // Resist-debuff items: reduce the TARGET's bullet/spirit resist (e.g. Crippling
    // Headshot, Bullet Resist Shredder). Stored as a positive reduction amount.
    // parseFloat(undefined) is NaN (not nullish), so use || to fall through to the alt name.
    const bulletRed = pf(props.BulletResistReduction?.value) || pf(props.BulletArmorReduction?.value);
    if (bulletRed && bulletRed < 0) add({ kind: "targetResistReduction", damageType: "weapon", value: Math.abs(bulletRed) });
    const spiritRed = pf(props.MagicResistReduction?.value);
    if (spiritRed && spiritRed < 0) add({ kind: "targetResistReduction", damageType: "spirit", value: Math.abs(spiritRed) });

    // Stacking items: a MaxStacks cap plus per-stack amounts named either "*PerStack"/
    // "*PerKill" (Berserker, Glass Cannon) or "Stacking*" (Trophy Collector). The stat is
    // inferred from the property name. Skip degenerate caps (1 = not a slider; ~9999 = unlimited).
    const maxStacks = pf(props.MaxStacks?.value) || 0;
    const isStackKey = (k: string) => /(PerStack|PerKill)$/i.test(k) || /^Stacking[A-Z]/.test(k);
    if (maxStacks >= 2 && maxStacks <= 50) {
        let emittedModeled = false;
        for (const k of Object.keys(props)) {
            if (!isStackKey(k)) continue;
            const perStack = pf(props[k]?.value); // tolerates unit suffixes ("0.15m")
            // Two stacking effects aren't computed stats: a per-stack Spirit Amp
            // (Escalating Exposure's MagicIncreasePerStack — the target takes more spirit
            // damage) and per-stack heal (Restorative Locket's HealPerStack — pure sustain).
            // Tag them with a sentinel `stat` the engine handles specially.
            const stat =
                /MagicIncreasePerStack/i.test(k) ? "spiritAmp"
                : /HealPerStack/i.test(k) ? "heal"
                : statFromPropName(k);
            if (perStack && stat) { add({ kind: "stacking", value: perStack, stat, maxStacks }); emittedModeled = true; }
        }
        // Display-only marker so the slider still appears for stacking items whose per-stack
        // stat we still don't model.
        if (!emittedModeled && Object.keys(props).some(isStackKey)) add({ kind: "stacking", value: 0, maxStacks });
    }

    return effects;
}

async function main() {
    console.log("Fetching assets from deadlock-api…");
    const [heroData, itemData] = await Promise.all([
        fetch(HEROES_URL, FETCH_OPTS).then((r) => r.json()),
        fetch(ITEMS_URL, FETCH_OPTS).then((r) => r.json()),
    ]);
    console.log(`  ${heroData.length} heroes, ${itemData.length} item entries`);

    const byClass: Record<string, any> = Object.fromEntries(
        itemData.map((i: any) => [i.class_name, i]),
    );

    // Schema (including all columns) is created by `drizzle-kit push` — see package.json db:reset.
    console.log("Clearing existing rows…");
    db.delete(abilities).run();
    db.delete(itemStatModifiers).run();
    db.delete(items).run();
    db.delete(heroes).run();

    // ─── Items (upgrades only: weapon / vitality / spirit) ──────────────────
    const upgrades = itemData.filter(
        (i: any) =>
            i.type === "upgrade" &&
            ["weapon", "vitality", "spirit"].includes(i.item_slot_type) &&
            i.shopable === true && // must be buyable in the live shop
            i.disabled !== true && // drop removed / disabled test entries (e.g. "Glass Cannon v2")
            i.item_tier !== 5 && // Tier 5 is the alternate-mode (Breakneck) pool, not the standard game
            !/^[a-z0-9_]+$/.test(i.name) && // drop unlocalized / incomplete internal entries
            pickImage(i), // must have real shop art (.webp/.png, not a malformed path)
    );
    let itemCount = 0;
    let modCount = 0;
    for (const it of upgrades) {
        const image = pickImage(it);
        const display = prettyName(it.name);
        const eff = parseItemEffects(it.properties || {}, display, !!it.is_active_item);
        // Imbue items attach to one ability. Mark them so the UI can offer an ability picker.
        const isImbue = /imbu/i.test(it.class_name || "") || /imbue an ability|imbued ability/i.test(it.description?.desc || "");
        if (isImbue) {
            // Recompute magnitudes for the imbued ability (applied to that ability only, engine-side):
            //  • Spirit Power granted to the ability (ImbuedTechPower/ImbuedBonusDamage — both css
            //    ETechPower/tech_damage) → adds to the ability's spirit-damage coefficient term.
            //  • Duration extension % (ImbuedBonusDuration or the generic BonusAbilityDurationPercent)
            //    → extends the ability's duration / DoT lifetime.
            const ip = it.properties || {};
            const imbuedSpiritPower = (pnum(ip.ImbuedTechPower) ?? 0) + (pnum(ip.ImbuedBonusDamage) ?? 0);
            const imbuedDurationPct = pnum(ip.ImbuedBonusDuration) ?? pnum(ip.BonusAbilityDurationPercent) ?? 0;
            eff.push({
                kind: "imbue",
                value: 0,
                itemName: display,
                ...(imbuedSpiritPower ? { imbuedSpiritPower } : {}),
                ...(imbuedDurationPct ? { imbuedDurationPct } : {}),
            });
        }
        // Active items' on-cast self-buffs (ConditionallyApplied stats that map to our model,
        // e.g. Blood Tribute +35% fire rate). Applied only when "Actives firing" is toggled on.
        if (it.is_active_item) {
            // Active self-buffs arrive two ways: a ConditionallyApplied stat with a
            // provided_property_type (Blood Tribute: BonusFireRate), or an "Active*"-prefixed
            // property with neither, whose stat we infer from the name (Vampiric Burst:
            // ActiveBonusFireRate). Both apply only while "Actives firing" is on.
            for (const [k, raw] of Object.entries(it.properties || {})) {
                const pr = raw as { usage_flags?: string[]; provided_property_type?: string; value?: unknown };
                const v = Number(pr?.value);
                if (!v) continue;
                let stat: string | null = null;
                if (pr?.usage_flags?.includes("ConditionallyApplied") && pr.provided_property_type) {
                    stat = MOD_MAP[pr.provided_property_type]?.[0] ?? null;
                } else if (/^Active[A-Z]/.test(k)) {
                    stat = statFromPropName(k);
                }
                if (stat) eff.push({ kind: "activeBuff", value: v, stat, itemName: `${display}:${k}` });
            }
        }
        // Resolve this item's direct components (cheaper parts it's built from) to display names.
        const componentNames = Array.isArray(it.component_items)
            ? it.component_items
                  .map((cn: string) => (byClass[cn] ? prettyName(byClass[cn].name) : null))
                  .filter((n: string | null): n is string => !!n)
            : [];
        try {
            db.insert(items)
                .values({
                    name: display,
                    category: it.item_slot_type as "weapon" | "vitality" | "spirit",
                    tier: it.item_tier ?? 1,
                    isActive: !!it.is_active_item,
                    description: cleanDescription(it.description),
                    imageUrl: image,
                    soulCost: it.cost ?? 0,
                    effects: eff.length ? JSON.stringify(eff) : null,
                    components: componentNames.length ? JSON.stringify(componentNames) : null,
                })
                .run();
        } catch {
            continue; // skip duplicate names
        }
        const row = db.select({ id: items.id }).from(items).where(eq(items.name, display)).get();
        if (!row) continue;
        itemCount++;

        // Stat modifiers from the item's provided properties
        const props = it.properties || {};
        for (const key of Object.keys(props)) {
            const pr = props[key];
            // Conditionally-applied properties are NOT permanent stats (e.g. Burst Fire's
            // activated +32% fire rate, an active item's on-cast buff). Skip them here so
            // they don't inflate the build; the ones we model are re-emitted as conditional
            // effects in parseItemEffects.
            if (Array.isArray(pr?.usage_flags) && pr.usage_flags.includes("ConditionallyApplied")) continue;
            const map = pr?.provided_property_type ? MOD_MAP[pr.provided_property_type] : undefined;
            const value = Number(pr?.value);
            if (!map || !value) continue;
            const [statName, mode] = map;
            db.insert(itemStatModifiers)
                .values({
                    itemId: row.id,
                    statName,
                    flatBonus: mode === "flat" ? value : 0,
                    percentBonus: mode === "percent" ? value : 0,
                })
                .run();
            modCount++;
        }
    }
    console.log(`  inserted ${itemCount} items, ${modCount} stat modifiers`);

    // ─── Heroes + their signature abilities ─────────────────────────────────
    let heroCount = 0;
    let abilityCount = 0;
    for (const h of heroData) {
        if (h.disabled || !h.player_selectable) continue;
        const s = h.starting_stats || {};
        const gun = byClass[h.items?.weapon_primary]?.weapon_info || {};
        const cycle = num(gun.cycle_time);
        const fireRate = cycle && cycle > 0 ? 1 / cycle : 4;
        // Shotguns fire multiple pellets per trigger pull — fold into per-shot damage
        const pellets = num(gun.bullets) ?? 1;
        const perShotDamage = (num(gun.bullet_damage) ?? 18) * pellets;
        // Per-level boons (souls scaling)
        const boon = h.standard_level_up_upgrades || {};

        db
            .insert(heroes)
            .values({
                name: h.name,
                description: typeof h.description?.lore === "string" ? h.description.lore : null,
                imageUrl: h.images?.icon_image_small_webp || h.images?.icon_hero_card_webp || null,
                role: h.hero_type ? String(h.hero_type).replace(/^\w/, (c: string) => c.toUpperCase()) : null,
                maxHealth: num(s.max_health) ?? 550,
                healthRegen: num(s.base_health_regen) ?? 2,
                bulletDamage: Math.round(perShotDamage * 100) / 100,
                weaponFireRate: Math.round(fireRate * 100) / 100,
                bulletResist: 0, // no hero has flat base bullet resist; it comes from per-level growth
                spiritPower: 0,
                spiritResist: num(s.tech_armor_damage_reduction) ?? 0, // base spirit resist (Pocket -15, Lash +10)
                moveSpeed: num(s.max_move_speed) ?? 7,
                // API `sprint_speed` is the *bonus* added on top of max_move_speed (~1.6),
                // not the absolute sprint speed. Store the absolute value so sprint > move.
                sprintSpeed: (num(s.max_move_speed) ?? 7) + (num(s.sprint_speed) ?? 0),
                stamina: num(s.stamina) ?? 3,
                falloffStart: num(gun.damage_falloff_start_range) != null
                    ? Math.round((num(gun.damage_falloff_start_range)! / UNITS_PER_METER) * 10) / 10
                    : 22,
                falloffEnd: num(gun.damage_falloff_end_range) != null
                    ? Math.round((num(gun.damage_falloff_end_range)! / UNITS_PER_METER) * 10) / 10
                    : 58,
                lightMeleeDamage: num(s.light_melee_damage) ?? 50,
                heavyMeleeDamage: num(s.heavy_melee_damage) ?? 116,
                meleePerLevel: num(boon.MODIFIER_VALUE_BASE_MELEE_DAMAGE_FROM_LEVEL) ?? 0,
                bulletDamagePerLevel: (num(boon.MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL) ?? 0) * pellets,
                healthPerLevel: num(boon.MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL) ?? 0,
                spiritPerLevel: num(boon.MODIFIER_VALUE_TECH_POWER) ?? 0,
                bulletResistPerLevel: num(boon.MODIFIER_VALUE_BULLET_ARMOR_DAMAGE_RESIST) ?? 0,
                spiritResistPerLevel: num(boon.MODIFIER_VALUE_TECH_RESIST) ?? 0,
                critDamageReceivedScale: num(s.crit_damage_received_scale) ?? 1,
            })
            .run();
        const hero = db.select({ id: heroes.id }).from(heroes).where(eq(heroes.name, h.name)).get();
        if (!hero) continue;
        heroCount++;

        const slots: [string, string][] = [
            ["signature1", "signature"],
            ["signature2", "signature"],
            ["signature3", "signature"],
            ["signature4", "ultimate"],
        ];
        for (const [slot, type] of slots) {
            const ab = byClass[h.items?.[slot]];
            if (!ab) continue;
            const p = ab.properties || {};
            // Damage is detected by css_class (tech_damage = spirit, bullet_damage = weapon),
            // not by property NAME — abilities scatter damage across dozens of fields
            // (TurretDPS, DamagePerRocket, BonusDamage, ImpactDamage, …). A flat damage value
            // has a damage css_class, a positive number, no "%" postfix (that marks an amp),
            // and isn't a modifier/threshold/buff by name.
            const NON_DAMAGE = /Amp|Percent|Pct|Threshold|Penalty|Resist|Reduction|Vulnerab|Multiplier|Debuff|Deferred|Outgoing|Incoming|WeaponDamage|DamageBonus|HeadshotBonus|Bonus(Health|FireRate|MoveSpeed|Bullet)/i;
            const isDmgProp = (pr: { css_class?: string; postfix?: string; value?: unknown } | undefined) => {
                if (!/tech_damage|bullet_damage|^damage$/.test(pr?.css_class || "")) return false;
                if (String(pr?.postfix || "").includes("%")) return false;
                return parseFloat(String(pr?.value)) > 0;
            };
            const dmgKeys = Object.keys(p).filter((k) => isDmgProp(p[k]) && !NON_DAMAGE.test(k));
            const pick = (keys: string[], prefer: string[]) => {
                for (const name of prefer) if (keys.includes(name)) return p[name];
                const best = keys.slice().sort((a, b) => parseFloat(p[b].value) - parseFloat(p[a].value))[0];
                return best ? p[best] : undefined;
            };
            // Per-second damage (DoT/turret/bleed) vs an instant direct hit. Bleed and
            // per-stack/per-tick fields (Shiv Serrated Knives BleedDPSPerStack=10 over
            // BleedDuration=5) are rates applied over a duration, not an instant hit.
            const isRate = (k: string) => /(DPS|PerSecond|PerStack|PerTick)$/i.test(k) || /Bleed/i.test(k);
            const dps = pick(dmgKeys.filter(isRate), ["DPS", "TurretDPS", "PulseDPS"]);
            const direct = pick(dmgKeys.filter((k) => !isRate(k)), ["Damage", "ImpactDamage", "BonusDamage"]);
            const mainKey = direct ?? dps;
            const isTech = mainKey?.css_class === "tech_damage";
            const scale = num(mainKey?.scale_function?.value) ?? num(mainKey?.scale_function?.stat_scale) ?? 0;
            const dotDps = num(dps) ?? 0;
            // First positive duration field (0-valued fields must not shadow a real one).
            // Duration values arrive as strings (e.g. "5", "7"), so parse them; field name
            // varies by ability (burn/ground/debuff for true DoTs, lifetime/channel for zones).
            let dotDuration = 0;
            let dotDurKey: string | undefined;
            if (dotDps > 0) {
                // A true DoT duration (burn/bleed/ground) beats AbilityChannelTime, which is
                // the cast/channel window (Serrated Knives channels 0.2s but bleeds for 5s).
                const durKeys = [
                    "AbilityDuration", "Duration", "BurnDuration", "GroundFlameDuration",
                    "DebuffDuration", "BleedDuration", "MaxLifetime", "AbilityChannelTime",
                ];
                for (const k of durKeys) {
                    const v = parseFloat(p[k]?.value);
                    if (v && v > 0) {
                        dotDuration = v;
                        dotDurKey = k;
                        break;
                    }
                }
            }
            // %-of-health ability damage (Victor Jumpstart 15% current, Mina Rake 6% missing,
            // Silver Slam Fire 2.5% current). Modeled at the target's FULL health downstream:
            // "current" → pct% of max; "missing" → 0 (nothing missing at full). We only bake the
            // simple single-percentage form; ramp-style abilities with min/max thresholds
            // (Vyper Lethal Venom) are NOT baked here — their baked base damage is the ramp's
            // max (30%-HP) figure, a documented approximation, not a full-HP number.
            const curHpKey = Object.keys(p).find((k) => /^(?:\w*)Current\w*Health\w*Damage(?:Percentage)?$/i.test(k) && !/Cap|Bonus|Boss/i.test(k));
            const missHpKey = Object.keys(p).find((k) => /^(?:\w*)MissingHealthDamagePercentage$/i.test(k) && !/Venom/i.test(k));
            const curHpPct = curHpKey ? pnum(p[curHpKey]) : null;
            const missHpPct = missHpKey ? pnum(p[missHpKey]) : null;
            let healthScaling: { kind: "current" | "missing"; pct: number } | null = null;
            let healthScalingKey: string | undefined;
            if (curHpPct && curHpPct > 0) { healthScaling = { kind: "current", pct: curHpPct }; healthScalingKey = curHpKey; }
            else if (missHpPct && missHpPct > 0) { healthScaling = { kind: "missing", pct: missHpPct }; healthScalingKey = missHpKey; }

            const hasDamage = (num(direct) ?? 0) > 0 || dotDps > 0 || healthScaling != null;
            // Damage type: prefer the detected flat/dot key; else fall back to the health-scaling
            // key's channel (Silver Slam Fire is bullet_damage; Victor/Mina are tech_damage) so an
            // ability whose ONLY damage is %-of-health still reports the right weapon/spirit type.
            const hpIsTech = healthScalingKey ? /tech_damage/.test(p[healthScalingKey]?.css_class || "") : false;
            const damageKind = hasDamage
                ? (((num(direct) ?? 0) > 0 || dotDps > 0) ? (isTech ? "spirit" : "weapon") : (hpIsTech ? "spirit" : "weapon"))
                : null;

            // Display-only fields the damage engine doesn't need but the UI does.
            // Values arrive as unit-suffixed strings ("10m", "5", "-1.0").
            const range = firstPos(p.AbilityCastRange, p.Radius);
            // General ability duration (stun/zone/channel), independent of the DoT path.
            const duration = firstPos(p.AbilityDuration, p.AbilityChannelTime);
            const chargesRaw = pnum(p.AbilityCharges); // "0"/-1 = no charges
            const charges = chargesRaw != null && chargesRaw > 1 ? Math.round(chargesRaw) : null;
            // The delay before a spent charge starts refilling. Capture whenever present.
            const chargeCooldown = firstPos(p.AbilityCooldownBetweenCharge);

            // Scaling metadata for the UI. The damage coefficient is stored in the
            // dedicated `spiritScaling` column; the `properties` blob only carries the
            // range/duration scale flags (those dimensions expose just a scale *type*,
            // ETechRange/ETechDuration, not a per-ability number). Only claim a dimension
            // scales when we actually surface its base value, so the UI tag never
            // references a stat the user can't see.
            const scaleTypeOf = (prop: unknown): string => {
                const sf = (prop as { scale_function?: { specific_stat_scale_type?: string; scaling_stats?: string[] } } | undefined)?.scale_function;
                if (!sf) return "";
                return [sf.specific_stat_scale_type, ...(sf.scaling_stats ?? [])].filter(Boolean).join(",");
            };
            const rangeScalesWithSpirit = range != null && /ETechRange/.test(scaleTypeOf(p.AbilityCastRange) + scaleTypeOf(p.Radius));
            const durationScalesWithSpirit = duration != null && /ETechDuration/.test(scaleTypeOf(p.AbilityDuration) + scaleTypeOf(p.AbilityChannelTime));

            // Execute / assassinate thresholds (HP %), for the enemy-health-bar marker.
            //  • "kill"  — instakills below the line (Venator ExecuteThreshold, Shiv Killing Blow).
            //  • "bonus" — bonus damage below the line (Vindicta/Drifter/Talon low-health).
            const killNamed = /execut|killing blow|finish|cull/i.test(`${ab.name} ${ab.description?.desc ?? ""}`);
            const execThresh = pnum(p.ExecuteThreshold);
            const enemyHpThresh = pnum(p.EnemyHealthPercent);
            const lowThresh = pnum(p.LowHealthEnemyThresholdPct) ?? pnum(p.LowHealthThreshold) ?? pnum(p.LowHealthFraction);
            let executePct: number | null = null;
            let executeKind: "kill" | "bonus" | null = null;
            if (execThresh && execThresh > 0) { executePct = execThresh; executeKind = "kill"; }
            else if (enemyHpThresh && enemyHpThresh > 0 && killNamed) { executePct = enemyHpThresh; executeKind = "kill"; }
            else if (lowThresh && lowThresh > 0) { executePct = lowThresh; executeKind = "bonus"; }

            const meta: Record<string, unknown> = {};
            if (rangeScalesWithSpirit) meta.rangeScalesWithSpirit = true;
            if (durationScalesWithSpirit) meta.durationScalesWithSpirit = true;
            if (executePct != null) { meta.executePct = executePct; meta.executeKind = executeKind; }
            if (healthScaling) meta.healthScaling = healthScaling;
            const scalingJson = Object.keys(meta).length ? JSON.stringify(meta) : null;

            // Ability-rank profile: precompute stats at ranks 0–3 + readable tier text. The
            // damage upgrades match the property the engine reads (direct/dps); display
            // dimensions match the field we surfaced. Stored as JSON, indexed by rank.
            const directKey = dmgKeys.find((k) => p[k] === direct);
            const dpsKey = dmgKeys.find((k) => p[k] === dps);
            const rangeKey = firstPos(p.AbilityCastRange) ? "AbilityCastRange" : firstPos(p.Radius) ? "Radius" : undefined;
            const durKey = firstPos(p.AbilityDuration) ? "AbilityDuration" : firstPos(p.AbilityChannelTime) ? "AbilityChannelTime" : undefined;
            const baseProfile: RankStats = {
                damage: num(direct) ?? 0,
                scale: isTech ? scale : 0,
                dotDps,
                dotDuration,
                range,
                duration,
                charges: chargesRaw,
                cooldown: num(p.AbilityCooldown),
            };
            const profile = buildRankProfile(baseProfile, ab.upgrades ?? [], { directKey, dpsKey, dotDurKey, rangeKey, durKey });
            // Store only when a tier actually carries a change to show or apply.
            const upgradesJson = profile.tiers.some((t) => t.length) ? JSON.stringify(profile) : null;

            db.insert(abilities)
                .values({
                    heroId: hero.id,
                    name: ab.name,
                    description: null,
                    type,
                    cooldown: num(p.AbilityCooldown),
                    range,
                    duration,
                    charges,
                    chargeCooldown,
                    baseDamage: num(direct),
                    spiritScaling: isTech ? scale : 0,
                    dotDps,
                    dotDuration,
                    damageKind,
                    imageUrl: ab.image_webp || ab.image || null,
                    properties: scalingJson,
                    upgrades: upgradesJson,
                })
                .run();
            abilityCount++;
        }
    }
    console.log(`  inserted ${heroCount} heroes, ${abilityCount} abilities`);
    await captureSnapshot();
    console.log("  captured stat snapshot for patch history");

    // Compute the baked game-data payload IN MEMORY (do not write yet). All output
    // files are written together at the very end, only after every analytics fetch
    // succeeds — an ATOMIC output so a late API failure can never leave baked-data.json
    // and lane-lab-data.json on inconsistent, freshly-regenerated ids (see the 2026-07-04
    // partial-write incident). If any source below throws, main() throws → nothing written.
    const bakedPath = new URL("../src/lib/baked-data.json", import.meta.url);
    const bakedHeroes = await db.query.heroes.findMany({ with: { abilities: true }, orderBy: (h, { asc }) => [asc(h.name)] });
    const bakedItems = await db.query.items.findMany({ with: { modifiers: true }, orderBy: (i, { asc }) => [asc(i.tier), asc(i.name)] });
    // Carry the previous baked snapshot forward as the "before" — db:reset wipes the
    // snapshot table, so patch-notes' two-snapshot diff must persist via the baked file.
    let prevSnaps: unknown[] = [];
    try {
        prevSnaps = (JSON.parse(readFileSync(bakedPath, "utf8")) as { snapshots?: unknown[] }).snapshots ?? [];
    } catch { /* first run — no previous baked file */ }
    const justCaptured = await db.query.statSnapshots.findMany({ orderBy: (sn, { desc }) => [desc(sn.takenAt)], limit: 1 });
    const snapshots = [...justCaptured, ...prevSnaps].slice(0, 2);

    // ─── Lane Lab analytics ─────────────────────────────────────────────────────
    // Fetches counter/synergy/item analytics from deadlock-api and bakes them into
    // a separate lane-lab-data.json (kept out of baked-data.json to cap bundle size).
    // Note: analytics endpoints use the deadlock-api hero IDs (h.id from heroData),
    // NOT the internal auto-incremented DB ids stored in bakedHeroes.
    console.log("Fetching Lane Lab analytics from deadlock-api…");
    const since = Math.floor(Date.now() / 1000) - LANE_LAB.window_days * 86400;
    const base = `min_average_badge=${LANE_LAB.min_average_badge}&min_unix_timestamp=${since}&same_lane_filter=true`;

    const counter_stats = await getJSON(`${ANALYTICS_API}/hero-counter-stats?${base}&min_matches=${LANE_LAB.min_matches}`);

    // Use the deadlock-api hero IDs (h.id) from the already-fetched heroData.
    // bakedHeroes ids are auto-incremented DB ids and do NOT match the analytics API.
    const activeHeroIds = (heroData as any[])
        .filter((h) => !h.disabled && h.player_selectable)
        .map((h) => h.id as number)
        .slice(0, MAX_HEROES);

    // Global per-item win/pick aggregates (for the /items two-axis ranking). One un-bucketed
    // call — bucket=hero returns HTTP 500 upstream (persistent server-side DB error as of
    // 2026-07-04), so per-hero item stats are fetched per hero below via hero_ids=.
    const globalItemRows: any[] = await getJSON(`${ANALYTICS_API}/item-stats?min_average_badge=${LANE_LAB.min_average_badge}&min_unix_timestamp=${since}&min_matches=${ITEM_AGG_MIN_MATCHES}`);
    const item_aggregates = globalItemRows.map((r) => ({ item_id: r.item_id, wins: r.wins, matches: r.matches }));

    // Per-hero: hero-level item stats (replaces the dead bucket=hero call — hero_ids= plural
    // is honored and filters correctly), the average build path (item-flow-stats nodes; edges
    // discarded), and the top-N ability orders. One fetch pair per hero, paced ≥350ms.
    const item_stats: Record<number, any[]> = {};
    // build_paths keeps api item_ids here; translated to DB ids in the translation block below.
    const build_paths: Record<number, { item_id: number; souls: number; pickrate: number; winrate: number }[]> = {};
    const ability_orders: Record<number, { abilities: number[]; wins: number; matches: number }[]> = {};
    for (const hid of activeHeroIds) {
        // (a) hero-level item stats (was bucket=hero; now per-hero hero_ids=)
        const heroItemRows: any[] = await getJSON(`${ANALYTICS_API}/item-stats?hero_ids=${hid}&min_average_badge=${LANE_LAB.min_average_badge}&min_unix_timestamp=${since}&min_matches=${ITEM_AGG_MIN_MATCHES}`);
        item_stats[hid] = heroItemRows.map((r) => ({ item_id: r.item_id, wins: r.wins, losses: r.losses, matches: r.matches }));
        await sleep(350);

        // (b) average build path — item-flow-stats. ⚠️ hero_ids (plural): hero_id (singular) is
        // IGNORED on this endpoint (returns global data). Discard edges (payload bulk); nodes only.
        const flow: any = await getJSON(`${ANALYTICS_API}/item-flow-stats?hero_ids=${hid}&min_average_badge=${LANE_LAB.min_average_badge}&min_unix_timestamp=${since}&min_matches=${LANE_LAB.min_matches}`);
        const steps = distillBuildPath(flow.nodes ?? [], flow.summary?.matches ?? 0, BUILD_PATH_MIN_PICKRATE);
        build_paths[hid] = steps.map((s) => ({ item_id: s.itemId, souls: s.souls, pickrate: +s.pickrate.toFixed(3), winrate: +s.winrate.toFixed(3) }));
        await sleep(350);

        // (c) ability-order stats — hero_id (singular) IS honored on this endpoint. Top-N by matches.
        const orderRows: any[] = await getJSON(`${ANALYTICS_API}/ability-order-stats?hero_id=${hid}&min_average_badge=${LANE_LAB.min_average_badge}&min_unix_timestamp=${since}&min_matches=${ABILITY_ORDER_MIN_MATCHES}`);
        ability_orders[hid] = orderRows
            .map((r) => ({ abilities: r.abilities as number[], wins: r.wins as number, matches: r.matches as number }))
            .sort((a, b) => b.matches - a.matches)
            .slice(0, TOP_N_ABILITY_ORDERS);
        await sleep(350);
    }

    // Per-(hero, enemy) curated counter items — top-N by winrate, paced ≥350ms per call.
    // hero_id (singular) IS honored on item-stats (verified 2026-07-04: hero_id=X and hero_ids=X
    // are byte-identical, and different you-heroes vs the same enemy return different data) —
    // v1's baked counter data was correctly hero-filtered.
    const counter_item_stats: Record<number, Record<number, any[]>> = {};
    let pairCount = 0;
    for (const hid of activeHeroIds) {
        counter_item_stats[hid] = {};
        for (const eid of activeHeroIds) {
            if (eid === hid) continue;
            // `bucket=game_time_min` groups rows by PURCHASE minute (verified 2026-07-05: the
            // per-item bucketed `matches` sum exactly equals the unbucketed total), so one call
            // yields a purchase histogram per item at the same request budget. We reduce it to
            // totals + a weighted MEDIAN buy time: the mean is dragged late by players who buy
            // cheap items as 5th-slot fillers mid-game (probe: median 4m vs mean 6.1m on the
            // pair's most-bought item), which made the 15:00 lane-window gate over-filter.
            // NOTE: with a bucket param the API applies `min_matches` PER MINUTE-BUCKET — keep
            // it low (5, trims only noise-tail minutes) and apply the real per-item floor (>=50)
            // after summing, mirroring the old per-item behavior.
            const rows: any[] = await getJSON(
                `${ANALYTICS_API}/item-stats?hero_ids=${hid}&enemy_hero_ids=${eid}&same_lane_filter=true&min_average_badge=${LANE_LAB.min_average_badge}&min_unix_timestamp=${since}&min_matches=5&bucket=game_time_min`,
            );
            const byItem = new Map<number, { wins: number; losses: number; matches: number; hist: { min: number; matches: number }[] }>();
            for (const r of rows) {
                const it = byItem.get(r.item_id) ?? { wins: 0, losses: 0, matches: 0, hist: [] };
                it.wins += r.wins; it.losses += r.losses; it.matches += r.matches;
                it.hist.push({ min: r.bucket, matches: r.matches });
                byItem.set(r.item_id, it);
            }
            counter_item_stats[hid][eid] = [...byItem.entries()]
                .filter(([, v]) => v.matches >= 50)
                .map(([item_id, v]) => {
                    v.hist.sort((a, b) => a.min - b.min);
                    let acc = 0;
                    let medianMin = v.hist.length > 0 ? v.hist[v.hist.length - 1].min : 0;
                    for (const h of v.hist) { acc += h.matches; if (acc >= v.matches / 2) { medianMin = h.min; break; } }
                    return { item_id, wins: v.wins, losses: v.losses, matches: v.matches, median_buy_time_s: medianMin * 60 || null };
                })
                .sort((a, b) => (b.wins / Math.max(b.matches, 1)) - (a.wins / Math.max(a.matches, 1)))
                .slice(0, TOP_N_COUNTER_ITEMS);
            pairCount++;
            await sleep(350);
        }
    }

    // ─── Translate deadlock-api IDs → DB IDs ─────────────────────────────────
    // The analytics endpoints return deadlock-api hero/item IDs (small ints 1-81 for
    // heroes, large ints like 7409189 for items). Our DB uses auto-incremented IDs
    // (heroes 115-152, items 469-624). Translate here before writing JSON so all
    // downstream accessors (getMatchup, getCounterItems, getItemStats) can join by id.
    // Join key: name (unique; both spaces ultimately come from the same /v1/assets data).
    // Rows whose id doesn't resolve (analytics covers heroes/items we don't model) are dropped.

    // apiHeroId → DB hero id (via name)
    const _apiHeroIdToName = new Map<number, string>(
        (heroData as any[]).filter(h => !h.disabled && h.player_selectable).map(h => [h.id as number, h.name as string])
    );
    const _heroNameToDbId = new Map<string, number>(bakedHeroes.map(h => [h.name, h.id]));
    const xlHero = (apiId: number): number | null => {
        const name = _apiHeroIdToName.get(apiId);
        return name != null ? (_heroNameToDbId.get(name) ?? null) : null;
    };

    // apiItemId → DB item id (via prettyName)
    const _apiItemIdToName = new Map<number, string>(
        (itemData as any[]).filter(i => typeof i.id === "number" && i.name).map(i => [i.id as number, prettyName(i.name as string)])
    );
    const _itemNameToDbId = new Map<string, number>(bakedItems.map(i => [i.name, i.id]));
    const xlItem = (apiId: number): number | null => {
        const name = _apiItemIdToName.get(apiId);
        return name != null ? (_itemNameToDbId.get(name) ?? null) : null;
    };

    // apiAbilityId → DB ability id. Ability-order-stats' abilities[] carry api ability item-ids
    // (type=ability items, e.g. 1593133799). There is no /abilities endpoint — resolve names via
    // /v1/assets/items/by-hero-id/{hero_id} (per the research appendix), then join to the baked
    // ability rows by (heroDbId, abilityName). Built per hero so identically-named abilities across
    // heroes never collide.
    const _abilityNameToDbId = new Map<string, number>(); // key: `${dbHeroId}\x00${abilityName}`
    for (const bh of bakedHeroes) for (const ab of (bh as any).abilities ?? []) _abilityNameToDbId.set(`${bh.id}\x00${ab.name}`, ab.id);
    // apiAbilityId → ability name (fetched per hero, one call each — cheap, cached in a map).
    const _apiAbilityIdToName = new Map<number, string>();
    for (const hid of activeHeroIds) {
        const dbHeroId = xlHero(hid);
        if (dbHeroId == null || (ability_orders[hid]?.length ?? 0) === 0) continue;
        const assets: any[] = await getJSON(`https://api.deadlock-api.com/v1/assets/items/by-hero-id/${hid}`);
        for (const a of assets) if (a.type === "ability" && typeof a.id === "number" && typeof a.name === "string") _apiAbilityIdToName.set(a.id, a.name);
        await sleep(200);
    }
    const xlAbility = (dbHeroId: number, apiAbilityId: number): number | null => {
        const name = _apiAbilityIdToName.get(apiAbilityId);
        return name != null ? (_abilityNameToDbId.get(`${dbHeroId}\x00${name}`) ?? null) : null;
    };

    // Translate counter_stats: hero_id + enemy_hero_id; project to the 4 fields we use
    const translated_counter_stats = (counter_stats as any[])
        .map(r => { const h = xlHero(r.hero_id), e = xlHero(r.enemy_hero_id); return (h != null && e != null) ? { hero_id: h, enemy_hero_id: e, wins: r.wins as number, matches_played: r.matches_played as number } : null; })
        .filter((r): r is NonNullable<typeof r> => r != null);

    // Translate item_stats: hero key + each row's item_id
    const translated_item_stats: Record<number, any[]> = {};
    for (const [apiHeroKey, rows] of Object.entries(item_stats)) {
        const dbHeroId = xlHero(Number(apiHeroKey));
        if (dbHeroId == null) continue;
        const xlRows = (rows as any[]).map(r => { const iid = xlItem(r.item_id); return iid != null ? { ...r, item_id: iid } : null; }).filter((r): r is NonNullable<typeof r> => r != null);
        if (xlRows.length > 0) translated_item_stats[dbHeroId] = xlRows;
    }

    // Translate counter_item_stats: hero key + enemy key + each row's item_id
    const translated_counter_item_stats: Record<number, Record<number, any[]>> = {};
    for (const [apiHeroKey, enemyMap] of Object.entries(counter_item_stats)) {
        const dbHeroId = xlHero(Number(apiHeroKey));
        if (dbHeroId == null) continue;
        translated_counter_item_stats[dbHeroId] = {};
        for (const [apiEnemyKey, rows] of Object.entries(enemyMap as Record<string, any[]>)) {
            const dbEnemyId = xlHero(Number(apiEnemyKey));
            if (dbEnemyId == null) continue;
            const xlRows = rows.map(r => { const iid = xlItem(r.item_id); return iid != null ? { ...r, item_id: iid } : null; }).filter((r): r is NonNullable<typeof r> => r != null);
            if (xlRows.length > 0) translated_counter_item_stats[dbHeroId][dbEnemyId] = xlRows;
        }
    }

    // Translate build_paths: hero key + each step's item_id (api → DB). Steps stay souls-ascending.
    const translated_build_paths: Record<number, { itemId: number; souls: number; pickrate: number; winrate: number }[]> = {};
    for (const [apiHeroKey, steps] of Object.entries(build_paths)) {
        const dbHeroId = xlHero(Number(apiHeroKey));
        if (dbHeroId == null) continue;
        const xl = steps
            .map((s) => { const iid = xlItem(s.item_id); return iid != null ? { itemId: iid, souls: s.souls, pickrate: s.pickrate, winrate: s.winrate } : null; })
            .filter((s): s is NonNullable<typeof s> => s != null);
        if (xl.length > 0) translated_build_paths[dbHeroId] = xl;
    }

    // ─── Curated aggregates (separate lazy JSON for C1/C2/C3) ────────────────────
    // Translate global item aggregates: each row's item_id (api → DB).
    const translated_item_aggregates = item_aggregates
        .map((r) => { const iid = xlItem(r.item_id); return iid != null ? { item_id: iid, wins: r.wins, matches: r.matches } : null; })
        .filter((r): r is NonNullable<typeof r> => r != null);

    // Carry the previous sync's item_stats forward as "previous" (mirrors baked-data.json's
    // `snapshots` two-generation pattern above: read the about-to-be-overwritten file BEFORE
    // writing the new one). Powers C3 Risers/Droppers — null on the very first bake, or if the
    // prior file predates this shape. Never fabricated; only ever carried from a real prior run.
    const aggregatesPath = new URL("../src/lib/aggregates-data.json", import.meta.url);
    let prevItemStats: { item_id: number; wins: number; matches: number }[] | null = null;
    try {
        const prevRaw = JSON.parse(readFileSync(aggregatesPath, "utf8")) as {
            item_stats?: { current?: unknown[]; previous?: unknown[] | null } | unknown[];
        };
        const prevItemStatsField = prevRaw.item_stats;
        // Back-compat: the pre-C3 shape stored item_stats as a flat array (no history).
        // Treat that flat array as the new "previous" generation so history starts accumulating
        // from the most recent real bake, rather than discarding it.
        prevItemStats = Array.isArray(prevItemStatsField)
            ? (prevItemStatsField as { item_id: number; wins: number; matches: number }[])
            : (prevItemStatsField?.current as { item_id: number; wins: number; matches: number }[] | undefined) ?? null;
    } catch { /* first run — no previous aggregates file */ }

    // IDs regenerate on every bake, so a carried-forward generation is only meaningful after
    // translating it into THIS bake's id space. Names are the stable identity across bakes
    // (the same invariant the V3 share-code fingerprint relies on): old id → name via the
    // about-to-be-overwritten baked file, name → new id via this run's bakedItems. Rows whose
    // item left the pool drop out; if the old bake can't be read, carry nothing — no history
    // beats wrong history.
    if (prevItemStats) {
        try {
            const oldBaked = JSON.parse(
                readFileSync(new URL("../src/lib/baked-data.json", import.meta.url), "utf8"),
            ) as { items?: { id: number; name: string }[] };
            const oldIdToName = new Map((oldBaked.items ?? []).map((i) => [i.id, i.name]));
            const nameToNewId = new Map(bakedItems.map((i) => [i.name, i.id]));
            const translated = prevItemStats
                .map((r) => {
                    const name = oldIdToName.get(r.item_id);
                    const nid = name != null ? nameToNewId.get(name) : undefined;
                    return nid != null ? { ...r, item_id: nid } : null;
                })
                .filter((r): r is NonNullable<typeof r> => r != null);
            prevItemStats = translated.length > 0 ? translated : null;
        } catch {
            prevItemStats = null;
        }
    }

    // Translate ability_orders: hero key + each order's abilities[] (api ability id → DB ability id).
    // Drop any order that loses an ability in translation (keeps every displayed order fully resolvable).
    const translated_ability_orders: Record<number, { abilities: number[]; wins: number; matches: number }[]> = {};
    for (const [apiHeroKey, orders] of Object.entries(ability_orders)) {
        const dbHeroId = xlHero(Number(apiHeroKey));
        if (dbHeroId == null) continue;
        const xl = orders
            .map((o) => {
                const abilities = o.abilities.map((aid) => xlAbility(dbHeroId, aid));
                return abilities.every((a) => a != null) ? { abilities: abilities as number[], wins: o.wins, matches: o.matches } : null;
            })
            .filter((o): o is NonNullable<typeof o> => o != null);
        if (xl.length > 0) translated_ability_orders[dbHeroId] = xl;
    }

    // ─── Atomic output: write ALL files only after every fetch above succeeded ────
    // Any API failure throws before this point → main() rejects → nothing written, exit
    // non-zero. This keeps baked-data.json + lane-lab-data.json + aggregates-data.json on a
    // single, mutually-consistent set of freshly-regenerated ids (the 2026-07-04 fix).
    const now = new Date().toISOString();
    // Drop per-row createdAt/updatedAt (unused at runtime; they'd churn every sync even when
    // the game data is unchanged — freshness comes from `syncedAt`).
    writeFileSync(
        bakedPath,
        JSON.stringify(
            { syncedAt: now, heroes: bakedHeroes, items: bakedItems, snapshots },
            (key, value) => (key === "createdAt" || key === "updatedAt" ? undefined : value),
        ),
    );
    writeFileSync(
        new URL("../src/lib/lane-lab-data.json", import.meta.url),
        JSON.stringify({ synced_at: now, params: LANE_LAB, counter_stats: translated_counter_stats, counter_item_stats: translated_counter_item_stats, item_stats: translated_item_stats, build_paths: translated_build_paths }),
    );
    writeFileSync(
        aggregatesPath,
        JSON.stringify({
            synced_at: now,
            params: { min_average_badge: LANE_LAB.min_average_badge, item_min_matches: ITEM_AGG_MIN_MATCHES, ability_order_min_matches: ABILITY_ORDER_MIN_MATCHES, window_days: LANE_LAB.window_days },
            item_stats: { current: translated_item_aggregates, previous: prevItemStats },
            ability_orders: translated_ability_orders,
        }),
    );
    console.log(`  baked data → src/lib/baked-data.json (${bakedHeroes.length} heroes, ${bakedItems.length} items, ${snapshots.length} snapshots)`);
    console.log(`  lane-lab data → src/lib/lane-lab-data.json (${translated_counter_stats.length} counter pairs, ${activeHeroIds.length} heroes, ${pairCount} per-pair calls, ${Object.keys(translated_build_paths).length} build paths)`);
    console.log(`  aggregates data → src/lib/aggregates-data.json (${translated_item_aggregates.length} global items${prevItemStats ? `, ${prevItemStats.length} in previous generation` : ", no previous generation yet"}, ${Object.keys(translated_ability_orders).length} heroes' ability orders)`);
    console.log("Done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
