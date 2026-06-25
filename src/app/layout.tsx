import type { Metadata } from "next";
import "./globals.css";
import { Navigation } from "@/components/navigation";

export const metadata: Metadata = {
  title: "Fairfax Industries — Deadlock Proving Ground",
  description:
    "Design, simulate, and compare Deadlock builds. A community theorycrafting workbench.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">
        <Navigation />
        <main className="mx-auto w-full px-6 py-10" style={{ maxWidth: "var(--page-max)" }}>
          {children}
        </main>
        <footer className="mx-auto w-full px-6 pb-12 pt-8" style={{ maxWidth: "var(--page-max)" }}>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-dim)", maxWidth: 560 }}>
            Fairfax Industries is a community theorycrafting tool for Deadlock.
            Not affiliated with or endorsed by Valve Corporation. Game data and
            imagery belong to Valve.
          </p>
        </footer>
      </body>
    </html>
  );
}
