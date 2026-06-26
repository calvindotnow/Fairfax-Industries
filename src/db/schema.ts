import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ─── Heroes ──────────────────────────────────────────────────────────────────
export const heroes = sqliteTable("heroes", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    description: text("description"),
    imageUrl: text("image_url"),
    role: text("role"), // e.g. "Carry", "Support", "Tank", "Flex"
    // Base Stats
    maxHealth: real("max_health").notNull().default(550),
    healthRegen: real("health_regen").notNull().default(2),
    bulletDamage: real("bullet_damage").notNull().default(18),
    weaponFireRate: real("weapon_fire_rate").notNull().default(4),
    bulletResist: real("bullet_resist").notNull().default(0),
    spiritPower: real("spirit_power").notNull().default(0),
    spiritResist: real("spirit_resist").notNull().default(0),
    moveSpeed: real("move_speed").notNull().default(7),
    sprintSpeed: real("sprint_speed").notNull().default(11),
    stamina: integer("stamina").notNull().default(3),
    // Per-level (per-boon) stat growth from souls/leveling
    bulletDamagePerLevel: real("bullet_damage_per_level").notNull().default(0),
    healthPerLevel: real("health_per_level").notNull().default(0),
    spiritPerLevel: real("spirit_per_level").notNull().default(0),
    bulletResistPerLevel: real("bullet_resist_per_level").notNull().default(0),
    spiritResistPerLevel: real("spirit_resist_per_level").notNull().default(0),
    // Headshot/crit damage *taken* multiplier (1 = normal, 0.45 = takes 45% i.e. -55% headshot dmg)
    critDamageReceivedScale: real("crit_damage_received_scale").notNull().default(1),
    // Scaling info (JSON string) - e.g. { "maxHealth": 1.2, "bulletDamage": 0.05 }
    spiritScaling: text("spirit_scaling"),
    // Falloff info (m)
    falloffStart: real("falloff_start").notNull().default(22),
    falloffEnd: real("falloff_end").notNull().default(58),
    // Melee — base light/heavy melee DAMAGE (level 1), plus the per-level growth
    // amount (API: standard_level_up_upgrades.MODIFIER_VALUE_BASE_MELEE_DAMAGE_FROM_LEVEL).
    lightMeleeDamage: real("light_melee_damage").notNull().default(50),
    heavyMeleeDamage: real("heavy_melee_damage").notNull().default(116),
    meleePerLevel: real("melee_damage_per_level").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
        .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
        .$defaultFn(() => new Date()),
});

// ─── Abilities ────────────────────────────────────────────────────────────────
export const abilities = sqliteTable("abilities", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    heroId: integer("hero_id")
        .notNull()
        .references(() => heroes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // type: "signature" | "basic" | "ultimate" | "weapon_alt" | "passive"
    type: text("type").notNull().default("basic"),
    cooldown: real("cooldown"),
    range: real("range"),
    duration: real("duration"),
    charges: integer("charges"),
    chargeCooldown: real("charge_cooldown"),
    spiritScaling: real("spirit_scaling"),
    baseDamage: real("base_damage"),
    dotDps: real("dot_dps"),
    dotDuration: real("dot_duration"),
    damageKind: text("damage_kind"), // "spirit" | "weapon" | null
    imageUrl: text("image_url"),
    // JSON string for unique mechanics: { "SlowAmount": "20%", "StunDuration": "1.5s" }
    properties: text("properties"),
    // JSON string of the ability-rank profile: precomputed stat snapshots at ranks 0–3
    // plus human-readable tier change lists. Shape: { ranks: [...4], tiers: [[..],[..],[..]] }.
    upgrades: text("upgrades"),
});


// ─── Items ────────────────────────────────────────────────────────────────────
export const items = sqliteTable("items", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    category: text("category", { enum: ["weapon", "vitality", "spirit"] }).notNull(),
    tier: integer("tier").notNull().default(1), // 1–4
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    description: text("description"),
    imageUrl: text("image_url"),
    soulCost: integer("soul_cost").notNull().default(800),
    // JSON array of typed damage effects (procs, conditional flat adds) — see lib/stats ItemEffect
    effects: text("effects"),
    // JSON array of component item names this item builds/upgrades from (its direct cheaper parts).
    // `soulCost` is already the cumulative total (e.g. Swift Striker = 1600, includes Rapid Rounds).
    components: text("components"),
    createdAt: integer("created_at", { mode: "timestamp" })
        .$defaultFn(() => new Date()),
});

// ─── Item Stat Modifiers ──────────────────────────────────────────────────────
export const itemStatModifiers = sqliteTable("item_stat_modifiers", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
    statName: text("stat_name").notNull(), // e.g. "maxHealth", "bulletDamage"
    flatBonus: real("flat_bonus").notNull().default(0),
    percentBonus: real("percent_bonus").notNull().default(0),
});

// ─── Stat snapshots (patch history) ────────────────────────────────────────────
// One row per data sync: a JSON snapshot of hero/item stats. Diffing the two most
// recent snapshots powers "what changed for my build" (R-5). Accumulates over syncs.
export const statSnapshots = sqliteTable("stat_snapshots", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    takenAt: integer("taken_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    label: text("label").notNull(), // human label, e.g. "2026-06-25"
    payload: text("payload").notNull(), // JSON SnapshotPayload (see lib/patch-diff)
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const heroesRelations = relations(heroes, ({ many }) => ({
    abilities: many(abilities),
}));

export const abilitiesRelations = relations(abilities, ({ one }) => ({
    hero: one(heroes, {
        fields: [abilities.heroId],
        references: [heroes.id],
    }),
}));

export const itemsRelations = relations(items, ({ many }) => ({
    modifiers: many(itemStatModifiers),
}));

export const itemStatModifiersRelations = relations(itemStatModifiers, ({ one }) => ({
    item: one(items, {
        fields: [itemStatModifiers.itemId],
        references: [items.id],
    }),
}));

// ─── Types ────────────────────────────────────────────────────────────────────
export type Hero = typeof heroes.$inferSelect;
export type NewHero = typeof heroes.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemStatModifier = typeof itemStatModifiers.$inferSelect;
export type NewItemStatModifier = typeof itemStatModifiers.$inferInsert;
export type Ability = typeof abilities.$inferSelect;
export type NewAbility = typeof abilities.$inferInsert;

export type StatSnapshot = typeof statSnapshots.$inferSelect;
export type ItemWithModifiers = Item & { modifiers: ItemStatModifier[] };
export type HeroWithAbilities = Hero & { abilities: Ability[] };
