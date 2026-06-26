"use client";
import { useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import Image from "next/image";
import type { HeroWithAbilities } from "@/lib/sim";
import { filterHeroes } from "@/lib/hideout-utils";

export function HeroPicker({
  heroes, value, onChange, accentColor, align = "left", children,
}: {
  heroes: HeroWithAbilities[];
  value: number | null;
  onChange: (id: number) => void;
  accentColor: string;
  align?: "left" | "right";
  children: ReactNode; // the trigger (hero portrait)
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = filterHeroes(heroes, query);

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align === "right" ? "end" : "start"}
          sideOffset={8}
          style={{
            width: 320, padding: 10, zIndex: 90, // above the sticky nav (z-50)
            background: "var(--surface-raised)", border: "1px solid var(--border-strong)",
            borderRadius: "var(--r-md, 10px)", boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          }}
        >
          <input
            autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search heroes…"
            style={{
              width: "100%", height: 32, padding: "0 10px", marginBottom: 8,
              background: "var(--surface-well)", border: "1px solid var(--border)",
              borderRadius: "var(--r-sm, 6px)", color: "var(--text)",
              fontFamily: "var(--font-archivo)", fontSize: 13, outline: "none",
            }}
          />
          <div className="hero-picker-grid">
            {shown.map((h) => {
              const selected = h.id === value;
              return (
                <button
                  key={h.id} type="button"
                  onClick={() => { onChange(h.id); setOpen(false); }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    padding: 6, background: "transparent", cursor: "pointer",
                    border: `1px solid ${selected ? accentColor : "transparent"}`,
                    borderRadius: "var(--r-sm, 6px)", color: "var(--text)",
                  }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "var(--surface-well)", display: "flex" }}>
                    {h.imageUrl ? <Image src={h.imageUrl} alt="" role="presentation" width={44} height={44} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                  </div>
                  <span style={{ fontSize: 10, lineHeight: 1.1, textAlign: "center", color: selected ? accentColor : "var(--text-muted)" }}>{h.name}</span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <div style={{ gridColumn: "1 / -1", padding: 12, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No heroes</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
