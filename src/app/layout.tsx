import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import "./globals.css";
import { Navigation } from "@/components/navigation";
import { getSyncedAt } from "@/lib/data";

export const metadata: Metadata = {
  title: "Fairfax Industries — Deadlock Build Tool",
  description:
    "Design, simulate, and compare Deadlock builds. A community theorycrafting workbench.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // When the baked game data was last synced (for the freshness badge).
  const syncedAt = getSyncedAt();

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">
        <Navigation />
        <main className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-10" style={{ maxWidth: "var(--page-max)" }}>
          {children}
        </main>
        <footer className="mx-auto w-full px-4 pb-12 pt-8 sm:px-6" style={{ maxWidth: "var(--page-max)" }}>
          {syncedAt && (
            <Link
              href="/patch-notes"
              title={`Last synced ${format(syncedAt, "PPpp")} — see what changed`}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 12, padding: "4px 10px", borderRadius: "var(--r-pill)", background: "var(--surface-raised)", border: "1px solid var(--border)", textDecoration: "none" }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cash-500)", boxShadow: "0 0 6px var(--cash-500)", flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, letterSpacing: "0.04em", color: "var(--text-muted)" }}>
                Data synced <span style={{ color: "var(--text)" }}>{formatDistanceToNow(syncedAt, { addSuffix: true })}</span> · what changed →
              </span>
            </Link>
          )}
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-muted)", maxWidth: 560 }}>
            <Link href="/methodology" style={{ color: "var(--brass-400)", textDecoration: "none", borderBottom: "1px solid var(--line-brass)" }}>
              How the numbers are calculated
            </Link>{" · "}
            <Link href="/hideout?tour=1" style={{ color: "var(--brass-400)", textDecoration: "none", borderBottom: "1px solid var(--line-brass)" }}>
              Replay the walkthrough
            </Link>{" · "}
            Fairfax Industries is a community theorycrafting tool for Deadlock.
            Not affiliated with or endorsed by Valve Corporation. Game data and
            imagery belong to Valve.
          </p>
        </footer>
      </body>
    </html>
  );
}
