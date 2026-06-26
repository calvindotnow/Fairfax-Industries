"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// Per-character "slot machine" text roll, inspired by textmotion.dev (slot-text). Dependency-
// free, pure-CSS transforms: each character is a column of two stacked glyphs (outgoing over
// incoming) that translateY up by one line, staggered per column for a tactile flip. Matches
// our inline-style/token approach — no external stylesheet. Swap `text` to trigger a roll.
//
// Accessibility: the live text is exposed via aria-label on the wrapper; the rolling glyphs
// are aria-hidden so screen readers read one stable label, not a smear of characters.
export default function SlotText({
    text,
    stagger = 26,
    duration = 360,
    style,
}: {
    text: string;
    /** Per-column start delay (ms) — the cascade. */
    stagger?: number;
    /** Roll duration (ms) per column. */
    duration?: number;
    style?: CSSProperties;
}) {
    // `from` → `to` is the pair currently rolling; `rolling` drives the transform.
    const [pair, setPair] = useState({ from: text, to: text });
    const [rolling, setRolling] = useState(false);
    const prev = useRef(text);

    useEffect(() => {
        if (text === prev.current) return;
        setPair({ from: prev.current, to: text });
        setRolling(false); // show the outgoing glyph first (no flash)…
        // …then start the roll on the next paint so the transition actually animates.
        const id = requestAnimationFrame(() => requestAnimationFrame(() => setRolling(true)));
        prev.current = text;
        return () => cancelAnimationFrame(id);
    }, [text]);

    const len = Math.max(pair.from.length, pair.to.length);
    const cells = Array.from({ length: len }, (_, i) => ({
        a: pair.from[i] ?? " ",
        b: pair.to[i] ?? " ",
    }));
    const nbsp = (c: string) => (c === " " ? " " : c);

    return (
        <span aria-label={text} style={{ display: "inline-flex", whiteSpace: "pre", ...style }}>
            {cells.map((c, i) => (
                <span
                    key={i}
                    aria-hidden
                    style={{ display: "inline-block", height: "1em", lineHeight: 1, overflow: "hidden", verticalAlign: "bottom" }}
                >
                    <span
                        style={{
                            display: "block",
                            transform: rolling ? "translateY(-1em)" : "translateY(0)",
                            transition: `transform ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
                            transitionDelay: `${i * stagger}ms`,
                        }}
                    >
                        <span style={{ display: "block", height: "1em" }}>{nbsp(c.a)}</span>
                        <span style={{ display: "block", height: "1em" }}>{nbsp(c.b)}</span>
                    </span>
                </span>
            ))}
        </span>
    );
}
