"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsNarrow } from "@/lib/use-narrow";

const navItems = [
    { href: "/hideout", label: "New Build" },
    { href: "/heroes", label: "Heroes" },
    { href: "/items", label: "Items" },
];

export function Navigation() {
    const pathname = usePathname();
    const narrow = useIsNarrow(480);

    return (
        <header style={{
            position: "sticky", top: 0, zIndex: 50, height: "var(--nav-h)",
            display: "flex", alignItems: "center", gap: narrow ? 14 : 28, padding: narrow ? "0 14px" : "0 24px",
            background: "rgba(20,19,17,0.88)", backdropFilter: "blur(12px)",
            borderBottom: "1px solid var(--border)",
        }}>
            {/* Wordmark */}
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
                <span style={{ width: 8, height: 8, background: "var(--brass-400)", transform: "rotate(45deg)", boxShadow: "0 0 10px var(--brass-glow)", flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--font-oswald)", fontWeight: 700, fontSize: 20, letterSpacing: "0.06em", color: "var(--brass-300)" }}>FAIRFAX</span>
                {!narrow && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.24em", textTransform: "uppercase", color: "var(--text-dim)", marginTop: 2 }}>Industries</span>}
            </Link>

            {/* Links */}
            <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {navItems.map(({ href, label }) => {
                    const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
                    return (
                        <Link
                            key={href}
                            href={href}
                            style={{
                                padding: "7px 13px", borderRadius: "var(--r-sm)", textDecoration: "none",
                                fontFamily: "var(--font-archivo)", fontSize: 14, fontWeight: isActive ? 600 : 500,
                                color: isActive ? "var(--text)" : "var(--text-muted)",
                                background: isActive ? "var(--surface-raised)" : "transparent",
                                border: `1px solid ${isActive ? "var(--border-strong)" : "transparent"}`,
                            }}
                        >
                            {label}
                        </Link>
                    );
                })}
            </nav>
        </header>
    );
}
