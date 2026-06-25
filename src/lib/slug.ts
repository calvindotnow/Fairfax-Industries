// Hero/entity name → URL slug. Lowercase, spaces→hyphens, punctuation stripped.
// e.g. "Lady Geist" → "lady-geist", "Mo & Krill" → "mo-krill".
export function heroSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/&/g, " ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
