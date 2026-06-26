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
function parseItemEffects(props: Record<string, any>, itemName: string) {
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
        const statOf = (k: string): string | null =>
            /FireRate/i.test(k) ? "weaponFireRate"
            : /(WeaponPower|WeaponDamage|BaseAttack)/i.test(k) ? "bulletDamage"
            : /Health/i.test(k) ? "maxHealth"
            : /SprintSpeed/i.test(k) ? "sprintSpeed"
            : /MoveSpeed/i.test(k) ? "moveSpeed"
            : /(BulletResist|BulletArmor)/i.test(k) ? "bulletResist"
            : /(SpiritResist|TechResist|MagicResist)/i.test(k) ? "spiritResist"
            : /(SpiritPower|TechPower)/i.test(k) ? "spiritPower"
            : null;
        let emittedModeled = false;
        for (const k of Object.keys(props)) {
            if (!isStackKey(k)) continue;
            const perStack = pf(props[k]?.value); // tolerates unit suffixes ("0.15m")
            const stat = statOf(k);
            if (perStack && stat) { add({ kind: "stacking", value: perStack, stat, maxStacks }); emittedModeled = true; }
        }
        // Display-only marker so the slider still appears for stacking items whose per-stack
        // stat we don't model yet (e.g. Escalating Exposure's spirit-damage amp).
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
        const eff = parseItemEffects(it.properties || {}, display);
        // Imbue items attach to one ability. Mark them so the UI can offer an ability picker.
        const isImbue = /imbu/i.test(it.class_name || "") || /imbue an ability|imbued ability/i.test(it.description?.desc || "");
        if (isImbue) eff.push({ kind: "imbue", value: 0, itemName: display });
        // Active items' on-cast self-buffs (ConditionallyApplied stats that map to our model,
        // e.g. Blood Tribute +35% fire rate). Applied only when "Actives firing" is toggled on.
        if (it.is_active_item) {
            // Active self-buffs arrive two ways: a ConditionallyApplied stat with a
            // provided_property_type (Blood Tribute: BonusFireRate), or an "Active*"-prefixed
            // property with neither, whose stat we infer from the name (Vampiric Burst:
            // ActiveBonusFireRate). Both apply only while "Actives firing" is on.
            const statFromName = (k: string): string | null =>
                /FireRate/i.test(k) ? "weaponFireRate"
                : /(WeaponPower|WeaponDamage|BaseAttack)/i.test(k) ? "bulletDamage"
                : /SprintSpeed/i.test(k) ? "sprintSpeed"
                : /MoveSpeed/i.test(k) ? "moveSpeed"
                : /(BulletResist|BulletArmor)/i.test(k) ? "bulletResist"
                : /(SpiritResist|TechResist)/i.test(k) ? "spiritResist"
                : /(SpiritPower|TechPower)/i.test(k) ? "spiritPower"
                : /Health/i.test(k) ? "maxHealth"
                : null;
            for (const [k, raw] of Object.entries(it.properties || {})) {
                const pr = raw as { usage_flags?: string[]; provided_property_type?: string; value?: unknown };
                const v = Number(pr?.value);
                if (!v) continue;
                let stat: string | null = null;
                if (pr?.usage_flags?.includes("ConditionallyApplied") && pr.provided_property_type) {
                    stat = MOD_MAP[pr.provided_property_type]?.[0] ?? null;
                } else if (/^Active[A-Z]/.test(k)) {
                    stat = statFromName(k);
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
            // Per-second damage (DoT/turret) vs an instant direct hit.
            const dps = pick(dmgKeys.filter((k) => /(DPS|PerSecond)$/i.test(k)), ["DPS", "TurretDPS", "PulseDPS"]);
            const direct = pick(dmgKeys.filter((k) => !/(DPS|PerSecond)$/i.test(k)), ["Damage", "ImpactDamage", "BonusDamage"]);
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
            const scalingJson = Object.keys(meta).length ? JSON.stringify(meta) : null;

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

    // Bake the data into a committed module the app imports at build time, so it runs
    // with no runtime database and deploys to any serverless host. Regenerated each sync.
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
    // Drop per-row createdAt/updatedAt (unused at runtime, and they'd churn every sync
    // even when the game data is unchanged — freshness comes from `syncedAt`).
    writeFileSync(
        bakedPath,
        JSON.stringify(
            { syncedAt: new Date().toISOString(), heroes: bakedHeroes, items: bakedItems, snapshots },
            (key, value) => (key === "createdAt" || key === "updatedAt" ? undefined : value)
        )
    );
    console.log(`  baked data → src/lib/baked-data.json (${bakedHeroes.length} heroes, ${bakedItems.length} items, ${snapshots.length} snapshots)`);
    console.log("Done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
