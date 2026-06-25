/**
 * Sync real Deadlock data from the community deadlock-api assets endpoints
 * into the local SQLite database. Run: `bun scripts/sync-deadlock-api.ts`
 *
 * Source: https://api.deadlock-api.com/v1/assets  (open, community-run)
 * This replaces the hand-seeded placeholder heroes/items/abilities.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { heroes, abilities, items, itemStatModifiers } from "../src/db/schema";
import { captureSnapshot } from "../src/lib/snapshot";

const HEROES_URL = "https://api.deadlock-api.com/v1/assets/heroes?only_active=true";
const ITEMS_URL = "https://api.deadlock-api.com/v1/assets/items";

// Identify ourselves to the community API so the maintainers can see who's calling.
const FETCH_OPTS: RequestInit = {
    headers: { "User-Agent": "fairfax-industries-deadlock-sandbox (+https://github.com/)" },
};

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
function parseItemEffects(props: Record<string, any>, itemName: string) {
    const effects: any[] = [];
    const add = (e: any) => effects.push({ ...e, itemName });
    const pf = (v: any) => parseFloat(v); // tolerates "15m" style values
    const procCd = pf(props.ProcCooldown?.value) || undefined;

    for (const k of Object.keys(props)) {
        const val = pf(props[k]?.value);
        if (!val) continue;

        // Cooldown-gated spirit proc (e.g. Mystic Shot: +40 spirit, 1s)
        if (/^ProcBonusMagicDamage$/i.test(k))
            add({ kind: "onHitProc", damageType: "spirit", value: val, valueType: "flat", procCooldown: procCd ?? 1 });
        // Per-bullet spirit add (no cooldown)
        else if (/^BulletsBonusMagicDamage$/i.test(k))
            add({ kind: "onHitProc", damageType: "spirit", value: val, valueType: "flat", procCooldown: 0 });
        // Cooldown-gated weapon proc dealing a % of the shot (e.g. +125% base attack)
        else if (/^ProcBaseAttackDamagePercent$/i.test(k))
            add({ kind: "onHitProc", damageType: "weapon", value: val, valueType: "percentOfShot", procCooldown: procCd ?? 1 });
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
        const eff = parseItemEffects(it.properties || {}, display);
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
            // Direct/impact hit (Damage or ImpactDamage); DoT abilities use DPS over a duration
            const direct = p.Damage ?? p.ImpactDamage;
            const dps = p.DPS;
            const mainKey = direct ?? dps;
            const isTech = mainKey?.css_class === "tech_damage";
            const scale = num(mainKey?.scale_function?.value) ?? num(mainKey?.scale_function?.stat_scale) ?? 0;
            const dotDps = num(dps) ?? 0;
            // First positive duration field (0-valued fields must not shadow a real one).
            // Duration values arrive as strings (e.g. "5", "7"), so parse them; field name
            // varies by ability (burn/ground/debuff for true DoTs, lifetime/channel for zones).
            let dotDuration = 0;
            if (dotDps > 0) {
                const durCandidates = [
                    p.AbilityDuration, p.Duration, p.BurnDuration, p.GroundFlameDuration,
                    p.DebuffDuration, p.MaxLifetime, p.AbilityChannelTime,
                ];
                for (const d of durCandidates) {
                    const v = parseFloat(d?.value);
                    if (v && v > 0) {
                        dotDuration = v;
                        break;
                    }
                }
            }
            const hasDamage = (num(direct) ?? 0) > 0 || dotDps > 0;
            const damageKind = hasDamage ? (isTech ? "spirit" : "weapon") : null;

            // Display-only fields the damage engine doesn't need but the UI does.
            // Values arrive as unit-suffixed strings ("10m", "5", "-1.0").
            const range = firstPos(p.AbilityCastRange, p.Radius);
            // General ability duration (stun/zone/channel), independent of the DoT path.
            const duration = firstPos(p.AbilityDuration, p.AbilityChannelTime);
            const chargesRaw = pnum(p.AbilityCharges); // "0"/-1 = no charges
            const charges = chargesRaw != null && chargesRaw > 1 ? Math.round(chargesRaw) : null;
            const chargeCooldown = charges != null ? firstPos(p.AbilityCooldownBetweenCharge) : null;

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
            const scalingJson = rangeScalesWithSpirit || durationScalesWithSpirit
                ? JSON.stringify({ rangeScalesWithSpirit, durationScalesWithSpirit })
                : null;

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
                })
                .run();
            abilityCount++;
        }
    }
    console.log(`  inserted ${heroCount} heroes, ${abilityCount} abilities`);
    await captureSnapshot();
    console.log("  captured stat snapshot for patch history");
    console.log("Done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
