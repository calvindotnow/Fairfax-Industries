import { ImageResponse } from "next/og";
import { resolveBuild } from "./resolve";

export const runtime = "edge";
export const alt = "Deadlock build matchup — Fairfax Industries";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const C = {
  bg: "#1a1917", text: "#e9e5dc", muted: "#918c81",
  brass: "#e4c389", brass400: "#d6ab6e", danger: "#c5503e", border: "rgba(233,229,220,0.16)",
};

export default async function OgImage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const b = await resolveBuild(code);

  if (!b) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.muted, fontSize: 40 }}>
          Build not found · Fairfax Industries
        </div>
      ),
      size,
    );
  }

  const { hero, target, result } = b;
  const num = (n: number) => Math.round(n).toLocaleString();
  const stats: [string, string, string][] = [
    ["Burst", num(result.burst.total), C.brass],
    ["DPS", num(result.sustainedDps), C.text],
    ["TTK", result.timeToKill != null ? `${result.timeToKill.toFixed(1)}s` : "—", C.text],
    ["Target EHP", num(result.theirEhp), C.text],
  ];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.text, padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            {hero.imageUrl ? <img src={hero.imageUrl} width={160} height={160} style={{ borderRadius: 16 }} /> : null}
            <div style={{ display: "flex", marginTop: 16, fontSize: 52, color: C.brass }}>{hero.name}</div>
            <div style={{ display: "flex", fontSize: 24, color: C.muted }}>Attacker · Lvl {result.level}</div>
          </div>
          <div style={{ display: "flex", fontSize: 48, color: C.brass400 }}>VS</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            {target.imageUrl ? <img src={target.imageUrl} width={160} height={160} style={{ borderRadius: 16 }} /> : null}
            <div style={{ display: "flex", marginTop: 16, fontSize: 52, color: C.danger }}>{target.name}</div>
            <div style={{ display: "flex", fontSize: 24, color: C.muted }}>Target</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: 28 }}>
          {stats.map(([label, value, color]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 20, color: C.muted, letterSpacing: 2 }}>{label.toUpperCase()}</div>
              <div style={{ display: "flex", fontSize: 44, color }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 20, color: C.muted }}>fairfax.industries · Deadlock theorycrafting</div>
      </div>
    ),
    size,
  );
}
